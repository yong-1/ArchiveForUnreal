import { createReadStream,createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';
import { Actor,itemAccess } from './access';
import { db,serial,lock } from './db';
import { check } from './errors';
import { safePath,configuredPaths } from './paths';
import { objectPath,putObject,objectLease,releaseLeases,renewLeases } from './storage';
import { verifyManifest } from './manifest';
import { stat } from 'node:fs/promises';
import { storageFailure } from './paths';
export function byteRange(header:string|null,size:bigint){
 if(!header)return {start:0n,end:size===0n?0n:size-1n,partial:false};
 check(size>0n&&/^bytes=(\d*)-(\d*)$/.test(header),416,'INVALID_RANGE','요청 범위가 올바르지 않습니다.');
 const match=/^bytes=(\d*)-(\d*)$/.exec(header)!;check(!!match[1]||!!match[2],416,'INVALID_RANGE','빈 범위입니다.');
 let start=match[1]?BigInt(match[1]):size-BigInt(match[2]),end=match[1]?(match[2]?BigInt(match[2]):size-1n):size-1n;
 if(start<0n)start=0n;if(end>=size)end=size-1n;
 check(start<size&&end>=start,416,'INVALID_RANGE','파일 범위를 벗어난 요청입니다.');
 return {start,end,partial:true};
}
export async function streamObject(req:Request,objectId:string,name:string,mime:string,attachment=true){
 const owner='http:'+randomUUID();await objectLease([objectId],owner);
 let timer:ReturnType<typeof setInterval>|undefined;
 try{
  const{object,path}=await objectPath(objectId);
  // NAS 파일이 없거나 크기가 다르면 잘린 응답 대신 오류를 반환한다(SAVE-05).
  const info=await storageFailure(()=>stat(path));
  check(info.isFile()&&BigInt(info.size)===object.sizeBytes,503,'STORAGE_MISMATCH','보존 파일 상태가 기록과 다릅니다. 관리자에게 무결성 점검을 요청하세요.');
  const headers=new Headers({'Content-Type':mime,'Accept-Ranges':'bytes','ETag':'"'+object.checksum+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  const ascii=name.replace(/[^\x20-\x7e]|["\\]/g,'_').slice(0,150);
  headers.set('Content-Disposition',(attachment?'attachment':'inline')+'; filename="'+ascii+'"; filename*=UTF-8'+String.fromCharCode(39,39)+encodeURIComponent(name));
  let range;try{range=byteRange(req.headers.get('if-range')&&req.headers.get('if-range')!==headers.get('etag')?null:req.headers.get('range'),object.sizeBytes);}
  catch(e){await releaseLeases(owner);return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+object.sizeBytes,'Cache-Control':'private, no-store'}});}
  headers.set('Content-Length',object.sizeBytes===0n?'0':(range.end-range.start+1n).toString());
  if(range.partial)headers.set('Content-Range','bytes '+range.start+'-'+range.end+'/'+object.sizeBytes);
  if(req.method==='HEAD'||object.sizeBytes===0n){await releaseLeases(owner);return new Response(null,{status:range.partial?206:200,headers});}
  const stream=createReadStream(path,{start:Number(range.start),end:Number(range.end)});
  const release=()=>{if(timer)clearInterval(timer);void releaseLeases(owner);};
  timer=setInterval(()=>{renewLeases(owner,true).catch(()=>stream.destroy());},15_000);
  stream.once('close',release);stream.once('error',release);
  req.signal.addEventListener('abort',()=>stream.destroy(),{once:true});
  return new Response(Readable.toWeb(stream) as ReadableStream,{status:range.partial?206:200,headers});
 }catch(e){if(timer)clearInterval(timer);await releaseLeases(owner);throw e;}
}
export async function fileContent(actor:Actor,id:string,req:Request){
 const file=await db.archiveFile.findUnique({where:{id},include:{archive:{include:{version:true}}}});
 check(file?.active&&file.archive.state==='VERIFIED'&&file.archive.version.state==='READY',404,'NOT_FOUND','보존 파일을 찾을 수 없습니다.');
 await itemAccess(actor,file.archive.version.itemId,'DOWNLOAD');
 return streamObject(req,file.storageObjectId,file.relativePath.split('/').at(-1)!,file.mime);
}
export async function mediaContent(actor:Actor,id:string,req:Request){
 const derivative=await db.previewDerivative.findUnique({where:{id},include:{version:true}});
 check(derivative?.state==='READY'&&derivative.objectId,404,'NOT_FOUND','미리보기가 준비되지 않았습니다.');
 await itemAccess(actor,derivative.version.itemId);
 const video=derivative.type==='AV1';
 return streamObject(req,derivative.objectId,video?'preview.webm':'preview.webp',video?'video/webm':'image/webp',false);
}
export async function queueDownload(actor:Actor,versionId:string){
 const version=await db.itemVersion.findUnique({where:{id:versionId}});
 check(version?.state==='READY',404,'NOT_FOUND','버전을 찾을 수 없습니다.');await itemAccess(actor,version.itemId,'DOWNLOAD');
 return serial(async tx=>{await lock(tx,'archive_items',version.itemId);await itemAccess(actor,version.itemId,'DOWNLOAD',tx);const existing=await tx.job.findFirst({where:{teamId:actor.teamId,actorId:actor.userId,type:'DOWNLOAD',targetId:versionId,state:{in:['QUEUED','RUNNING','WAITING','COMPLETED']}},orderBy:{createdAt:'desc'}});if(existing&&(existing.state!=='COMPLETED'||new Date((existing.result as {expiresAt:string}).expiresAt)>new Date()))return existing;return tx.job.create({data:{teamId:actor.teamId,actorId:actor.userId,type:'DOWNLOAD',targetId:versionId}});});
}
export async function processDownload(actor:Actor,versionId:string,jobId:string,assertLease:()=>Promise<void>,progress:(data:Record<string,unknown>)=>Promise<void>=async()=>{}){
 const version=await db.itemVersion.findUnique({where:{id:versionId},include:{item:true,archive:{include:{files:{where:{active:true},orderBy:{relativePath:'asc'}}}},unreal:true}});
 check(version?.archive?.state==='VERIFIED',409,'NOT_READY','보존 검증이 완료되지 않았습니다.');await itemAccess(actor,version.itemId,'DOWNLOAD');
 await verifyManifest(versionId);
 const owner='zip:'+jobId;await objectLease(version.archive.files.map(f=>f.storageObjectId),owner);
 const target=await safePath(configuredPaths().staging,'downloads/'+jobId+'.zip',true);
 try{
  const output=createWriteStream(target,{flags:'w'}),zip=archiver('zip',{zlib:{level:0},forceZip64:true});
  zip.on('warning',e=>output.destroy(e));zip.on('error',e=>output.destroy(e));
  const finished=pipeline(zip,output);
  let done=0;
  for(const file of version.archive.files){
   await assertLease();await progress({phase:'zip',done:done++,total:version.archive.files.length});const input=await objectPath(file.storageObjectId);
   async function* verified(){const hash=createHash('sha256');for await(const chunk of createReadStream(input.path)){hash.update(chunk);yield chunk;}check(hash.digest('hex')===file.checksum,409,'FILE_CORRUPT','보존 파일 무결성에 문제가 있습니다.');}
   const stream=Readable.from(verified());stream.on('error',e=>zip.destroy(e));zip.append(stream,{name:file.relativePath});
  }
  zip.append(JSON.stringify({schemaVersion:1,versionId,files:version.archive.files.map(f=>({path:f.relativePath,size:f.sizeBytes.toString(),sha256:f.checksum})),unreal:version.unreal?{uproject:version.unreal.uprojectPath,engineVersion:version.unreal.engineVersion,validation:version.unreal.validationStatus}:null},null,2),{name:'_archive/manifest.json'});
  await zip.finalize();await finished;await assertLease();await itemAccess(actor,version.itemId,'DOWNLOAD');
  const object=await putObject(actor.teamId,'STAGING',target,undefined,assertLease);
  return {objectId:object.id,filename:version.item.title+'-v'+version.versionNo+'.zip',checksum:object.checksum,size:object.sizeBytes.toString(),expiresAt:new Date(Date.now()+24*3600_000).toISOString()};
 }finally{await unlink(target).catch(()=>{});await releaseLeases(owner);}
}
export async function jobContent(actor:Actor,id:string,req:Request){
 const job=await db.job.findFirst({where:{id,teamId:actor.teamId,actorId:actor.userId,type:'DOWNLOAD'}});
 check(job,404,'NOT_FOUND','다운로드 작업을 찾을 수 없습니다.');
 const version=await db.itemVersion.findUniqueOrThrow({where:{id:job.targetId}});await itemAccess(actor,version.itemId,'DOWNLOAD');
 check(job.state==='COMPLETED',409,'DOWNLOAD_NOT_READY','다운로드 파일을 준비 중입니다.');
 const result=job.result as {objectId:string;filename:string;expiresAt:string};
 check(new Date(result.expiresAt)>new Date(),410,'DOWNLOAD_EXPIRED','다운로드가 만료되었습니다. 다시 준비하세요.');
 return streamObject(req,result.objectId,result.filename,'application/zip');
}

