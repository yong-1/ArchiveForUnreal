import { randomUUID } from 'node:crypto';
import { createReadStream,createWriteStream } from 'node:fs';
import { mkdir,readFile,writeFile,rename,stat,unlink,statfs } from 'node:fs/promises';
import { Readable,Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { db,serial,lock } from './db';
import { check } from './errors';
import { configuredPaths,safePath,storageFailure } from './paths';
import { fileHash } from './hash';
export const CHUNK_SIZE=8*1024*1024;
export async function rootFor(teamId:string,kind:'ARCHIVE'|'PREVIEW'|'STAGING'){
  const root=await db.storageRoot.findFirst({where:{teamId,kind}});
  check(root,503,'ROOT_MISSING','관리자가 저장소 루트를 설정해야 합니다.');
  return root;
}
export async function availableSpace(root:string,bytes:bigint){
  const info=await statfs(root,{bigint:true});
  const reserve=BigInt(process.env.STORAGE_RESERVE_BYTES||268435456);
  check(info.bavail*info.bsize>=bytes+reserve,409,'INSUFFICIENT_SPACE','NAS 또는 임시 저장소의 여유 공간이 부족합니다.');
}
export async function objectPath(id:string){
  const object=await db.storageObject.findUnique({where:{id},include:{root:true}});
  check(object&&object.state==='AVAILABLE',409,'OBJECT_UNAVAILABLE','파일이 준비 중이거나 삭제 중입니다.');
  return {object,path:await storageFailure(()=>safePath(object.root.path,object.objectKey))};
}
export async function putObject(teamId:string,kind:'ARCHIVE'|'PREVIEW'|'STAGING',input:Readable|string|Buffer,id:string=randomUUID(),assertLease:()=>Promise<void>=async()=>{}){
  await assertLease();
  const root=await rootFor(teamId,kind),key=teamId+'/'+id;
  const existing=await db.storageObject.findUnique({where:{id}});
  if(existing?.state==='AVAILABLE'){
    const p=await safePath(root.path,key);
    check(await fileHash(p)===existing.checksum,409,'OBJECT_CORRUPT','보존 파일 무결성 검증에 실패했습니다.');
    return existing;
  }
  await db.storageObject.upsert({where:{id},create:{id,teamId,rootId:root.id,objectKey:key,sizeBytes:0n,checksum:'',state:'STAGING'},update:{}});
  const destination=await safePath(root.path,key,true),temp=await safePath(root.path,key+'.'+randomUUID()+'.partial',true);
  const hash=createHash('sha256');let size=0n,lastCheck=Date.now();
  const transform=new Transform({transform(chunk,_encoding,done){hash.update(chunk);size+=BigInt(chunk.length);if(Date.now()-lastCheck>5000){lastCheck=Date.now();assertLease().then(()=>done(null,chunk),done);}else done(null,chunk);}});
  try{
    const source=typeof input==='string'?createReadStream(input):Buffer.isBuffer(input)?Readable.from([input]):input;
    await pipeline(source,transform,createWriteStream(temp,{flags:'wx'}));
    const checksum=hash.digest('hex');
    check(await fileHash(temp)===checksum,409,'COPY_CORRUPT','복사 파일 검증에 실패했습니다.');
    await assertLease();
    return await serial(async tx=>{
      await lock(tx,'storage_objects',id);
      const current=await tx.storageObject.findUniqueOrThrow({where:{id}});
      if(current.state==='AVAILABLE'){
        check(current.checksum===checksum&&current.sizeBytes===size&&await fileHash(destination)===checksum,409,'OBJECT_CONFLICT','이미 확정된 파일은 덮어쓸 수 없습니다.');
        await unlink(temp);return current;
      }
      check(current.state==='STAGING',409,'OBJECT_UNAVAILABLE','이 객체에 새 파일을 쓸 수 없습니다.');
      await rename(temp,destination);
      return tx.storageObject.update({where:{id},data:{sizeBytes:size,checksum,state:'AVAILABLE'}});
    });
  }catch(e){await unlink(temp).catch(()=>{});throw e;}
}
export async function partPath(sessionId:string,partNo:number,create=false){
  check(Number.isInteger(partNo)&&partNo>=0&&partNo<2_000_000,400,'INVALID_PART','청크 번호가 올바르지 않습니다.');
  return safePath(configuredPaths().staging,'uploads/'+sessionId+'/'+partNo,create);
}
export async function readParts(sessionId:string,parts:number){
  const expected=await db.uploadPart.findMany({where:{sessionId}});
  async function* chunks(){for(let i=0;i<parts;i++){const p=await partPath(sessionId,i),hash=createHash('sha256');for await(const b of createReadStream(p)){hash.update(b);yield b;}check(hash.digest('hex')===expected.find(e=>e.partNo===i)?.checksum,409,'PART_CORRUPT','임시 파일 체크섬이 변경되었습니다.');}}
  return Readable.from(chunks());
}
export async function objectLease(ids:string[],owner:string){
  return serial(async tx=>{
    for(const id of [...new Set(ids)].sort()){
      await lock(tx,'storage_objects',id);
      const object=await tx.storageObject.findUnique({where:{id}});
      check(object?.state==='AVAILABLE',409,'OBJECT_UNAVAILABLE','파일이 준비 중이거나 삭제 중입니다.');
    }
    await tx.fileLease.createMany({data:[...new Set(ids)].map(objectId=>({objectId,owner,expiresAt:new Date(Date.now()+60_000)}))});
  });
}
export async function renewLeases(owner:string,required=false){const result=await db.fileLease.updateMany({where:{owner,expiresAt:{gt:new Date()}},data:{expiresAt:new Date(Date.now()+60_000)}});check(!required||result.count>0,409,'LEASE_LOST','파일 사용 기한이 만료되었습니다.');}
export async function releaseLeases(owner:string){await db.fileLease.deleteMany({where:{owner}});}
export async function hasReferences(id:string){
  const counts=await Promise.all([
    db.archiveFile.count({where:{storageObjectId:id,active:true}}),
    db.archiveVersion.count({where:{manifestObjectId:id,state:{not:'DELETED'}}}),
    db.previewDerivative.count({where:{objectId:id,state:{not:'DELETED'}}}),
    db.uploadSession.count({where:{objectId:id,batch:{state:{in:['UPLOADING','QUEUED','COMMITTING']}}}}),
  ]);return counts.some(n=>n>0);
}
export async function removeUploadParts(sessionId:string,parts:number){
  for(let i=0;i<parts;i++)await unlink(await partPath(sessionId,i)).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});
}
// 참조·활성 lease가 없는 보존/미리보기/임시 객체만 제거한다(정리 작업용). 원본(SOURCE) 루트는 절대 지우지 않는다.
// 삭제 요청 처리(processDelete)와 같은 순서: 객체 행 잠금 → 실제 참조 재조회 → PURGING → 파일 제거·부재 확인 → PURGED.
export async function purgeIfUnreferenced(objectId:string):Promise<'PURGED'|'RETAINED'|'WAIT'|'SKIPPED'>{
  const decision=await serial(async tx=>{
    await lock(tx,'storage_objects',objectId);
    const object=await tx.storageObject.findUnique({where:{id:objectId},include:{root:true}});
    if(!object||object.state==='PURGED')return {kind:'SKIPPED' as const};
    if(!['ARCHIVE','PREVIEW','STAGING'].includes(object.root.kind))return {kind:'SKIPPED' as const};
    const refs=await Promise.all([
      tx.archiveFile.count({where:{storageObjectId:objectId,active:true}}),
      tx.archiveVersion.count({where:{manifestObjectId:objectId,state:{not:'DELETED'}}}),
      tx.previewDerivative.count({where:{objectId,state:{not:'DELETED'}}}),
      tx.uploadSession.count({where:{objectId,batch:{state:{in:['UPLOADING','QUEUED','COMMITTING','FAILED']}}}}),
    ]);
    if(refs.some(n=>n>0))return {kind:'RETAINED' as const};
    if(await tx.fileLease.count({where:{objectId,expiresAt:{gt:new Date()}}}))return {kind:'WAIT' as const};
    await tx.storageObject.update({where:{id:objectId},data:{state:'PURGING'}});
    return {kind:'PURGE' as const,root:object.root.path,key:object.objectKey};
  });
  if(decision.kind!=='PURGE')return decision.kind;
  const p=await storageFailure(()=>safePath(decision.root,decision.key));
  await unlink(p).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});
  await stat(p).then(()=>{throw new Error('file still present');},e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});
  await db.storageObject.update({where:{id:objectId},data:{state:'PURGED'}});
  return 'PURGED';
}
