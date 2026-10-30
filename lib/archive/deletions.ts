import { db,Database,serial,lock,asJson } from './db';
import { Actor,itemAccess } from './access';
import { hashJson } from './hash';
import { check,ArchiveError } from './errors';
import { safePath } from './paths';
import { hasReferences } from './storage';
import { unlink,lstat } from 'node:fs/promises';
type Scope='resultAndExclusiveSources'|'resultOnly';
type Snapshot={id:string;title:string;revision:number;currentVersionId:string|null};
type Plan={scope:Scope;rootId:string;items:Snapshot[];shared:{id:string;title:string;reason:string}[];objects:{id:string;size:string}[];versionIds:string[];fileIds:string[];links:string[];versions:{id:string;state:string;archiveId:string|null;archiveState:string|null}[];previews:{id:string;state:string}[];candidateIds:string[];logicalBytes:string;estimatedReclaim:string;hash:string};
async function computePlan(actor:Actor,id:string,scope:Scope,client:Database=db):Promise<Plan>{
 const root=await itemAccess(actor,id,'DELETE',client);
 check(await client.itemLink.count({where:{active:true,to:{itemId:id},from:{itemId:{not:id},item:{lifecycle:{not:'DELETED'}}}}})===0,409,'SHARED_REFERENCE_CONFLICT','이 결과물 자체가 다른 자료의 공유 소스입니다. 먼저 공유 소스 항목을 분리하세요.');
 const rootVersions=await client.itemVersion.findMany({where:{itemId:id},select:{id:true}});
 const links=await client.itemLink.findMany({where:{fromVersionId:{in:rootVersions.map(v=>v.id)},active:true},include:{to:{include:{item:true}}},orderBy:{id:'asc'}});
 const candidateIds=[...new Set(links.map(l=>l.to.itemId))].filter(i=>i!==id).sort();
 const selected=new Set([id,...(scope==='resultAndExclusiveSources'?candidateIds:[])]);
 const shared:Plan['shared']=[];
 const sharedIds=new Set<string>();
 let changed=true;
 while(changed){
  changed=false;
  for(const target of candidateIds){
   const item=links.find(l=>l.to.itemId===target)!.to.item;
   let reason='';
   if(scope==='resultOnly')reason='결과물만 삭제 선택';
   else if(item.managedIndependently||item.roles.includes('RESULT'))reason='독립 관리 또는 다른 제작 결과물';
   else if(await client.itemLink.count({where:{active:true,to:{itemId:target},from:{itemId:{notIn:[...selected]},item:{lifecycle:{not:'DELETED'}}}}}))reason='다른 결과물·과거 버전에서 참조';
   if(reason){if(selected.delete(target))changed=true;if(!sharedIds.has(target)){let title='접근 제한된 공유 소스';try{await itemAccess(actor,target,'VIEW',client);title=item.title;}catch{}shared.push({id:target,title,reason});sharedIds.add(target);}}
  }
 }
 for(const target of selected)await itemAccess(actor,target,'DELETE',client);
 const items=await client.archiveItem.findMany({where:{id:{in:[...selected]}},orderBy:{id:'asc'},select:{id:true,title:true,revision:true,currentVersionId:true}});
 const activeBatches=await client.uploadBatch.findMany({where:{teamId:actor.teamId,state:{in:['UPLOADING','QUEUED','COMMITTING']}}});
 check(!activeBatches.some(b=>(b.payload as {items:{itemId:string}[]}).items.some(i=>selected.has(i.itemId))),409,'UPLOAD_ACTIVE','진행 중인 업로드를 완료하거나 취소한 뒤 삭제하세요.');
 const versions=await client.itemVersion.findMany({where:{itemId:{in:[...selected]}},include:{archive:{include:{files:{where:{active:true}}}},previews:true},orderBy:{id:'asc'}});
 const versionIds=versions.map(v=>v.id),fileIds=versions.flatMap(v=>v.archive?.files.map(f=>f.id)||[]);
 const objectIds=new Set(versions.flatMap(v=>[...v.archive?.files.map(f=>f.storageObjectId)||[],...(v.archive?.manifestObjectId?[v.archive.manifestObjectId]:[]),...v.previews.flatMap(p=>p.objectId?[p.objectId]:[])]));
 const downloads=await client.job.findMany({where:{targetId:{in:versionIds},type:'DOWNLOAD'}});
 for(const job of downloads){const result=job.result as {objectId?:string}|null;if(result?.objectId)objectIds.add(result.objectId);}
 const objects=await client.storageObject.findMany({where:{id:{in:[...objectIds]}} ,orderBy:{id:'asc'}});
 let reclaim=0n;
 for(const object of objects){
  const other=await client.archiveFile.count({where:{storageObjectId:object.id,active:true,archive:{version:{itemId:{notIn:[...selected]}}}}});
  const otherPreview=await client.previewDerivative.count({where:{objectId:object.id,version:{itemId:{notIn:[...selected]}},state:{not:'DELETED'}}});
  if(!other&&!otherPreview)reclaim+=object.sizeBytes;
 }
 const affecting=await client.itemLink.findMany({where:{active:true,OR:[{fromVersionId:{in:versionIds}},{to:{itemId:{in:[id,...candidateIds]}}}]},orderBy:{id:'asc'},select:{id:true,fromVersionId:true,toVersionId:true}});
 const plan={
  scope,rootId:id,items,shared,objects:objects.map(o=>({id:o.id,size:o.sizeBytes.toString()})),versionIds,fileIds,
  links:affecting.filter(l=>versionIds.includes(l.fromVersionId)).map(l=>l.id),
  versions:versions.map(v=>({id:v.id,state:v.state,archiveId:v.archive?.id||null,archiveState:v.archive?.state||null})),
  previews:versions.flatMap(v=>v.previews.map(p=>({id:p.id,state:p.state}))),
  candidateIds,logicalBytes:versions.reduce((n,v)=>n+(v.archive?.totalBytes||0n),0n).toString(),estimatedReclaim:reclaim.toString()
 };
 return {...plan,hash:hashJson({plan,affecting})};
}
export async function createDeletePlan(actor:Actor,id:string,scope:Scope='resultAndExclusiveSources'){
 check(['resultAndExclusiveSources','resultOnly'].includes(scope),400,'INVALID_SCOPE','삭제 범위를 확인하세요.');
 const plan=await computePlan(actor,id,scope);
 return db.deleteRequest.create({data:{teamId:actor.teamId,actorId:actor.userId,itemId:id,scope,hash:plan.hash,plan:asJson(plan)}});
}
export async function confirmDelete(actor:Actor,id:string,hash:string,requestKey:string,confirmed:boolean){
 check(confirmed===true&&requestKey.length>=8&&requestKey.length<=100,400,'CONFIRM_REQUIRED','삭제 범위를 확인하고 명시적으로 삭제를 선택하세요.');
 const previous=await db.deleteRequest.findUnique({where:{teamId_actorId_requestKey:{teamId:actor.teamId,actorId:actor.userId,requestKey}}});
 if(previous){check(previous.id===id&&previous.hash===hash,409,'IDEMPOTENCY_CONFLICT','같은 삭제 요청 키의 대상이 다릅니다.');return deleteStatus(actor,previous.id);}
 await serial(async tx=>{
  await lock(tx,'delete_requests',id);
  const request=await tx.deleteRequest.findFirst({where:{id,teamId:actor.teamId,actorId:actor.userId}});
  check(request&&request.state==='PLANNED',409,'DELETE_CLOSED','삭제 계획을 새로 확인하세요.');
  const old=request.plan as unknown as Plan;
  for(const itemId of [...new Set([old.rootId,...old.candidateIds])].sort())await lock(tx,'archive_items',itemId);
  const fresh=await computePlan(actor,request.itemId,request.scope as Scope,tx);
  check(request.hash===hash&&fresh.hash===hash,409,'STALE_DELETE_PLAN','버전·연결·파일이 달라졌습니다. 삭제 범위를 다시 확인하세요.');
  const itemIds=old.items.map(i=>i.id);
  await tx.archiveItem.updateMany({where:{id:{in:itemIds}},data:{lifecycle:'DELETE_PENDING',currentVersionId:null,revision:{increment:1}}});
  await tx.itemLink.updateMany({where:{id:{in:old.links}},data:{active:false}});
  await tx.archiveFile.updateMany({where:{id:{in:old.fileIds}},data:{active:false}});
  await tx.archiveVersion.updateMany({where:{itemVersionId:{in:old.versionIds}},data:{state:'DELETE_PENDING'}});
  await tx.itemVersion.updateMany({where:{id:{in:old.versionIds}},data:{state:'DELETE_PENDING'}});
  await tx.previewDerivative.updateMany({where:{versionId:{in:old.versionIds}},data:{state:'DELETE_PENDING'}});
  await tx.job.updateMany({where:{targetId:{in:old.versionIds},type:{in:['PREVIEW','DOWNLOAD']},state:{in:['QUEUED','RUNNING','WAITING']}},data:{state:'CANCELLED',fence:{increment:1}}});
  for(const object of old.objects)await tx.deleteEntry.create({data:{requestId:id,objectId:object.id}});
  await tx.deleteRequest.update({where:{id},data:{state:'CONFIRMED',requestKey}});
  await tx.job.create({data:{teamId:actor.teamId,actorId:actor.userId,type:'DELETE',targetId:id}});
  await tx.auditEvent.create({data:{teamId:actor.teamId,actorId:actor.userId,action:'DELETE_CONFIRMED',targetId:id,detail:{scope:request.scope,items:itemIds,shared:old.shared.map(s=>s.id)}}});
 });
 return deleteStatus(actor,id);
}
export async function deleteStatus(actor:Actor,id:string){
 const request=await db.deleteRequest.findFirst({where:{id,teamId:actor.teamId,...(actor.role==='ADMIN'?{}:{actorId:actor.userId})},include:{entries:true}});
 check(request,404,'NOT_FOUND','삭제 작업을 찾을 수 없습니다.');
 await itemAccess(actor,request.itemId,'DELETE',db,true);
 return request;
}
export async function cancelDelete(actor:Actor,id:string){
 return serial(async tx=>{
  await lock(tx,'delete_requests',id);
  const request=await tx.deleteRequest.findFirst({where:{id,teamId:actor.teamId,actorId:actor.userId}});
  check(request,404,'NOT_FOUND','삭제 작업을 찾을 수 없습니다.');
  check(!request.startedAt&&['PLANNED','CONFIRMED'].includes(request.state),409,'CANCEL_UNAVAILABLE','물리 삭제가 시작되어 취소할 수 없습니다.');
  const plan=request.plan as unknown as Plan;
  for(const itemId of plan.items.map(i=>i.id).sort())await lock(tx,'archive_items',itemId);
  await itemAccess(actor,request.itemId,'DELETE',tx,true);
  if(request.state==='CONFIRMED'){
   for(const object of [...plan.objects].sort((a,b)=>a.id.localeCompare(b.id))){await lock(tx,'storage_objects',object.id);check((await tx.storageObject.findUnique({where:{id:object.id}}))?.state==='AVAILABLE',409,'CANCEL_UNAVAILABLE','공유 객체 정리가 시작되어 취소할 수 없습니다.');}
   for(const version of plan.versions){await tx.itemVersion.update({where:{id:version.id},data:{state:version.state}});if(version.archiveId)await tx.archiveVersion.update({where:{id:version.archiveId},data:{state:version.archiveState!}});}
   await tx.archiveFile.updateMany({where:{id:{in:plan.fileIds}},data:{active:true}});
   for(const preview of plan.previews)await tx.previewDerivative.update({where:{id:preview.id},data:{state:preview.state}});
   await tx.itemLink.updateMany({where:{id:{in:plan.links}},data:{active:true}});
   for(const item of plan.items)await tx.archiveItem.update({where:{id:item.id},data:{lifecycle:'ACTIVE',currentVersionId:item.currentVersionId,revision:{increment:1}}});
   await tx.job.updateMany({where:{type:'DELETE',targetId:id},data:{state:'CANCELLED',fence:{increment:1}}});
  }
  await tx.deleteRequest.update({where:{id},data:{state:'CANCELLED'}});
  return {cancelled:true};
 });
}
export async function processDelete(actor:Actor,id:string,assertLease:()=>Promise<void>){
 const request=await deleteStatus(actor,id);
 if(request.state==='COMPLETED')return {completed:true};
 check(['CONFIRMED','DELETING','PARTIAL','WAITING_FOR_LEASES','FAILED'].includes(request.state),409,'DELETE_CLOSED','삭제할 수 없는 상태입니다.');
 const plan=request.plan as unknown as Plan;
 await serial(async tx=>{await lock(tx,'delete_requests',id);const current=await tx.deleteRequest.findUniqueOrThrow({where:{id}});check(current.state!=='CANCELLED',409,'CANCELLED','취소한 작업입니다.');await tx.deleteRequest.update({where:{id},data:{state:'DELETING',startedAt:current.startedAt||new Date()}});});
 let waiting=false,failed=false;
 for(const entry of request.entries){
  await assertLease();if(entry.state==='PURGED'||entry.state==='RETAINED')continue;
  try{
   const decision=await serial(async tx=>{
    await lock(tx,'storage_objects',entry.objectId);
    const object=await tx.storageObject.findUnique({where:{id:entry.objectId},include:{root:true}});
    check(object&&object.teamId===actor.teamId,404,'OBJECT_MISSING','삭제 객체를 찾을 수 없습니다.');
    const refs=await Promise.all([
     tx.archiveFile.count({where:{storageObjectId:object.id,active:true}}),
     tx.archiveVersion.count({where:{manifestObjectId:object.id,state:{notIn:['DELETE_PENDING','DELETED']}}}),
     tx.previewDerivative.count({where:{objectId:object.id,state:{notIn:['DELETE_PENDING','DELETED']}}}),
     tx.uploadSession.count({where:{objectId:object.id,batch:{state:{in:['UPLOADING','QUEUED','COMMITTING']}}}})
    ]);
    if(refs.some(n=>n>0))return {kind:'RETAINED' as const,object};
    if(await tx.fileLease.count({where:{objectId:object.id,expiresAt:{gt:new Date()}}}))return {kind:'WAIT' as const,object};
    check(['ARCHIVE','PREVIEW','STAGING'].includes(object.root.kind),400,'ROOT_DENIED','제작 원본 저장소는 삭제할 수 없습니다.');
    await tx.storageObject.update({where:{id:object.id},data:{state:'PURGING'}});
    return {kind:'PURGE' as const,object};
   });
   if(decision.kind==='RETAINED'){await db.deleteEntry.update({where:{id:entry.id},data:{state:'RETAINED',reason:'다른 버전/항목/작업에서 참조'}});continue;}
   if(decision.kind==='WAIT'){waiting=true;continue;}
   const p=await safePath(decision.object.root.path,decision.object.objectKey);
   await assertLease();
   try{await unlink(p);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   try{await lstat(p);check(false,409,'FILE_STILL_PRESENT','NAS 파일이 남아 있습니다.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   await assertLease();
   await serial(async tx=>{await tx.storageObject.update({where:{id:entry.objectId},data:{state:'PURGED'}});await tx.deleteEntry.update({where:{id:entry.id},data:{state:'PURGED',purgedAt:new Date(),reason:null}});});
  }catch(e){
   if(e instanceof ArchiveError&&e.code==='LEASE_LOST')throw e;
   failed=true;await db.deleteEntry.update({where:{id:entry.id},data:{state:'FAILED',reason:'NAS 삭제/검증 실패. 연결·권한을 확인하고 재시도하세요.'}});
  }
 }
 await assertLease();
 if(failed||waiting){await db.deleteRequest.update({where:{id},data:{state:failed?'PARTIAL':'WAITING_FOR_LEASES'}});return {waiting:!failed,partial:failed};}
 await serial(async tx=>{
  await tx.archiveItem.updateMany({where:{id:{in:plan.items.map(i=>i.id)},lifecycle:'DELETE_PENDING'},data:{lifecycle:'DELETED'}});
  await tx.itemVersion.updateMany({where:{id:{in:plan.versionIds}},data:{state:'DELETED'}});
  await tx.archiveVersion.updateMany({where:{itemVersionId:{in:plan.versionIds}},data:{state:'DELETED'}});
  await tx.previewDerivative.updateMany({where:{versionId:{in:plan.versionIds}},data:{state:'DELETED'}});
  await tx.deleteRequest.update({where:{id},data:{state:'COMPLETED'}});
  await tx.auditEvent.create({data:{teamId:actor.teamId,actorId:actor.userId,action:'DELETE_COMPLETED',targetId:id,detail:{items:plan.items.map(i=>i.id),sharedPreserved:plan.shared.map(s=>s.id)}}});
 });
 return {completed:true,sharedPreserved:plan.shared.length};
}
