import { randomUUID } from 'node:crypto';
import { writeFile,readFile,unlink } from 'node:fs/promises';
import { db,serial,lock,asJson } from './db';
import { Actor,itemAccess } from './access';
import { batchInput,BatchInput } from './validation';
import { relativePath } from './paths';
import { unrealDecision,mimeFor,pluginRoots } from './policy';
import { hashJson,sha256,canonical } from './hash';
import { check } from './errors';
import { signatureMismatch,SIGNATURE_BYTES } from './signature';
import { CHUNK_SIZE,partPath,readParts,putObject,rootFor,availableSpace,objectLease,releaseLeases } from './storage';
type Payload={items:BatchInput['items'];drafts?:Record<string,string>};
type Planned={relativePath:string;canonicalPath:string;decision:string;reason:string;action:string;sizeBytes:bigint;resolution:string|null};
export async function createBatch(actor:Actor,raw:unknown){
 const input=batchInput.parse(raw),inputHash=hashJson(input);
 check(new Set(input.items.map(i=>i.itemId)).size===input.items.length,400,'DUPLICATE_ITEM','같은 항목이 업로드 묶음에 중복됩니다.');
 const existing=await db.uploadBatch.findUnique({where:{teamId_actorId_requestKey:{teamId:actor.teamId,actorId:actor.userId,requestKey:input.requestKey}}});
 if(existing){check(existing.inputHash===inputHash,409,'IDEMPOTENCY_CONFLICT','같은 요청 키의 내용이 다릅니다.');return batchStatus(actor,existing.id);}
 const storage=await rootFor(actor.teamId,'STAGING');
 await availableSpace(storage.path,input.items.flatMap(i=>i.files).reduce((n,f)=>n+BigInt(f.size),0n));
 const batchId=randomUUID();
 await serial(async tx=>{
  for(const id of input.items.map(i=>i.itemId).sort())await lock(tx,'archive_items',id);
  await tx.uploadBatch.create({data:{id:batchId,teamId:actor.teamId,actorId:actor.userId,requestKey:input.requestKey,inputHash,payload:asJson({items:input.items.map(i=>({...i,files:[]}))}),expiresAt:new Date(Date.now()+7*86400_000)}});
  for(const entry of input.items){
   const item=await itemAccess(actor,entry.itemId,'EDIT',tx);
   check(item.currentVersionId===entry.baseVersionId&&item.revision===entry.revision,409,'BASE_CHANGED','기준 버전이 변경되었습니다. 새로고침하세요.');
   check(entry.files.length>0||entry.removePaths.length>0||entry.replaceSources,400,'NO_FILE_CHANGE','파일 변경이 없는 경우 설명 저장을 사용하세요.');
   for(const target of entry.sourceVersionIds){const v=await tx.itemVersion.findUnique({where:{id:target},include:{item:true}});check(v?.state==='READY',400,'INVALID_SOURCE','공개된 소스 버전을 선택하세요.');await itemAccess(actor,v.itemId,'VIEW',tx);}
   for(const id of entry.sourceItemIds){check(input.items.some(i=>i.itemId===id)&&id!==item.id,400,'INVALID_SOURCE','배치 안의 다른 소스 항목을 선택하세요.');await itemAccess(actor,id,'VIEW',tx);}
   for(const key of Object.keys(entry.linkDetails||{}))check(entry.sourceVersionIds.includes(key)||entry.sourceItemIds.includes(key),400,'INVALID_LINK_DETAIL','연결하지 않은 소스의 확인 정보입니다.');
   const inherited=entry.baseVersionId?await tx.archiveFile.findMany({where:{active:true,archive:{itemVersionId:entry.baseVersionId,state:'VERIFIED'}}}):[];
   const rows=new Map<string,Planned>(inherited.map(f=>[f.canonicalPath,{relativePath:f.relativePath,canonicalPath:f.canonicalPath,decision:'INCLUDE',reason:'검증된 기준 버전에서 승계',action:'INHERIT',sizeBytes:f.sizeBytes,resolution:null}]));
   for(const rawPath of entry.removePaths){const p=relativePath(rawPath);check(rows.has(p.canonical),400,'UNKNOWN_REMOVE','기준 버전에 없는 제거 경로입니다.');rows.set(p.canonical,{...rows.get(p.canonical)!,decision:'EXCLUDE',reason:'새 버전에서 명시 제거',action:'REMOVE'});}
   const seen=new Set<string>(),plugins=pluginRoots([...inherited.map(f=>f.relativePath),...entry.files.map(f=>f.path)]);
   for(const file of entry.files){
    const p=relativePath(file.path);check(!seen.has(p.canonical),409,'DUPLICATE_PATH','같은 상대경로가 중복됩니다: '+p.path);seen.add(p.canonical);
    const policy=item.kind==='UNREAL_PROJECT'?unrealDecision(p.path,plugins):{decision:'INCLUDE',reason:'등록한 제작 결과물·소스'};
    const resolution=entry.decisions[p.canonical]||entry.decisions[p.path]||null;
    check(!resolution||policy.decision==='REVIEW'||resolution===policy.decision,400,'POLICY_OVERRIDE','확정 보존 규칙은 검토 파일에서만 변경할 수 있습니다.');
    rows.set(p.canonical,{relativePath:p.path,canonicalPath:p.canonical,decision:policy.decision,reason:policy.reason,action:inherited.some(f=>f.canonicalPath===p.canonical)?'REPLACE':'ADD',sizeBytes:BigInt(file.size),resolution});
   }
   const list=[...rows.values()],included=list.filter(r=>(r.resolution||r.decision)==='INCLUDE');
   if(item.kind==='UNREAL_PROJECT')check(included.some(r=>r.relativePath.toLowerCase().endsWith('.uproject')),400,'UPROJECT_REQUIRED','.uproject 파일은 보존해야 합니다.');
   const plan=await tx.archivePlan.create({data:{teamId:actor.teamId,actorId:actor.userId,batchId,baseVersionId:entry.baseVersionId,hash:hashJson(list),state:list.some(r=>r.decision==='REVIEW'&&!r.resolution)?'REVIEW':'READY',summary:asJson({itemId:item.id,files:list.length,bytes:included.reduce((n,r)=>n+r.sizeBytes,0n),excluded:list.filter(r=>(r.resolution||r.decision)==='EXCLUDE').length})}});
   for(let i=0;i<list.length;i+=1000)await tx.planEntry.createMany({data:list.slice(i,i+1000).map(r=>({...r,planId:plan.id}))});
   for(const file of entry.files){
    const p=relativePath(file.path),row=rows.get(p.canonical)!;
    if((row.resolution||row.decision)==='EXCLUDE')continue;
    await tx.uploadSession.create({data:{batchId,itemId:item.id,relativePath:p.path,canonicalPath:p.canonical,sizeBytes:BigInt(file.size),mime:mimeFor(p.path),checksum:file.checksum}});
   }
  }
 });
 return batchStatus(actor,batchId);
}
export async function ownedBatch(actor:Actor,id:string){
 const batch=await db.uploadBatch.findFirst({where:{id,teamId:actor.teamId,actorId:actor.userId}});
 check(batch,404,'NOT_FOUND','업로드 작업을 찾을 수 없습니다.');
 const payload=batch.payload as unknown as Payload;
 for(const item of payload.items)await itemAccess(actor,item.itemId,'EDIT');
 return {batch,payload};
}
export async function batchStatus(actor:Actor,id:string){
 const{batch}=await ownedBatch(actor,id);
 const[sessions,plans,jobs]=await Promise.all([
  db.uploadSession.findMany({where:{batchId:id},include:{parts:{select:{partNo:true,sizeBytes:true,checksum:true}}}}),
  db.archivePlan.findMany({where:{batchId:id},include:{entries:{orderBy:{relativePath:'asc'}}}}),
  db.job.findMany({where:{targetId:id,actorId:actor.userId},orderBy:{createdAt:'desc'},take:1})
 ]);
 const items=await db.archiveItem.findMany({where:{id:{in:(batch.payload as unknown as Payload).items.map(i=>i.itemId)}},select:{id:true,title:true,kind:true}});
 return {id,state:batch.state,expiresAt:batch.expiresAt,chunkSize:CHUNK_SIZE,result:batch.result,items,sessions:sessions.map(s=>({id:s.id,itemId:s.itemId,path:s.relativePath,size:s.sizeBytes,state:s.state,parts:s.parts})),plans,jobs};
}
export async function resolvePlan(actor:Actor,id:string,revision:number,decisions:Record<string,'INCLUDE'|'EXCLUDE'>){
 return serial(async tx=>{
  const plan=await tx.archivePlan.findFirst({where:{id,teamId:actor.teamId,actorId:actor.userId},include:{entries:true}});
  check(plan?.batchId,404,'NOT_FOUND','보존 계획을 찾을 수 없습니다.');
  await lock(tx,'upload_batches',plan.batchId);
  const batch=await tx.uploadBatch.findUniqueOrThrow({where:{id:plan.batchId}});
  check(batch.state==='UPLOADING'&&plan.revision===revision,409,'STALE_PLAN','보존 계획이 변경되었거나 확정 중입니다.');
  const itemId=(plan.summary as {itemId:string}).itemId;await itemAccess(actor,itemId,'EDIT',tx);
  for(const[path,decision]of Object.entries(decisions)){
   const p=relativePath(path),row=plan.entries.find(r=>r.canonicalPath===p.canonical);
   check(row?.decision==='REVIEW',400,'NOT_REVIEW','검토 대상으로 표시된 파일만 선택할 수 있습니다.');
   await tx.planEntry.update({where:{id:row.id},data:{resolution:decision}});
   await tx.uploadSession.updateMany({where:{batchId:plan.batchId,itemId,canonicalPath:p.canonical},data:{state:decision==='EXCLUDE'?'SKIPPED':'UPLOADING'}});
  }
  const rows=await tx.planEntry.findMany({where:{planId:id},orderBy:{canonicalPath:'asc'}});
  return tx.archivePlan.update({where:{id},data:{revision:{increment:1},hash:hashJson(rows.map(({id,planId,...r})=>r)),state:rows.some(r=>r.decision==='REVIEW'&&!r.resolution)?'REVIEW':'READY'}});
 });
}
export async function receivePart(actor:Actor,sessionId:string,partNo:number,bytes:Buffer){
 check(bytes.length<=CHUNK_SIZE,413,'PART_TOO_LARGE','업로드 청크가 너무 큽니다.');
 const session=await db.uploadSession.findUnique({where:{id:sessionId},include:{batch:true}});
 check(session,404,'NOT_FOUND','업로드 파일을 찾을 수 없습니다.');await ownedBatch(actor,session.batchId);
 check(session.batch.expiresAt>new Date(),410,'UPLOAD_EXPIRED','업로드가 만료되었습니다.');
 const expectedParts=Math.max(1,Math.ceil(Number(session.sizeBytes)/CHUNK_SIZE));
 check(Number.isInteger(partNo)&&partNo>=0&&partNo<expectedParts,400,'PART_RANGE','청크 번호가 파일 범위를 벗어납니다.');
 const expected=partNo===expectedParts-1?Number(session.sizeBytes)-partNo*CHUNK_SIZE:CHUNK_SIZE;
 check(bytes.length===expected,400,'PART_SIZE','청크 크기가 파일 목록과 다릅니다.');
 if(partNo===0)check(!signatureMismatch(session.relativePath,bytes.subarray(0,SIGNATURE_BYTES)),415,'SIGNATURE_MISMATCH','파일 내용이 확장자와 다른 형식입니다: '+session.relativePath);
 const checksum=sha256(bytes);
 return serial(async tx=>{
  await lock(tx,'upload_batches',session.batchId);await lock(tx,'upload_sessions',sessionId);
  const b=await tx.uploadBatch.findUniqueOrThrow({where:{id:session.batchId}});
  const s=await tx.uploadSession.findUniqueOrThrow({where:{id:sessionId}});
  check(b.state==='UPLOADING'&&s.state==='UPLOADING',409,'UPLOAD_CLOSED','전송할 수 없는 상태입니다.');
  const plan=await tx.archivePlan.findFirst({where:{batchId:b.id,summary:{path:['itemId'],equals:s.itemId}},include:{entries:{where:{canonicalPath:s.canonicalPath}}}});
  const row=plan?.entries[0];check(row&&(row.resolution||row.decision)==='INCLUDE',409,'REVIEW_REQUIRED','먼저 파일 보존 여부를 확정하세요.');
  const old=await tx.uploadPart.findUnique({where:{sessionId_partNo:{sessionId,partNo}}});
  if(old){check(old.checksum===checksum,409,'PART_CONFLICT','같은 청크 번호에 다른 내용이 있습니다.');return old;}
  const destination=await partPath(sessionId,partNo,true);
  try{await writeFile(destination,bytes,{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;check(sha256(await readFile(destination))===checksum,409,'PART_CONFLICT','임시 청크 내용이 다릅니다. 새 업로드를 시작하세요.');}
  return tx.uploadPart.create({data:{sessionId,partNo,sizeBytes:bytes.length,checksum}});
 });
}
export async function completeSession(actor:Actor,id:string){
 const s=await db.uploadSession.findUnique({where:{id},include:{parts:true}});check(s,404,'NOT_FOUND','업로드 파일을 찾을 수 없습니다.');
 await ownedBatch(actor,s.batchId);
 return serial(async tx=>{
 await lock(tx,'upload_batches',s.batchId);await lock(tx,'upload_sessions',id);
 const batch=await tx.uploadBatch.findUniqueOrThrow({where:{id:s.batchId}});
 const session=await tx.uploadSession.findUniqueOrThrow({where:{id},include:{parts:true}});
 check(batch.state==='UPLOADING',409,'UPLOAD_CLOSED','확정 중인 업로드입니다.');
 if(session.state==='RECEIVED')return {received:true};
 check(session.state==='UPLOADING',409,'UPLOAD_CLOSED','전송할 수 없는 파일입니다.');
 const count=Math.max(1,Math.ceil(Number(session.sizeBytes)/CHUNK_SIZE));
 check(session.parts.length===count&&session.parts.reduce((n,p)=>n+BigInt(p.sizeBytes),0n)===session.sizeBytes,409,'MISSING_PARTS','전송하지 않은 청크가 있습니다.');
 await tx.uploadSession.update({where:{id},data:{state:'RECEIVED'}});
 return {received:true};
 });
}
async function cleanupBatchParts(id:string){
 const batch=await db.uploadBatch.findUniqueOrThrow({where:{id}});
 if(!['COMMITTED','CANCELLED'].includes(batch.state))return;
 const parts=await db.uploadPart.findMany({where:{session:{batchId:id}},select:{sessionId:true,partNo:true}});
 for(const part of parts){try{await unlink(await partPath(part.sessionId,part.partNo));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')console.error('archive: 임시 청크 정리를 재확인해야 합니다.');}}
}
export async function registerSessionChecksum(actor:Actor,id:string,checksum:string){
 check(/^[a-f0-9]{64}$/.test(checksum),400,'INVALID_CHECKSUM','SHA-256 형식이 아닙니다.');
 const session=await db.uploadSession.findUnique({where:{id},include:{parts:true}});check(session,404,'NOT_FOUND','업로드 파일이 없습니다.');
 const{batch}=await ownedBatch(actor,session.batchId);check(batch.state==='UPLOADING',409,'UPLOAD_CLOSED','확정 중인 업로드입니다.');
 return serial(async tx=>{
 await lock(tx,'upload_batches',batch.id);await lock(tx,'upload_sessions',id);
 check((await tx.uploadBatch.findUniqueOrThrow({where:{id:batch.id}})).state==='UPLOADING',409,'UPLOAD_CLOSED','확정 중인 업로드입니다.');
 const session=await tx.uploadSession.findUniqueOrThrow({where:{id},include:{parts:true}});
 check(!session.checksum||session.checksum===checksum,409,'RESUME_FILE_CHANGED','처음 선택한 파일과 내용이 다릅니다. 원래 파일을 다시 선택하세요.');
 check(session.checksum||session.parts.length===0,409,'CHECKSUM_LATE','전송 전에 전체 파일 해시를 등록해야 합니다.');
 await tx.uploadSession.update({where:{id},data:{checksum}});return {verifiedInput:true};
 });
}
export async function commitBatch(actor:Actor,id:string,planHashes:Record<string,string>){
 return serial(async tx=>{
  await lock(tx,'upload_batches',id);
  const batch=await tx.uploadBatch.findFirst({where:{id,teamId:actor.teamId,actorId:actor.userId},include:{sessions:true}});
  check(batch,404,'NOT_FOUND','업로드 작업을 찾을 수 없습니다.');
  if(batch.state==='COMMITTED')return {state:batch.state,result:batch.result};
  const existing=await tx.job.findFirst({where:{targetId:id,type:'COMMIT',state:{in:['QUEUED','RUNNING']}}});
  if(existing)return {jobId:existing.id,state:existing.state};
  check(batch.state==='UPLOADING',409,'UPLOAD_CLOSED','취소되었거나 확정할 수 없는 업로드입니다.');
  check(batch.expiresAt>new Date(),410,'UPLOAD_EXPIRED','업로드가 만료되었습니다.');
  const payload=batch.payload as unknown as Payload;
  for(const e of [...payload.items].sort((a,b)=>a.itemId.localeCompare(b.itemId))){await lock(tx,'archive_items',e.itemId);const item=await itemAccess(actor,e.itemId,'EDIT',tx);check(item.currentVersionId===e.baseVersionId&&item.revision===e.revision,409,'BASE_CHANGED','기준 버전이 변경되었습니다.');}
  const plans=await tx.archivePlan.findMany({where:{batchId:id}});
  check(plans.every(p=>p.state==='READY'&&planHashes[p.id]===p.hash),409,'STALE_PLAN','보존 계획 또는 검토 결과를 다시 확인하세요.');
  check(batch.sessions.every(s=>s.state==='RECEIVED'||s.state==='SKIPPED'),409,'UPLOAD_INCOMPLETE','파일 전송을 모두 완료하세요.');
  const job=await tx.job.create({data:{teamId:actor.teamId,actorId:actor.userId,type:'COMMIT',targetId:id}});
  await tx.uploadBatch.update({where:{id},data:{state:'QUEUED'}});
  return {jobId:job.id,state:job.state};
 });
}
export async function cancelBatch(actor:Actor,id:string){
 await ownedBatch(actor,id);
 const result=await serial(async tx=>{
  await lock(tx,'upload_batches',id);
  const batch=await tx.uploadBatch.findUniqueOrThrow({where:{id}});
  check(batch.state==='UPLOADING',409,'CANCEL_UNAVAILABLE','확정 작업이 시작되면 취소할 수 없습니다.');
  await tx.uploadBatch.update({where:{id},data:{state:'CANCELLED'}});
  await tx.uploadSession.updateMany({where:{batchId:id},data:{state:'CANCELLED'}});
  return {cancelled:true};
 });
 await cleanupBatchParts(id);return result;
}
export async function processCommit(actor:Actor,batchId:string,assertLease:()=>Promise<void>,progress:(data:Record<string,unknown>)=>Promise<void>=async()=>{}){
 const{batch,payload}=await ownedBatch(actor,batchId);
 if(batch.state==='COMMITTED')return batch.result;
 check(['QUEUED','COMMITTING'].includes(batch.state),409,'UPLOAD_CLOSED','만료·취소된 업로드는 확정할 수 없습니다. 새로 등록하세요.');
 await db.uploadBatch.update({where:{id:batchId},data:{state:'COMMITTING'}});
 const versions=payload.drafts||Object.fromEntries(payload.items.map(e=>[e.itemId,randomUUID()]));
 await db.uploadBatch.update({where:{id:batchId},data:{payload:asJson({...payload,drafts:versions})}});
 const owner='commit:'+batchId;
 const inherited=await db.archiveFile.findMany({where:{archive:{itemVersionId:{in:payload.items.flatMap(i=>i.baseVersionId?[i.baseVersionId]:[])}},active:true}});
 await objectLease(inherited.map(f=>f.storageObjectId),owner);
 try{
  for(const e of payload.items){
   await assertLease();
   const item=await itemAccess(actor,e.itemId,'EDIT');
   const plan=await db.archivePlan.findFirstOrThrow({where:{batchId,summary:{path:['itemId'],equals:e.itemId}},include:{entries:true}});
   const rows=plan.entries.filter(r=>(r.resolution||r.decision)==='INCLUDE');
   check(rows.length>0,400,'EMPTY_VERSION','보존할 파일이 하나 이상 필요합니다.');
   const version=await db.itemVersion.upsert({where:{id:versions[e.itemId]},create:{id:versions[e.itemId],teamId:actor.teamId,itemId:e.itemId,baseVersionId:e.baseVersionId,createdBy:actor.userId,technicalMetadata:{schemaVersion:1},description:(e.versionDescription||'').trim()},update:{}});
   const archive=await db.archiveVersion.upsert({where:{itemVersionId:version.id},create:{teamId:actor.teamId,itemVersionId:version.id,planId:plan.id},update:{}});
   let done=0;
   for(const row of rows){
    await assertLease();await progress({phase:'copy',itemId:e.itemId,done:done++,total:rows.length});
    if(await db.archiveFile.count({where:{archiveVersionId:archive.id,canonicalPath:row.canonicalPath}}))continue;
    let object;
    const session=await db.uploadSession.findFirst({where:{batchId,itemId:e.itemId,canonicalPath:row.canonicalPath,state:{not:'SKIPPED'}}});
    if(session){
     const id=session.objectId||randomUUID();
     await db.uploadSession.update({where:{id:session.id},data:{objectId:id}});
     object=await putObject(actor.teamId,'ARCHIVE',await readParts(session.id,Math.max(1,Math.ceil(Number(session.sizeBytes)/CHUNK_SIZE))),id,assertLease);
     check(object.sizeBytes===session.sizeBytes&&(!session.checksum||object.checksum===session.checksum),409,'CHECKSUM_MISMATCH','업로드 파일 전체 크기·해시가 일치하지 않습니다.');
    }else{
     const base=inherited.find(f=>f.archiveVersionId&&f.canonicalPath===row.canonicalPath&&payload.items.find(i=>i.itemId===e.itemId)?.baseVersionId);
     const exact=e.baseVersionId?await db.archiveFile.findFirst({where:{archive:{itemVersionId:e.baseVersionId},canonicalPath:row.canonicalPath,active:true},include:{object:true}}):null;
     check(exact,409,'BASE_FILE_MISSING','승계할 파일이 없습니다.');object=exact.object;
    }
    await serial(async tx=>{await lock(tx,'storage_objects',object.id);const current=await tx.storageObject.findUniqueOrThrow({where:{id:object.id}});check(current.state==='AVAILABLE',409,'OBJECT_UNAVAILABLE','파일을 사용할 수 없습니다.');await tx.archiveFile.create({data:{teamId:actor.teamId,archiveVersionId:archive.id,relativePath:row.relativePath,canonicalPath:row.canonicalPath,storageObjectId:object.id,sizeBytes:object.sizeBytes,checksum:object.checksum,mime:mimeFor(row.relativePath)}});});
   }
   const files=await db.archiveFile.findMany({where:{archiveVersionId:archive.id},orderBy:{canonicalPath:'asc'}});
   const manifest={schemaVersion:1,itemId:item.id,versionId:version.id,planHash:plan.hash,policy:plan.policyVersion,files:files.map(f=>({path:f.relativePath,size:f.sizeBytes.toString(),sha256:f.checksum})),environment:e.unreal||null};
   const object=await putObject(actor.teamId,'ARCHIVE',Buffer.from(canonical(manifest)),archive.manifestObjectId||randomUUID(),assertLease);
   await db.archiveVersion.update({where:{id:archive.id},data:{manifestObjectId:object.id,manifestHash:object.checksum,fileCount:files.length,totalBytes:files.reduce((n,f)=>n+f.sizeBytes,0n)}});
   if(item.kind==='UNREAL_PROJECT'){
    const uproject=files.find(f=>f.relativePath.toLowerCase().endsWith('.uproject'));check(uproject,400,'UPROJECT_REQUIRED','.uproject이 필요합니다.');
    await db.unrealArchiveProfile.upsert({where:{versionId:version.id},create:{versionId:version.id,uprojectPath:uproject.relativePath,engineVersion:e.unreal?.engineVersion||'',environment:asJson(e.unreal||{notes:'환경 정보 미입력'})},update:{}});
   }
  }
  await assertLease();
  const result=await serial(async tx=>{
   for(const e of [...payload.items].sort((a,b)=>a.itemId.localeCompare(b.itemId)))await lock(tx,'archive_items',e.itemId);
   await lock(tx,'upload_batches',batchId);
   const output=[];
   for(const e of payload.items){
    const item=await itemAccess(actor,e.itemId,'EDIT',tx);
    check(item.currentVersionId===e.baseVersionId&&item.revision===e.revision,409,'BASE_CHANGED','확정 전에 기준 버전이 변경되었습니다.');
    const archive=await tx.archiveVersion.findUniqueOrThrow({where:{itemVersionId:versions[e.itemId]}});
    check(archive.manifestHash&&archive.fileCount>0,409,'ARCHIVE_INCOMPLETE','파일 검증이 완료되지 않았습니다.');
    const details=e.linkDetails||{};
    type LinkData={relation:string;evidence:string;confirmedBy:string|null;confirmedAt:Date|null};
    const linkData=new Map<string,LinkData>();
    const baseLinks=new Map(e.baseVersionId?(await tx.itemLink.findMany({where:{fromVersionId:e.baseVersionId,active:true}})).map(l=>[l.toVersionId,l]):[]);
    const explicit=(key:string,target:string):LinkData=>{
     const d=details[key],prior=baseLinks.get(target);
     if(d?.relation!=='USED_CONFIRMED')return {relation:'ASSOCIATED',evidence:d?.evidence||'',confirmedBy:null,confirmedAt:null};
     // 같은 근거로 이미 확인된 연결은 최초 확인자·시각을 유지한다.
     if(prior?.relation==='USED_CONFIRMED'&&prior.evidence===d.evidence)return {relation:'USED_CONFIRMED',evidence:d.evidence,confirmedBy:prior.confirmedBy,confirmedAt:prior.confirmedAt};
     return {relation:'USED_CONFIRMED',evidence:d.evidence,confirmedBy:actor.userId,confirmedAt:new Date()};
    };
    for(const id of e.sourceVersionIds)linkData.set(id,explicit(id,id));
    for(const id of e.sourceItemIds)linkData.set(versions[id],explicit(id,versions[id]));
    if(!e.replaceSources&&e.baseVersionId){
     // 승계한 연결은 기존 확인 정보(관계·근거·확인자)를 그대로 유지한다.
     for(const l of baseLinks.values())if(!linkData.has(l.toVersionId))linkData.set(l.toVersionId,{relation:l.relation,evidence:l.evidence,confirmedBy:l.confirmedBy,confirmedAt:l.confirmedAt});
    }
    for(const target of [...linkData.keys()].sort()){
     const v=await tx.itemVersion.findUniqueOrThrow({where:{id:target}});
     await lock(tx,'archive_items',v.itemId);await itemAccess(actor,v.itemId,'VIEW',tx);
     check(v.itemId!==item.id&&(v.state==='READY'||Object.values(versions).includes(v.id)),400,'INVALID_SOURCE','자기 자신 또는 미공개 소스는 연결할 수 없습니다.');
     await tx.itemLink.upsert({where:{fromVersionId_toVersionId:{fromVersionId:versions[e.itemId],toVersionId:target}},create:{teamId:actor.teamId,fromVersionId:versions[e.itemId],toVersionId:target,...linkData.get(target)!},update:{}});
    }
    const v=await tx.itemVersion.update({where:{id:versions[e.itemId]},data:{state:'READY',versionNo:item.nextVersionNo}});
    if(v.description)await tx.versionDescriptionRevision.create({data:{teamId:actor.teamId,versionId:v.id,actorId:actor.userId,revision:v.descriptionRevision,body:v.description}});
    await tx.archiveVersion.update({where:{id:archive.id},data:{state:'VERIFIED',verifiedAt:new Date()}});
    await tx.archiveItem.update({where:{id:item.id},data:{currentVersionId:v.id,nextVersionNo:{increment:1},revision:{increment:1}}});
    await tx.job.create({data:{teamId:actor.teamId,actorId:actor.userId,type:'PREVIEW',targetId:v.id}});
    await tx.auditEvent.create({data:{teamId:actor.teamId,actorId:actor.userId,action:'VERSION_COMMITTED',targetId:v.id,detail:{itemId:item.id,version:v.versionNo!.toString()}}});
    output.push({itemId:item.id,versionId:v.id,versionNo:v.versionNo!.toString()});
   }
   await tx.uploadBatch.update({where:{id:batchId},data:{state:'COMMITTED',result:asJson(output)}});
   await tx.uploadSession.updateMany({where:{batchId,state:'RECEIVED'},data:{state:'COMMITTED'}});
   return output;
  });
  await cleanupBatchParts(batchId);return result;
 }finally{await releaseLeases(owner);}
}

