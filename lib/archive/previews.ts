import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink,readFile } from 'node:fs/promises';
import sharp from 'sharp';
import bundledFfmpeg from 'ffmpeg-static';
import bundledFfprobe from 'ffprobe-static';
import { Actor,itemAccess } from './access';
import { db,serial,lock,asJson } from './db';
import { check,ArchiveError } from './errors';
import { objectPath,putObject,objectLease,releaseLeases } from './storage';
import { safePath,configuredPaths } from './paths';
export const PREVIEW_IMAGE_LIMIT=500,SOURCE_PREVIEW_LIMIT=6;
export async function command(binary:string,args:string[],assertLease:()=>Promise<void>,timeout=12*3600_000):Promise<string>{
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  let stdout='',settled=false;let lastError:Error|null=null;
  child.stdout.on('data',b=>{if(stdout.length<1_000_000)stdout+=b.toString();});
  child.stderr.on('data',()=>{});
  const end=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(guard);if(error)reject(error);else resolve(stdout);};
  const timer=setTimeout(()=>{child.kill();end(new ArchiveError(503,'ENCODER_TIMEOUT','인코딩 시간이 제한을 초과했습니다.'));},timeout);
  const guard=setInterval(()=>{assertLease().catch(e=>{lastError=e;child.kill();});},10_000);
  child.on('error',()=>end(new ArchiveError(503,'ENCODER_MISSING','FFmpeg/FFprobe 실행 경로와 AV1 인코더 설치를 확인하세요.')));
  child.on('exit',code=>end(lastError||(code===0?undefined:new ArchiveError(422,'ENCODER_FAILED','파일을 AV1/WebP로 변환할 수 없습니다. 코덱과 도구 설치를 확인하세요.'))));
 });
}
export async function processPreview(actor:Actor,versionId:string,assertLease:()=>Promise<void>){
 const version=await db.itemVersion.findUnique({where:{id:versionId},include:{item:true,archive:{include:{files:{where:{active:true},orderBy:{relativePath:'asc'}}}}}});
 check(version?.state==='READY',409,'VERSION_NOT_READY','공개된 버전만 미리보기를 생성합니다.');
 await itemAccess(actor,version.itemId);
 const files=version.archive?.files||[];
 // 결과 이미지는 갤러리 전체를, 소스(3D/UE/기타)는 얕은 경로의 대표 이미지 일부만 미리보기로 만든다.
 // UE Content 텍스처 수천 개를 모두 변환하지 않기 위한 상한이다(원본 보존과 무관).
 const kind=version.item.kind,allImages=files.filter(f=>f.mime.startsWith('image/'));
 const depth=(p:string)=>p.split('/').length;
 const images=kind==='IMAGE'?allImages.slice(0,PREVIEW_IMAGE_LIMIT):kind==='VIDEO'?[]:[...allImages].sort((a,b)=>depth(a.relativePath)-depth(b.relativePath)||a.relativePath.localeCompare(b.relativePath)).slice(0,SOURCE_PREVIEW_LIMIT);
 const video=kind==='VIDEO'?files.find(f=>f.mime.startsWith('video/'))||files[0]:undefined;
 if(!images.length&&!video)return {unsupported:true};
 const owner='preview:'+versionId;await objectLease([...images.map(f=>f.storageObjectId),...(video?[video.storageObjectId]:[])],owner);
 const publish=async(type:string,objectId:string,metadata:unknown)=>{
  await assertLease();
  return serial(async tx=>{await lock(tx,'archive_items',version.itemId);await itemAccess(actor,version.itemId,'VIEW',tx);await tx.previewDerivative.upsert({where:{versionId_type:{versionId,type}},create:{versionId,type,objectId,state:'READY',metadata:asJson(metadata)},update:{objectId,state:'READY',error:null,metadata:asJson(metadata)}});});
 };
 try{
  if(video){
   const existing=await db.previewDerivative.findUnique({where:{versionId_type:{versionId,type:'AV1'}}});
   if(existing?.state==='READY')return {ready:true};
   for(const type of ['AV1','POSTER'])await db.previewDerivative.upsert({where:{versionId_type:{versionId,type}},create:{versionId,type},update:{state:'PENDING',error:null}});
   const input=await objectPath(video.storageObjectId);
   const temp=await safePath(configuredPaths().staging,'encodes/'+versionId+'/'+randomUUID()+'.webm',true);
   const poster=await safePath(configuredPaths().staging,'encodes/'+versionId+'/'+randomUUID()+'.webp',true);
   try{
    const ffmpeg=process.env.FFMPEG_PATH||bundledFfmpeg||'ffmpeg',ffprobe=process.env.FFPROBE_PATH||bundledFfprobe.path||'ffprobe';
    const encoders=await command(ffmpeg,['-hide_banner','-encoders'],assertLease,60000);
    const encoder=process.env.AV1_ENCODER||(encoders.includes('libsvtav1')?'libsvtav1':'libaom-av1');check(['libsvtav1','libaom-av1'].includes(encoder)&&encoders.includes(encoder),400,'INVALID_ENCODER','설치된 FFmpeg의 AV1 인코더 설정을 확인하세요.');
    const crf=Number(process.env.AV1_CRF||32),height=Number(process.env.AV1_MAX_HEIGHT||1080);
    check(Number.isInteger(crf)&&crf>=0&&crf<=63&&Number.isInteger(height)&&height>=144&&height<=4320,400,'INVALID_ENCODER','AV1 품질·해상도 설정을 확인하세요.');
    const speed=encoder==='libaom-av1'?['-cpu-used','6','-row-mt','1','-b:v','0']:['-preset','8'];
    await command(ffmpeg,['-nostdin','-hide_banner','-i',input.path,'-map','0:v:0','-map','0:a?','-vf','scale=-2:trunc(min(ih\\,'+height+')/2)*2','-c:v',encoder,'-crf',String(crf),...speed,'-threads','2','-pix_fmt','yuv420p','-c:a','libopus','-b:a','128k','-y',temp],assertLease);
    const probe=JSON.parse(await command(ffprobe,['-v','error','-show_streams','-show_format','-of','json',temp],assertLease,60_000));
    const stream=probe.streams?.find((s:{codec_type:string})=>s.codec_type==='video');
    check(stream?.codec_name==='av1',409,'CODEC_MISMATCH','생성 영상이 AV1이 아닙니다.');
    await command(ffmpeg,['-nostdin','-hide_banner','-i',temp,'-frames:v','1','-c:v','libwebp','-quality','82','-y',poster],assertLease,120_000);
    const posterBytes=await sharp(await readFile(poster)).webp({quality:82}).toBuffer();
    const proxy=await putObject(actor.teamId,'PREVIEW',temp,undefined,assertLease);
    const cover=await putObject(actor.teamId,'PREVIEW',posterBytes,undefined,assertLease);
    await publish('AV1',proxy.id,{schemaVersion:1,codec:'av1',container:'webm',mime:'video/webm',width:stream.width,height:stream.height,duration:probe.format?.duration,encoder});
    await publish('POSTER',cover.id,{schemaVersion:1,mime:'image/webp'});
   }finally{await unlink(temp).catch(()=>{});await unlink(poster).catch(()=>{});}
  }else{
   for(const file of images){
    await assertLease();const type='WEBP:'+file.id;
    if((await db.previewDerivative.findUnique({where:{versionId_type:{versionId,type}}}))?.state==='READY')continue;
    await db.previewDerivative.upsert({where:{versionId_type:{versionId,type}},create:{versionId,type},update:{state:'PENDING',error:null}});
    try{
     const input=await objectPath(file.storageObjectId);
     const{data,info}=await sharp(input.path,{limitInputPixels:268_402_689}).rotate().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true}).webp({quality:84}).toBuffer({resolveWithObject:true});
     const object=await putObject(actor.teamId,'PREVIEW',data,undefined,assertLease);
     await publish(type,object.id,{schemaVersion:1,mime:'image/webp',width:info.width,height:info.height,sourceFileId:file.id});
     if(file.id===images[0].id)await publish('POSTER',object.id,{schemaVersion:1,mime:'image/webp'});
    }catch(e){if(e instanceof ArchiveError&&e.code==='LEASE_LOST')throw e;await db.previewDerivative.update({where:{versionId_type:{versionId,type}},data:{state:'UNSUPPORTED',error:'이 이미지 형식의 WebP 변환을 지원하지 않습니다. 원본 다운로드를 이용하세요.'}});}
   }
  }
  return {ready:true};
 }catch(e){
  if(!(e instanceof ArchiveError&&e.code==='LEASE_LOST'))await db.previewDerivative.updateMany({where:{versionId,state:'PENDING'},data:{state:'FAILED',error:e instanceof ArchiveError?e.message:'미리보기 생성에 실패했습니다.'}});
  throw e;
 }finally{await releaseLeases(owner);}
}

