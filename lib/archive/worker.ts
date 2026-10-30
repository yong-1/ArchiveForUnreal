import { randomUUID } from 'node:crypto';
import { db,serial,lock,asJson } from './db';
import { actorFor } from './access';
import { ArchiveError,check } from './errors';
import { processCommit } from './uploads';
import { processDelete } from './deletions';
import { processPreview } from './previews';
import { processDownload } from './downloads';
import { processScan,processImport } from './sources';
import { processRestore } from './restores';
import { processMaintenance } from './maintenance';
import { renewLeases } from './storage';
export async function jobEvent(jobId:string,kind:string,message='',data:Record<string,unknown>={}){
 try{await db.jobEvent.create({data:{jobId,kind,message:message.slice(0,2000),data:asJson(data)}});}catch{/* 진행 이력 기록 실패가 작업을 막지 않는다. */}
}
export async function runOne(owner=randomUUID()){
 const now=new Date();
 const job=await serial(async tx=>{
  const candidate=await tx.job.findFirst({where:{OR:[{state:'QUEUED'},{state:{in:['RUNNING','WAITING']},leaseUntil:{lt:now}}]},orderBy:{createdAt:'asc'}});
  if(!candidate)return null;
  await lock(tx,'jobs',candidate.id);
  const current=await tx.job.findUniqueOrThrow({where:{id:candidate.id}});
  if(current.state!=='QUEUED'&&(!['RUNNING','WAITING'].includes(current.state)||!current.leaseUntil||current.leaseUntil>=now))return null;
  return tx.job.update({where:{id:current.id},data:{state:'RUNNING',leaseOwner:owner,leaseUntil:new Date(Date.now()+60_000),fence:{increment:1},attempts:{increment:1},error:null}});
 });
 if(!job)return false;
 await jobEvent(job.id,'STARTED','',{attempt:job.attempts,fence:job.fence});
 let lastProgress=0;
 // 진행률은 현재 소유자(fence)만 기록하고 2초에 한 번으로 제한한다.
 const progress=async(data:Record<string,unknown>)=>{if(Date.now()-lastProgress<2000)return;lastProgress=Date.now();await db.job.updateMany({where:{id:job.id,state:'RUNNING',leaseOwner:owner,fence:job.fence},data:{progress:asJson({...data,at:new Date().toISOString()})}});};
 let leaseLost=false;
 const assertLease=async()=>{
  check(!leaseLost,409,'LEASE_LOST','작업 소유권이 변경되었습니다.');
  const active=await db.job.count({where:{id:job.id,state:'RUNNING',leaseOwner:owner,fence:job.fence,leaseUntil:{gt:new Date()}}});
  check(active===1,409,'LEASE_LOST','작업 소유권이 변경되었습니다.');
 };
 const heartbeat=setInterval(()=>{
  void(async()=>{
   const result=await db.job.updateMany({where:{id:job.id,state:'RUNNING',leaseOwner:owner,fence:job.fence},data:{leaseUntil:new Date(Date.now()+60_000)}});
   if(!result.count){leaseLost=true;return;}
   for(const prefix of ['commit:','preview:','zip:','restore:'])await renewLeases(prefix+(prefix==='zip:'||prefix==='restore:'?job.id:job.targetId));
  })().catch(()=>{leaseLost=true;});
 },10_000);
 try{
  const actor=await actorFor(job.actorId,job.teamId);
  let result:unknown;
  if(job.type==='COMMIT')result=await processCommit(actor,job.targetId,assertLease,progress);
  else if(job.type==='PREVIEW')result=await processPreview(actor,job.targetId,assertLease);
  else if(job.type==='DELETE')result=await processDelete(actor,job.targetId,assertLease);
  else if(job.type==='DOWNLOAD')result=await processDownload(actor,job.targetId,job.id,assertLease,progress);
  else if(job.type==='SCAN')result=await processScan(actor,job.targetId,job.input as never,assertLease);
  else if(job.type==='IMPORT')result=await processImport(actor,job.targetId,assertLease);
  else if(job.type==='RESTORE')result=await processRestore(actor,job.targetId,job.id,assertLease,progress);
  else if(job.type==='MAINTENANCE')result=await processMaintenance(actor,job.targetId,assertLease,progress);
  else throw new ArchiveError(400,'UNKNOWN_JOB','알 수 없는 작업 종류입니다.');
  await assertLease();
  const state=(result as {waiting?:boolean;partial?:boolean})?.waiting?'WAITING':(result as {partial?:boolean})?.partial?'FAILED':'COMPLETED';
  const done=await db.job.updateMany({where:{id:job.id,fence:job.fence,leaseOwner:owner,state:'RUNNING'},data:{state,result:asJson(result||{}),leaseUntil:state==='WAITING'?new Date(Date.now()+5000):null,error:state==='FAILED'?'일부 파일 처리에 실패했습니다. 작업 상세를 확인하고 재시도하세요.':null}});
  if(done.count)await jobEvent(job.id,state,'',state==='COMPLETED'?{}:{result:asJson(result||{})});
 }catch(e){
  if(e instanceof ArchiveError&&e.code==='LEASE_LOST')await jobEvent(job.id,'LEASE_LOST','작업 소유권을 잃어 결과를 기록하지 않았습니다.',{fence:job.fence});
  if(!(e instanceof ArchiveError&&e.code==='LEASE_LOST')){
   const message=e instanceof ArchiveError?e.message:'작업에 실패했습니다. 저장소와 서버 설정을 확인하세요.';
   const changed=await db.job.updateMany({where:{id:job.id,fence:job.fence,leaseOwner:owner,state:'RUNNING'},data:{state:'FAILED',error:message,leaseUntil:null}});
   if(changed.count)await jobEvent(job.id,'FAILED',message,{code:e instanceof ArchiveError?e.code:'INTERNAL'});
   if(changed.count&&job.type==='COMMIT')await db.uploadBatch.updateMany({where:{id:job.targetId,state:{not:'COMMITTED'}},data:{state:'FAILED'}});
  }
 }finally{clearInterval(heartbeat);}
 return true;
}
