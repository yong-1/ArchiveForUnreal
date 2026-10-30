// 정리·무결성 점검 작업(job type MAINTENANCE, targetId=teamId). worker가 주기적으로 예약한다.
// 원칙: DB 참조와 활성 lease를 확인하지 않은 파일은 지우지 않는다. 오프라인 저장소의 객체를 '없음'으로 판정하지 않는다.
import { stat } from 'node:fs/promises';
import { db,serial,lock,asJson } from './db';
import { Actor,admin } from './access';
import { fileHash } from './hash';
import { safePath } from './paths';
import { purgeIfUnreferenced,removeUploadParts,CHUNK_SIZE } from './storage';
type Progress=(data:Record<string,unknown>)=>Promise<void>;
export type MaintenanceResult={staleLeases:number;roots:{name:string;state:string}[];expiredBatches:number;abandonedDrafts:number;purgedObjects:number;expiredDownloads:number;integrity:{checked:number;hashed:number;missing:number;corrupt:number;recovered:number;skippedOffline:number}};
const minutes=(n:number)=>n*60_000;
export async function scheduleMaintenance(now=new Date()){
 const interval=minutes(Number(process.env.MAINTENANCE_INTERVAL_MINUTES||60));
 const teams=await db.team.findMany({select:{id:true}});
 const created=[];
 for(const team of teams){
  const recent=await db.job.findFirst({where:{type:'MAINTENANCE',targetId:team.id,OR:[{state:{in:['QUEUED','RUNNING','WAITING']}},{createdAt:{gt:new Date(now.getTime()-interval)}}]}});
  if(recent)continue;
  const owner=await db.membership.findFirst({where:{teamId:team.id,role:'ADMIN'},orderBy:{id:'asc'}});
  if(!owner)continue;
  try{created.push(await db.job.create({data:{teamId:team.id,actorId:owner.userId,type:'MAINTENANCE',targetId:team.id}}));}catch{/* 동시 예약은 one_active_job 인덱스가 막는다. */}
 }
 return created;
}
export async function queueMaintenance(actor:Actor){
 admin(actor);
 const active=await db.job.findFirst({where:{type:'MAINTENANCE',targetId:actor.teamId,state:{in:['QUEUED','RUNNING','WAITING']}}});
 return active||db.job.create({data:{teamId:actor.teamId,actorId:actor.userId,type:'MAINTENANCE',targetId:actor.teamId}});
}
async function checkRoots(teamId:string){
 const roots=await db.storageRoot.findMany({where:{teamId}});
 const result=[];
 for(const root of roots){
  let state='OFFLINE';
  try{if((await stat(root.path)).isDirectory())state='ONLINE';}catch{/* 접근 불가: 오프라인으로 표시하며 객체 삭제 근거로 쓰지 않는다. */}
  await db.storageRoot.update({where:{id:root.id},data:{state,checkedAt:new Date()}});
  result.push({id:root.id,name:root.name,kind:root.kind,state});
 }
 return result;
}
// 만료된 미확정 업로드: 상태를 EXPIRED로 바꾸고 임시 청크를 정리한다. 확정·확정 중 작업은 건드리지 않는다.
async function expireBatches(teamId:string,now:Date){
 const batches=await db.uploadBatch.findMany({where:{teamId,state:{in:['UPLOADING','FAILED']},expiresAt:{lt:now}},select:{id:true}});
 let count=0;
 for(const{id}of batches){
  const changed=await serial(async tx=>{
   await lock(tx,'upload_batches',id);
   const batch=await tx.uploadBatch.findUniqueOrThrow({where:{id}});
   if(!['UPLOADING','FAILED'].includes(batch.state)||batch.expiresAt>=now)return false;
   if(await tx.job.count({where:{type:'COMMIT',targetId:id,state:{in:['QUEUED','RUNNING','WAITING']}}}))return false;
   await tx.uploadBatch.update({where:{id},data:{state:'EXPIRED'}});
   await tx.uploadSession.updateMany({where:{batchId:id,state:{in:['UPLOADING','RECEIVED']}},data:{state:'EXPIRED'}});
   return true;
  });
  if(!changed)continue;
  count++;
  for(const s of await db.uploadSession.findMany({where:{batchId:id},select:{id:true,sizeBytes:true}}))await removeUploadParts(s.id,Math.max(1,Math.ceil(Number(s.sizeBytes)/CHUNK_SIZE)));
 }
 return count;
}
// 만료·취소된 묶음이 남긴 draft 버전을 ABANDONED로 표시하고, 그 버전만 참조하던 객체를 회수한다.
async function abandonDrafts(teamId:string){
 const batches=await db.uploadBatch.findMany({where:{teamId,state:{in:['EXPIRED','CANCELLED']}},select:{id:true,payload:true}});
 let drafts=0;const candidates=new Set<string>();
 for(const batch of batches){
  const ids=Object.values((batch.payload as {drafts?:Record<string,string>}).drafts||{});
  for(const s of await db.uploadSession.findMany({where:{batchId:batch.id,objectId:{not:null}},select:{objectId:true}}))candidates.add(s.objectId!);
  for(const versionId of ids){
   const done=await serial(async tx=>{
    const version=await tx.itemVersion.findUnique({where:{id:versionId},include:{archive:{include:{files:true}}}});
    if(!version||version.state!=='DRAFT')return false;
    await lock(tx,'archive_items',version.itemId);
    await tx.itemLink.updateMany({where:{fromVersionId:versionId},data:{active:false}});
    if(version.archive){
     await tx.archiveFile.updateMany({where:{archiveVersionId:version.archive.id},data:{active:false}});
     await tx.archiveVersion.update({where:{id:version.archive.id},data:{state:'DELETED'}});
     for(const f of version.archive.files)candidates.add(f.storageObjectId);
     if(version.archive.manifestObjectId)candidates.add(version.archive.manifestObjectId);
    }
    await tx.itemVersion.update({where:{id:versionId},data:{state:'ABANDONED'}});
    await tx.auditEvent.create({data:{teamId,actorId:version.createdBy,action:'DRAFT_ABANDONED',targetId:versionId}});
    return true;
   });
   if(done)drafts++;
  }
 }
 return {drafts,candidates};
}
async function expireDownloads(teamId:string,now:Date,candidates:Set<string>){
 const jobs=await db.job.findMany({where:{teamId,type:'DOWNLOAD',state:'COMPLETED'}});
 let count=0;
 for(const job of jobs){
  const result=job.result as {objectId?:string;expiresAt?:string;purged?:boolean}|null;
  if(!result?.objectId||result.purged||!result.expiresAt||new Date(result.expiresAt)>now)continue;
  const outcome=await purgeIfUnreferenced(result.objectId);
  if(outcome==='PURGED'||outcome==='SKIPPED'){await db.job.update({where:{id:job.id},data:{result:asJson({...result,purged:true})}});count++;}
  else candidates.add(result.objectId);
 }
 return count;
}
// 업로드·복사 도중 중단되어 STAGING으로 남은 객체(48시간 경과)를 회수 후보로 추가한다.
async function staleStagingObjects(teamId:string,now:Date,candidates:Set<string>){
 const rows=await db.storageObject.findMany({where:{teamId,state:{in:['STAGING','PURGING']},createdAt:{lt:new Date(now.getTime()-minutes(48*60))}},select:{id:true},take:1000});
 rows.forEach(r=>candidates.add(r.id));
}
async function verifyObjects(teamId:string,onlineRoots:Set<string>,assertLease:()=>Promise<void>,progress:Progress){
 const statLimit=Number(process.env.MAINTENANCE_STAT_LIMIT||5000),hashBudget=BigInt(process.env.MAINTENANCE_HASH_BYTES||String(2*1024**3));
 const objects=await db.storageObject.findMany({where:{teamId,state:{in:['AVAILABLE','MISSING']},root:{kind:{in:['ARCHIVE','PREVIEW']}}},include:{root:true},orderBy:[{verifiedAt:{sort:'asc',nulls:'first'}},{id:'asc'}],take:statLimit});
 const out={checked:0,hashed:0,missing:0,corrupt:0,recovered:0,skippedOffline:0};let budget=hashBudget;
 for(const object of objects){
  if(out.checked%200===0){await assertLease();await progress({phase:'integrity',checked:out.checked,total:objects.length});}
  if(!onlineRoots.has(object.rootId)){out.skippedOffline++;continue;}
  out.checked++;
  let state:'AVAILABLE'|'MISSING'|'CORRUPT'='AVAILABLE',hashed=false;
  try{
   const p=await safePath(object.root.path,object.objectKey);
   const info=await stat(p);
   if(!info.isFile()||BigInt(info.size)!==object.sizeBytes)state='CORRUPT';
   else if(budget>=object.sizeBytes||object.verifiedAt===null&&budget>0n){budget-=object.sizeBytes;hashed=true;out.hashed++;if(await fileHash(p)!==object.checksum)state='CORRUPT';}
  }catch(e){state=(e as NodeJS.ErrnoException).code==='ENOENT'?'MISSING':'CORRUPT';}
  // 상태 변화는 객체 행 잠금 아래에서 기록한다. 삭제가 진행 중인 객체(PURGING 등)는 건드리지 않는다.
  await serial(async tx=>{
   await lock(tx,'storage_objects',object.id);
   const current=await tx.storageObject.findUniqueOrThrow({where:{id:object.id}});
   if(!['AVAILABLE','MISSING'].includes(current.state))return;
   if(state==='AVAILABLE'){
    if(current.state==='MISSING'&&!hashed)return; // 다시 나타난 파일은 해시를 확인한 뒤에만 복구한다.
    await tx.storageObject.update({where:{id:object.id},data:{state:'AVAILABLE',...(hashed?{verifiedAt:new Date()}:{})}});
    if(current.state==='MISSING'){out.recovered++;await tx.auditEvent.create({data:{teamId,actorId:(await tx.membership.findFirstOrThrow({where:{teamId,role:'ADMIN'},orderBy:{id:'asc'}})).userId,action:'INTEGRITY_RECOVERED',targetId:object.id}});}
    return;
   }
   if(current.state===state)return;
   await tx.storageObject.update({where:{id:object.id},data:{state}});
   if(state==='MISSING')out.missing++;else out.corrupt++;
   await tx.auditEvent.create({data:{teamId,actorId:(await tx.membership.findFirstOrThrow({where:{teamId,role:'ADMIN'},orderBy:{id:'asc'}})).userId,action:'INTEGRITY_FAILED',targetId:object.id,detail:{state}}});
  });
 }
 return out;
}
export async function processMaintenance(actor:Actor,teamId:string,assertLease:()=>Promise<void>,progress:Progress=async()=>{}):Promise<MaintenanceResult>{
 admin(actor);
 const now=new Date();
 const staleLeases=(await db.fileLease.deleteMany({where:{expiresAt:{lt:new Date(now.getTime()-minutes(1))},object:{teamId}}})).count;
 const roots=await checkRoots(teamId);await progress({phase:'roots'});
 const expiredBatches=await expireBatches(teamId,now);await assertLease();
 const{drafts:abandonedDrafts,candidates}=await abandonDrafts(teamId);await assertLease();
 const expiredDownloads=await expireDownloads(teamId,now,candidates);
 await staleStagingObjects(teamId,now,candidates);
 let purgedObjects=0;
 for(const id of candidates){await assertLease();try{if(await purgeIfUnreferenced(id)==='PURGED')purgedObjects++;}catch{/* NAS 오류: 다음 점검에서 다시 시도한다. */}}
 await progress({phase:'purge',purgedObjects});
 const online=new Set(roots.filter(r=>r.state==='ONLINE').map(r=>r.id));
 const integrity=await verifyObjects(teamId,online,assertLease,progress);
 const result={staleLeases,roots:roots.map(r=>({name:r.name,state:r.state})),expiredBatches,abandonedDrafts,purgedObjects,expiredDownloads,integrity};
 await db.auditEvent.create({data:{teamId,actorId:actor.userId,action:'MAINTENANCE_COMPLETED',targetId:teamId,detail:asJson(result)}});
 return result;
}
// 관리자 화면: 저장소 상태, 객체 상태별 수, 문제 객체와 영향을 받는 자료.
export async function integrityReport(actor:Actor){
 admin(actor);
 const[roots,counts,problems,last]=await Promise.all([
  db.storageRoot.findMany({where:{teamId:actor.teamId},select:{id:true,name:true,kind:true,state:true,checkedAt:true}}),
  db.storageObject.groupBy({by:['state'],where:{teamId:actor.teamId},_count:true}),
  db.storageObject.findMany({where:{teamId:actor.teamId,state:{in:['MISSING','CORRUPT']}},take:100,include:{files:{where:{active:true},take:5,include:{archive:{include:{version:{include:{item:{select:{id:true,title:true}}}}}}}}}}),
  db.job.findFirst({where:{teamId:actor.teamId,type:'MAINTENANCE'},orderBy:{createdAt:'desc'}}),
 ]);
 return {roots,counts:Object.fromEntries(counts.map(c=>[c.state,c._count])),problems:problems.map(o=>({id:o.id,state:o.state,size:o.sizeBytes,verifiedAt:o.verifiedAt,affects:o.files.map(f=>({itemId:f.archive.version.item.id,title:f.archive.version.item.title,versionNo:f.archive.version.versionNo,path:f.relativePath}))})),lastRun:last};
}
