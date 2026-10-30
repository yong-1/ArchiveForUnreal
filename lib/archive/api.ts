import { z } from 'zod';
import { hash } from 'bcrypt-ts';
import { currentActor,admin,itemAccess,projectAccess,visibleProjects,Actor } from './access';
import { db,serial,asJson,lock } from './db';
import { json,route,sameOrigin,limitedJson,readLimited } from './http';
import { check } from './errors';
import { uuid,batchInput } from './validation';
import { bootstrap,setupStatus } from './bootstrap';
import { listItems,detail,saveMetadata,listDrafts,usedBy,metadataHistory,versionDescription,updateVersionDescription,updateMemo,memoHistory } from './catalog';
import { createBatch,batchStatus,receivePart,completeSession,commitBatch,cancelBatch,resolvePlan,ownedBatch,registerSessionChecksum } from './uploads';
import { createDeletePlan,confirmDelete,deleteStatus,cancelDelete } from './deletions';
import { fileContent,mediaContent,queueDownload,jobContent } from './downloads';
import { registerSource,queueScan,resolveSourcePlan,queueImport } from './sources';
import { queueRestore } from './restores';
import { CHUNK_SIZE } from './storage';
import { projectOverview,unrealOverview } from './overview';
import { verifyManifest } from './manifest';
import { POLICY_VERSION,POLICY_RULES } from './policy';
import { queueMaintenance,integrityReport } from './maintenance';
async function jobAccess(actor:Actor,id:string){
 const job=await db.job.findFirst({where:{id,actorId:actor.userId,teamId:actor.teamId}});check(job,404,'NOT_FOUND','작업을 찾을 수 없습니다.');
 if(job.type==='COMMIT')await ownedBatch(actor,job.targetId);
 else if(job.type==='DELETE')await deleteStatus(actor,job.targetId);
 else if(job.type==='SCAN')await itemAccess(actor,job.targetId,'EDIT');
 else if(job.type==='MAINTENANCE')admin(actor);
 else if(job.type==='IMPORT'){const plan=await db.archivePlan.findUniqueOrThrow({where:{id:job.targetId}});await itemAccess(actor,(plan.summary as {itemId:string}).itemId,'EDIT');}
 else{const v=await db.itemVersion.findUniqueOrThrow({where:{id:job.targetId}});await itemAccess(actor,v.itemId,job.type==='PREVIEW'?'VIEW':'DOWNLOAD');}
 return job;
}
export async function dispatch(req:Request,segments:string[]){
 return route(async()=>{
  sameOrigin(req);
  const url=new URL(req.url),method=req.method;
  const is=(verb:string,...parts:string[])=>method===verb&&parts.length===segments.length&&parts.every((p,i)=>p==='*'||p===segments[i]);
  const id=(index:number)=>uuid.parse(segments[index]);
  if(is('GET','setup'))return json(await setupStatus());
  if(is('POST','setup'))return json(await bootstrap(await limitedJson(req,32_000)),201);
  const actor=await currentActor(req);
  if(is('GET','context')){
   const[team,projects,categories,facilities,users,roots]=await Promise.all([
    db.team.findUnique({where:{id:actor.teamId},select:{id:true,name:true}}),
    db.productionProject.findMany({where:visibleProjects(actor),orderBy:{createdAt:'desc'},include:{access:{where:{membershipId:actor.membershipId}}}}),
    db.category.findMany({where:{teamId:actor.teamId},orderBy:{name:'asc'}}),
    db.facility.findMany({where:{teamId:actor.teamId},orderBy:{name:'asc'}}),
    db.membership.findMany({where:{teamId:actor.teamId},include:{user:{select:{id:true,name:true,email:true}}}}),
    db.storageRoot.findMany({where:{teamId:actor.teamId},select:{id:true,name:true,kind:true,state:true,...(actor.role==='ADMIN'?{path:true}:{})}})
   ]);
   return json({user:{id:actor.userId,name:actor.name,role:actor.role},team,projects,categories,facilities,users:users.map(m=>({id:m.user.id,name:m.user.name,email:actor.role==='ADMIN'?m.user.email:undefined,role:m.role,membershipId:m.id})),roots});
  }
  if(is('GET','items','drafts'))return json(await listDrafts(actor));
  if(is('GET','items'))return json(await listItems(actor,url.searchParams));
  if(is('POST','items'))return json(await saveMetadata(actor,await limitedJson(req)),201);
  if(is('GET','items','*'))return json(await detail(actor,id(1),url.searchParams.get('version')?uuid.parse(url.searchParams.get('version')):undefined));
  if(is('GET','items','*','versions'))return json((await detail(actor,id(1))).versions);
  if(is('GET','items','*','used-by'))return json(await usedBy(actor,id(1)));
  if(is('GET','items','*','revisions'))return json(await metadataHistory(actor,id(1)));
  if(is('GET','versions','*','description'))return json(await versionDescription(actor,id(1)));
  if(is('PATCH','versions','*','description')){const body=z.object({body:z.string().max(20_000),revision:z.number().int().positive()}).parse(await limitedJson(req));return json(await updateVersionDescription(actor,id(1),body.body,body.revision));}
  if(is('PATCH','memos','*')){const body=z.object({body:z.string().trim().min(1).max(20_000),revision:z.number().int().positive()}).parse(await limitedJson(req));return json(await updateMemo(actor,id(1),body.body,body.revision));}
  if(is('GET','memos','*','revisions'))return json(await memoHistory(actor,id(1)));
  if(is('PATCH','items','*'))return json(await saveMetadata(actor,await limitedJson(req),id(1)));
  if(is('GET','projects'))return json(await db.productionProject.findMany({where:visibleProjects(actor),orderBy:{createdAt:'desc'}}));
  if(is('POST','projects')){
   check(actor.role==='ADMIN'||actor.role==='EDITOR',403,'EDIT_DENIED','제작 건 등록 권한이 없습니다.');
   const data=z.object({title:z.string().trim().min(1).max(200),description:z.string().max(5000).default('')}).parse(await limitedJson(req));
   return json(await serial(async tx=>{const project=await tx.productionProject.create({data:{...data,teamId:actor.teamId}});await tx.projectAccess.create({data:{teamId:actor.teamId,projectId:project.id,membershipId:actor.membershipId,canEdit:true,canDelete:true}});return project;}),201);
  }
  if(is('GET','projects','*'))return json(await projectAccess(actor,id(1)));
  if(is('GET','projects','*','overview'))return json(await projectOverview(actor,id(1)));
  if(is('GET','unreal','*'))return json(await unrealOverview(actor,id(1)));
  if(is('GET','policies'))return json({version:POLICY_VERSION,rules:POLICY_RULES});
  if(is('GET','versions','*','manifest')){
   const v=await db.itemVersion.findFirst({where:{id:id(1),teamId:actor.teamId,state:'READY'}});check(v,404,'NOT_FOUND','버전을 찾을 수 없습니다.');
   await itemAccess(actor,v.itemId,'DOWNLOAD');return json(await verifyManifest(v.id));
  }
  if(is('POST','upload-batches'))return json(await createBatch(actor,await limitedJson(req,64*1024*1024)),201);
  if(is('GET','upload-batches'))return json(await db.uploadBatch.findMany({where:{teamId:actor.teamId,actorId:actor.userId,state:{notIn:['COMMITTED','CANCELLED']}},select:{id:true,state:true,createdAt:true},orderBy:{createdAt:'desc'},take:30}));
  if(is('GET','upload-batches','*'))return json(await batchStatus(actor,id(1)));
  if(is('POST','upload-batches','*','commit')){
   const body=z.object({planHashes:z.record(z.string(),z.string())}).parse(await limitedJson(req));
   return json(await commitBatch(actor,id(1),body.planHashes),202);
  }
  if(is('POST','upload-batches','*','cancel'))return json(await cancelBatch(actor,id(1)));
  // 파일 단위 세션 ID로도 취소할 수 있다. 버전은 묶음 단위로만 공개되므로 해당 묶음 전체를 취소한다.
  if(is('POST','uploads','*','cancel')){const session=await db.uploadSession.findUnique({where:{id:id(1)}});check(session,404,'NOT_FOUND','업로드 파일을 찾을 수 없습니다.');return json(await cancelBatch(actor,session.batchId));}
  if(is('PUT','uploads','*','parts','*')){
   const part=Number(segments[3]);return json(await receivePart(actor,id(1),part,await readLimited(req,CHUNK_SIZE)));
  }
  if(is('POST','uploads','*','complete'))return json(await completeSession(actor,id(1)));
  if(is('POST','uploads','*','checksum')){const body=z.object({checksum:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await limitedJson(req));return json(await registerSessionChecksum(actor,id(1),body.checksum));}
  if(is('GET','plans','*')){
   const plan=await db.archivePlan.findFirst({where:{id:id(1),teamId:actor.teamId,actorId:actor.userId},include:{entries:{orderBy:{relativePath:'asc'}}}});
   check(plan,404,'NOT_FOUND','보존 계획을 찾을 수 없습니다.');await itemAccess(actor,(plan.summary as {itemId:string}).itemId,'EDIT');
   return json(plan);
  }
  if(is('PATCH','plans','*')){
   const body=z.object({revision:z.number().int().positive(),decisions:z.record(z.string(),z.enum(['INCLUDE','EXCLUDE']))}).parse(await limitedJson(req));
   const plan=await db.archivePlan.findUnique({where:{id:id(1)}});check(plan,404,'NOT_FOUND','보존 계획이 없습니다.');
   return json(plan.batchId?await resolvePlan(actor,plan.id,body.revision,body.decisions):await resolveSourcePlan(actor,plan.id,body.revision,body.decisions));
  }
  if(is('POST','plans','*','execute')){
   const body=z.object({hash:z.string().length(64)}).parse(await limitedJson(req));return json(await queueImport(actor,id(1),body.hash),202);
  }
  if(is('POST','scans')){
   const body=z.object({itemId:uuid,rootId:uuid,relativePath:z.string().max(1024).default(''),baseVersionId:uuid.nullable(),revision:z.number().int().positive(),unreal:batchInput.shape.items.element.shape.unreal}).parse(await limitedJson(req));
   return json(await queueScan(actor,body.itemId,body),202);
  }
  if(is('POST','items','*','delete-plans')){
   const body=z.object({scope:z.enum(['resultAndExclusiveSources','resultOnly']).default('resultAndExclusiveSources')}).parse(await limitedJson(req));
   return json(await createDeletePlan(actor,id(1),body.scope),201);
  }
  if(is('POST','delete-requests')){
   const body=z.object({planId:uuid,hash:z.string().length(64),requestKey:z.string().min(8).max(100),confirmed:z.literal(true)}).parse(await limitedJson(req));
   return json(await confirmDelete(actor,body.planId,body.hash,body.requestKey,body.confirmed),202);
  }
  if(is('GET','delete-requests','*'))return json(await deleteStatus(actor,id(1)));
  if(is('POST','delete-requests','*','cancel'))return json(await cancelDelete(actor,id(1)));
  if((method==='GET'||method==='HEAD')&&segments[0]==='files'&&segments.length===3&&segments[2]==='content')return fileContent(actor,id(1),req);
  if((method==='GET'||method==='HEAD')&&segments[0]==='media'&&segments.length===2)return mediaContent(actor,id(1),req);
  if(is('POST','downloads')){
   const body=z.object({versionId:uuid}).parse(await limitedJson(req));return json(await queueDownload(actor,body.versionId),202);
  }
  if((method==='GET'||method==='HEAD')&&segments[0]==='downloads'&&segments.length===3&&segments[2]==='content')return jobContent(actor,id(1),req);
  if(is('GET','downloads','*')||is('GET','jobs','*'))return json(await jobAccess(actor,id(1)));
  if(is('GET','jobs','*','events')){await jobAccess(actor,id(1));return json(await db.jobEvent.findMany({where:{jobId:id(1)},orderBy:{createdAt:'asc'},take:200}));}
  if(is('GET','jobs')){
   const jobs=await db.job.findMany({where:{teamId:actor.teamId,actorId:actor.userId},orderBy:{createdAt:'desc'},take:100});
   const allowed=[];for(const job of jobs){try{await jobAccess(actor,job.id);allowed.push(job);}catch{}}return json(allowed);
  }
  if(is('POST','jobs','*','retry')){
   const job=await jobAccess(actor,id(1));check(job.state==='FAILED',409,'RETRY_UNAVAILABLE','실패한 작업만 재시도할 수 있습니다.');
   if(job.type==='COMMIT'){const batch=await db.uploadBatch.findUniqueOrThrow({where:{id:job.targetId}});check(batch.state==='FAILED'&&batch.expiresAt>new Date(),410,'UPLOAD_EXPIRED','만료된 업로드는 재시도할 수 없습니다. 새로 등록하세요.');}
   return json(await serial(async tx=>{await lock(tx,'jobs',job.id);if(job.type==='COMMIT')await tx.uploadBatch.update({where:{id:job.targetId},data:{state:'QUEUED'}});return tx.job.update({where:{id:job.id},data:{state:'QUEUED',error:null,leaseUntil:null}});}),202);
  }
  if(is('POST','versions','*','memos')){
   const body=z.object({body:z.string().trim().min(1).max(20_000)}).parse(await limitedJson(req));
   const version=await db.itemVersion.findUnique({where:{id:id(1)}});check(version?.state==='READY',404,'NOT_FOUND','버전을 찾을 수 없습니다.');await itemAccess(actor,version.itemId,'EDIT');
   return json(await db.memo.create({data:{teamId:actor.teamId,versionId:version.id,authorId:actor.userId,authorName:actor.name,body:body.body}}),201);
  }
  if(is('POST','restores')){
   const body=z.object({versionId:uuid}).parse(await limitedJson(req));return json(await queueRestore(actor,body.versionId),202);
  }
  if(is('POST','versions','*','validations')){
   admin(actor);
   const body=z.object({state:z.enum(['NOT_TESTED','ENVIRONMENT_MISSING','FAILED','PASSED']),report:z.string().min(30).max(20_000),engineVersion:z.string().min(1).max(100),evidenceSha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).parse(await limitedJson(req));
   const v=await db.itemVersion.findUnique({where:{id:id(1)},include:{archive:true}});check(v?.archive,404,'NOT_FOUND','보존 버전을 찾을 수 없습니다.');await itemAccess(actor,v.itemId,'EDIT');
   check(body.state!=='PASSED'||!!body.evidenceSha256,400,'EVIDENCE_REQUIRED','실제 에디터 열기 검증 보고서의 SHA-256을 입력하세요.');
   return json(await serial(async tx=>{const validation=await tx.restoreValidation.create({data:{archiveId:v.archive!.id,actorId:actor.userId,state:body.state,report:body.report,environment:asJson({schemaVersion:1,method:'OPERATOR_REPORT',engineVersion:body.engineVersion,evidenceSha256:body.evidenceSha256})}});await tx.unrealArchiveProfile.updateMany({where:{versionId:v.id},data:{validationStatus:body.state}});await tx.auditEvent.create({data:{teamId:actor.teamId,actorId:actor.userId,action:'OPERATOR_VALIDATION_RECORDED',targetId:v.id,detail:{validationId:validation.id}}});return validation;}),201);
  }
  if(is('GET','favorites')){
   const favorites=await db.favorite.findMany({where:{userId:actor.userId,item:{teamId:actor.teamId,lifecycle:'ACTIVE'}}});
   const result=[];for(const f of favorites){try{await itemAccess(actor,f.itemId);result.push(f.itemId);}catch{}}return json(result);
  }
  if(is('POST','favorites','*')){
   await itemAccess(actor,id(1));return json(await db.favorite.upsert({where:{userId_itemId:{userId:actor.userId,itemId:id(1)}},create:{userId:actor.userId,itemId:id(1)},update:{}}),201);
  }
  if(is('DELETE','favorites','*')){
   await itemAccess(actor,id(1));await db.favorite.deleteMany({where:{userId:actor.userId,itemId:id(1)}});return json({removed:true});
  }
  if(is('POST','admin','sources')){
   const body=z.object({name:z.string().min(1).max(100),path:z.string().min(1).max(1024)}).parse(await limitedJson(req));
   return json(await registerSource(actor,body.name,body.path),201);
  }
  if(is('POST','admin','users')){
   admin(actor);const body=z.object({name:z.string().min(1).max(80),email:z.email(),password:z.string().min(12).max(128),role:z.enum(['VIEWER','EDITOR','ADMIN'])}).parse(await limitedJson(req));
   const hashedPassword=await hash(body.password,12);
   return json(await serial(async tx=>{const user=await tx.user.create({data:{name:body.name,email:body.email.toLowerCase(),hashedPassword}});await tx.membership.create({data:{teamId:actor.teamId,userId:user.id,role:body.role}});return {id:user.id,name:user.name,email:user.email};}),201);
  }
  if(is('POST','admin','access')){
   admin(actor);const body=z.object({membershipId:uuid,projectId:uuid,canEdit:z.boolean(),canDelete:z.boolean(),canDownload:z.boolean()}).parse(await limitedJson(req));
   await projectAccess(actor,body.projectId);check(await db.membership.count({where:{id:body.membershipId,teamId:actor.teamId}})===1,400,'INVALID_MEMBER','팀원을 확인하세요.');
   return json(await db.projectAccess.upsert({where:{projectId_membershipId:{projectId:body.projectId,membershipId:body.membershipId}},create:{...body,teamId:actor.teamId},update:body}));
  }
  if(is('POST','admin','facilities')||is('POST','admin','categories')){
   admin(actor);const body=z.object({name:z.string().trim().min(1).max(100)}).parse(await limitedJson(req));
   return json(segments[1]==='facilities'?await db.facility.upsert({where:{teamId_name:{teamId:actor.teamId,name:body.name}},create:{teamId:actor.teamId,...body},update:{}}):await db.category.upsert({where:{teamId_name:{teamId:actor.teamId,name:body.name}},create:{teamId:actor.teamId,...body},update:{}}),201);
  }
  if(is('GET','admin','integrity'))return json(await integrityReport(actor));
  if(is('POST','admin','maintenance'))return json(await queueMaintenance(actor),202);
  if(is('GET','audit')){admin(actor);return json(await db.auditEvent.findMany({where:{teamId:actor.teamId},orderBy:{createdAt:'desc'},take:100}));}
  return json({error:{code:'NOT_FOUND',message:'요청한 기능을 찾을 수 없습니다.'}},404);
 });
}

