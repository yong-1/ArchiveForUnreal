import path from 'node:path';
import { lstat,readdir,open } from 'node:fs/promises';
import { db,serial,lock,asJson } from './db';
import { Actor,admin,itemAccess } from './access';
import { safePath,relativePath,rootsSeparate } from './paths';
import { check } from './errors';
import { hashJson } from './hash';
import { unrealDecision,mimeFor,pluginRoots } from './policy';
import type { BatchInput } from './validation';
import { createBatch,batchStatus,receivePart,completeSession,commitBatch } from './uploads';
import { CHUNK_SIZE } from './storage';
type ScanInput={rootId:string;relativePath:string;baseVersionId:string|null;revision:number;unreal?:BatchInput['items'][number]['unreal']};
export async function registerSource(actor:Actor,name:string,sourcePath:string){
 admin(actor);check(name.length>0&&name.length<=100,400,'INVALID_NAME','저장소 이름을 입력하세요.');
 let allowed:string[];try{allowed=JSON.parse(process.env.SOURCE_ROOTS||'[]');}catch{check(false,503,'SOURCE_CONFIG','SOURCE_ROOTS 설정을 확인하세요.');}
 const resolved=path.resolve(sourcePath);
 check(Array.isArray(allowed)&&allowed.some(p=>path.resolve(p).toLowerCase()===resolved.toLowerCase()),403,'SOURCE_NOT_APPROVED','SOURCE_ROOTS에 먼저 승인된 원본 경로를 설정하세요.');
 const others=await db.storageRoot.findMany({where:{teamId:actor.teamId}});
 check(rootsSeparate([resolved,...others.filter(r=>r.kind!=='SOURCE').map(r=>r.path)]),400,'OVERLAPPING_ROOTS','원본과 보존/임시 저장소는 분리해야 합니다.');
 const stat=await lstat(resolved);check(stat.isDirectory()&&!stat.isSymbolicLink(),400,'UNSAFE_ROOT','실제 디렉터리만 등록할 수 있습니다.');
 return db.storageRoot.create({data:{teamId:actor.teamId,name,kind:'SOURCE',path:resolved}});
}
export async function queueScan(actor:Actor,itemId:string,input:ScanInput){
 await itemAccess(actor,itemId,'EDIT');
 if(input.relativePath)relativePath(input.relativePath);
 const root=await db.storageRoot.findFirst({where:{id:input.rootId,teamId:actor.teamId,kind:'SOURCE'}});
 check(root,404,'NOT_FOUND','승인 원본 저장소를 찾을 수 없습니다.');
 check(await db.job.count({where:{teamId:actor.teamId,type:'SCAN',state:{in:['QUEUED','RUNNING']},input:{path:['rootId'],equals:root.id}}})===0,409,'SCAN_ACTIVE','이 원본 저장소를 조사 중입니다.');
 return db.job.create({data:{teamId:actor.teamId,actorId:actor.userId,type:'SCAN',targetId:itemId,input:asJson(input)}});
}
async function snapshot(root:string,folder:string,assertLease:()=>Promise<void>){
 const directory=folder?await safePath(root,folder):root;
 const stat=await lstat(directory);check(stat.isDirectory()&&!stat.isSymbolicLink(),400,'UNSAFE_DIRECTORY','조사할 실제 폴더를 선택하세요.');
 const files:{path:string;size:string;mtime:string}[]=[];
 async function visit(dir:string,prefix:string){
  await assertLease();
  const entries=await readdir(dir,{withFileTypes:true});
  for(const entry of entries){
   const relative=prefix?prefix+'/'+entry.name:entry.name;
   const p=relativePath(relative);
   const actual=await safePath(directory,p.path);
   const info=await lstat(actual);
   check(!info.isSymbolicLink(),409,'SYMLINK_REVIEW','원본의 링크/외부 경로는 별도 자료로 명시 등록하세요.');
   if(info.isDirectory())await visit(actual,p.path);
   else if(info.isFile()){check(files.length<100_000,413,'SCAN_LIMIT','한 번에 100,000개 파일까지 조사합니다. 범위를 나눠 주세요.');files.push({path:p.path,size:String(info.size),mtime:String(info.mtimeMs)});}
  }
 }
 await visit(directory,'');
 return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function processScan(actor:Actor,itemId:string,input:ScanInput,assertLease:()=>Promise<void>){
 const item=await itemAccess(actor,itemId,'EDIT');
 check(item.revision===input.revision&&item.currentVersionId===input.baseVersionId,409,'BASE_CHANGED','기준 버전이 바뀌었습니다.');
 const root=await db.storageRoot.findFirst({where:{id:input.rootId,teamId:actor.teamId,kind:'SOURCE'}});check(root,404,'ROOT_MISSING','원본 저장소를 찾을 수 없습니다.');
 const files=await snapshot(root.path,input.relativePath,assertLease);
 check(files.length>0,400,'EMPTY_SOURCE','조사한 폴더에 파일이 없습니다.');
 const plugins=pluginRoots(files.map(f=>f.path));
 const rows=files.map(f=>{const p=relativePath(f.path),decision=item.kind==='UNREAL_PROJECT'?unrealDecision(p.path,plugins):{decision:'INCLUDE',reason:'등록한 제작 자료'};return {relativePath:p.path,canonicalPath:p.canonical,sizeBytes:BigInt(f.size),sourceMtime:f.mtime,decision:decision.decision,reason:decision.reason,action:'ADD'};});
 const hash=hashJson(rows),summary={itemId,unreal:input.unreal||null,sourceRootId:root.id,sourceRelativePath:input.relativePath,baseVersionId:input.baseVersionId,itemRevision:item.revision,snapshotHash:hashJson(files),fileCount:rows.length,totalBytes:rows.reduce((n,r)=>n+r.sizeBytes,0n).toString()};
 const plan=await db.archivePlan.create({data:{teamId:actor.teamId,actorId:actor.userId,baseVersionId:item.currentVersionId,hash,state:rows.some(r=>r.decision==='REVIEW')?'REVIEW':'READY',summary}});
 for(let n=0;n<rows.length;n+=1000)await db.planEntry.createMany({data:rows.slice(n,n+1000).map(r=>({...r,planId:plan.id}))});
 await assertLease();
 return {planId:plan.id,fileCount:rows.length,totalBytes:summary.totalBytes};
}
export async function resolveSourcePlan(actor:Actor,id:string,revision:number,decisions:Record<string,'INCLUDE'|'EXCLUDE'>){
 return serial(async tx=>{
  const plan=await tx.archivePlan.findFirst({where:{id,teamId:actor.teamId,actorId:actor.userId},include:{entries:true}});check(plan&&!plan.batchId,404,'NOT_FOUND','원본 보존 계획을 찾을 수 없습니다.');
  const summary=plan.summary as {itemId:string};
  await lock(tx,'archive_items',summary.itemId);await itemAccess(actor,summary.itemId,'EDIT',tx);
  check(plan.revision===revision&&['REVIEW','READY'].includes(plan.state),409,'STALE_PLAN','계획이 변경되었습니다.');
  for(const[p,decision]of Object.entries(decisions)){const row=plan.entries.find(r=>r.canonicalPath===relativePath(p).canonical);check(row?.decision==='REVIEW',400,'NOT_REVIEW','검토 파일만 선택할 수 있습니다.');await tx.planEntry.update({where:{id:row.id},data:{resolution:decision}});}
  const entries=await tx.planEntry.findMany({where:{planId:id},orderBy:{canonicalPath:'asc'}});
  return tx.archivePlan.update({where:{id},data:{revision:{increment:1},hash:hashJson(entries.map(({id,planId,...r})=>r)),state:entries.some(e=>e.decision==='REVIEW'&&!e.resolution)?'REVIEW':'READY'}});
 });
}
export async function queueImport(actor:Actor,id:string,hash:string){
 const plan=await db.archivePlan.findFirst({where:{id,teamId:actor.teamId,actorId:actor.userId}});
 check(plan&&plan.state==='READY'&&plan.hash===hash&&!plan.batchId,409,'STALE_PLAN','보존 계획을 다시 확인하세요.');
 const summary=plan.summary as {itemId:string};await itemAccess(actor,summary.itemId,'EDIT');
 const existing=await db.job.findFirst({where:{type:'IMPORT',targetId:id,state:{in:['QUEUED','RUNNING','COMPLETED']}}});if(existing)return existing;
 return db.job.create({data:{teamId:actor.teamId,actorId:actor.userId,type:'IMPORT',targetId:id}});
}
export async function processImport(actor:Actor,id:string,assertLease:()=>Promise<void>){
 const plan=await db.archivePlan.findFirst({where:{id,teamId:actor.teamId,actorId:actor.userId},include:{entries:true}});
 check(plan?.state==='READY',409,'PLAN_NOT_READY','보존 계획이 준비되지 않았습니다.');
 const summary=plan.summary as {itemId:string;sourceRootId:string;sourceRelativePath:string;baseVersionId:string|null;itemRevision:number;snapshotHash:string;unreal?:BatchInput['items'][number]['unreal']};
 const root=await db.storageRoot.findUniqueOrThrow({where:{id:summary.sourceRootId}});
 check(root.kind==='SOURCE'&&root.teamId===actor.teamId,403,'SOURCE_DENIED','승인된 원본 루트가 아닙니다.');
 const before=await snapshot(root.path,summary.sourceRelativePath,assertLease);
 check(hashJson(before)===summary.snapshotHash,409,'SOURCE_CHANGED','조사 후 원본이 변경되었습니다. 다시 조사하세요.');
 const included=plan.entries.filter(e=>(e.resolution||e.decision)==='INCLUDE');
 const batch=await createBatch(actor,{requestKey:'nas-import:'+id,items:[{itemId:summary.itemId,baseVersionId:summary.baseVersionId,revision:summary.itemRevision,unreal:summary.unreal||undefined,files:included.map(e=>({path:e.relativePath,size:e.sizeBytes.toString(),mime:mimeFor(e.relativePath)})),decisions:Object.fromEntries(included.filter(e=>e.decision==='REVIEW').map(e=>[e.canonicalPath,'INCLUDE']))}]});
 for(const session of batch.sessions){
  if(['RECEIVED','COMMITTED'].includes(session.state))continue;
  await assertLease();
  const original=await safePath(root.path,[summary.sourceRelativePath,session.path].filter(Boolean).join('/'));
  const handle=await open(original,'r');
  try{
   const count=Math.max(1,Math.ceil(Number(session.size)/CHUNK_SIZE));
   for(let part=0;part<count;part++){
    await assertLease();if(session.parts.some(p=>p.partNo===part))continue;
    const length=Math.min(CHUNK_SIZE,Number(session.size)-part*CHUNK_SIZE),buffer=Buffer.alloc(length);let read=0;
    while(read<length){const result=await handle.read(buffer,read,length-read,part*CHUNK_SIZE+read);check(result.bytesRead>0,409,'SOURCE_CHANGED','읽는 중 원본 크기가 변경되었습니다.');read+=result.bytesRead;}
    await receivePart(actor,session.id,part,buffer);
   }
  }finally{await handle.close();}
  await completeSession(actor,session.id);
 }
 const after=await snapshot(root.path,summary.sourceRelativePath,assertLease);
 check(hashJson(after)===summary.snapshotHash,409,'SOURCE_CHANGED','복사하는 동안 원본이 변경되어 확정하지 않았습니다.');
 const latest=await batchStatus(actor,batch.id);
 const result=await commitBatch(actor,batch.id,Object.fromEntries(latest.plans.map(p=>[p.id,p.hash])));
 return {batchId:batch.id,...result};
}

