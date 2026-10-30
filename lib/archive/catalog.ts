import { createHmac,timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db,serial,lock,asJson,Database } from './db';
import { Actor,itemAccess,projectAccess,visibleProjects } from './access';
import { metadataInput } from './validation';
import { check } from './errors';
import { hashJson } from './hash';
const includeCard={category:true,keywords:{include:{keyword:true}},facilities:{include:{facility:true}},responsibles:{include:{user:{select:{id:true,name:true}}}},currentVersion:{include:{previews:{where:{state:'READY'}},archive:{select:{state:true,totalBytes:true,fileCount:true}},unreal:true}}} satisfies Prisma.ArchiveItemInclude;
export function card(item:Prisma.ArchiveItemGetPayload<{include:typeof includeCard}>){
 return {id:item.id,projectId:item.projectId,title:item.title,kind:item.kind,roles:item.roles,description:item.description,broadcastTitle:item.broadcastTitle,broadcastYear:item.broadcastYear,revision:item.revision,category:item.category,keywords:item.keywords.map(k=>k.keyword.name),facilityIds:item.facilities.map(f=>f.facilityId),facilities:item.facilities.map(f=>f.facility.name),responsibleIds:item.responsibles.map(r=>r.userId),responsibles:item.responsibles.map(r=>r.user.name),versionId:item.currentVersionId,versionNo:item.currentVersion?.versionNo,state:item.currentVersion?.archive?.state,totalBytes:item.currentVersion?.archive?.totalBytes,preview:item.currentVersion?.previews.find(p=>p.type==='POSTER'||p.type==='WEBP')?.id,proxy:item.currentVersion?.previews.find(p=>p.type==='AV1')?.id};
}
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeLike=(s:string)=>s.replace(/[\\%_]/g,'\\$&');
function signature(body:string){const secret=process.env.NEXTAUTH_SECRET;check(secret&&secret.length>=32,503,'AUTH_CONFIG','인증 키 설정이 필요합니다.');return createHmac('sha256',secret).update(body).digest('hex');}
export async function listItems(actor:Actor,params:URLSearchParams){
 const scope=(await db.productionProject.findMany({where:visibleProjects(actor),select:{id:true}})).map(p=>p.id).sort();
 const q=(params.get('q')||'').normalize('NFC').replace(/\s+/g,' ').trim();
 check([...q].length<=100,400,'INVALID_QUERY','검색어는 100자 이하여야 합니다.');
 const limit=Number(params.get('limit')||24);check(Number.isInteger(limit)&&limit>=1&&limit<=48,400,'INVALID_LIMIT','목록 크기는 1~48입니다.');
 const role=params.get('role')==='SOURCE'?'SOURCE':'RESULT';
 const filter:Prisma.ArchiveItemWhereInput={teamId:actor.teamId,projectId:{in:scope},lifecycle:'ACTIVE',roles:{has:role},currentVersion:{is:{state:'READY',archive:{is:{state:'VERIFIED'}}}}};
 if(params.get('kind')){check(['VIDEO','IMAGE','MODEL3D','FILE','UNREAL_PROJECT'].includes(params.get('kind')!),400,'INVALID_KIND','자료 유형이 올바르지 않습니다.');filter.kind=params.get('kind')!;}
 const year=params.get('year');if(year){check(year==='unknown'||/^\d{4}$/.test(year),400,'INVALID_YEAR','방송연도가 올바르지 않습니다.');filter.broadcastYear=year==='unknown'?null:Number(year);}
 const idParam=(key:string)=>{const v=params.get(key);if(!v)return null;check(uuidPattern.test(v),400,'INVALID_FILTER','필터 값이 올바르지 않습니다: '+key);return v;};
 const category=idParam('category'),facility=idParam('facility'),responsible=idParam('responsible'),project=idParam('project');
 if(category)filter.categoryId=category;
 if(params.get('favorites')==='true')filter.favorites={some:{userId:actor.userId}};
 if(project){check(scope.includes(project),404,'NOT_FOUND','제작 건을 찾을 수 없습니다.');filter.projectId=project;}
 if(facility)filter.facilities={some:{facilityId:facility}};
 if(responsible)filter.responsibles={some:{userId:responsible}};
 if(params.get('keyword'))filter.keywords={some:{keyword:{name:{equals:params.get('keyword')!,mode:'insensitive'}}}};
 if(q){const contains={contains:escapeLike(q),mode:'insensitive' as const};filter.OR=[{title:contains},{broadcastTitle:contains},{description:contains},{keywords:{some:{keyword:{name:contains}}}},{versions:{some:{memos:{some:{body:contains}}}}}];}
 const binding=hashJson({filter,limit,user:actor.userId,scope});
 let after:string|undefined;
 if(params.get('cursor')){
  const token=params.get('cursor')!;check(token.length<2048,400,'INVALID_CURSOR','잘못된 페이지 정보입니다.');
  const[encoded,sig]=token.split('.');check(!!encoded&&!!sig&&sig.length===64,400,'INVALID_CURSOR','잘못된 페이지 정보입니다.');
  check(timingSafeEqual(Buffer.from(sig),Buffer.from(signature(encoded))),400,'INVALID_CURSOR','페이지 정보가 변경되었습니다.');
  let decoded;try{decoded=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{check(false,400,'INVALID_CURSOR','페이지 정보를 읽을 수 없습니다.');}
  check(decoded.binding===binding&&typeof decoded.id==='string',400,'INVALID_CURSOR','필터 또는 권한이 달라졌습니다.');after=decoded.id;
  check(await db.archiveItem.count({where:{AND:[filter,{id:after}]}})>0,400,'INVALID_CURSOR','페이지 기준 자료가 변경되었습니다.');
 }
 const[items,totalCount,years]=await Promise.all([
  db.archiveItem.findMany({where:filter,include:includeCard,orderBy:[{broadcastYear:{sort:'desc',nulls:'last'}},{id:'desc'}],take:limit+1,...(after?{cursor:{id:after},skip:1}:{})}),
  db.archiveItem.count({where:filter}),
  db.archiveItem.groupBy({by:['broadcastYear'],where:{teamId:actor.teamId,projectId:{in:scope},lifecycle:'ACTIVE',roles:{has:role},currentVersion:{is:{state:'READY',archive:{is:{state:'VERIFIED'}}}}},_count:true,orderBy:{broadcastYear:'desc'}})
 ]);
 const more=items.length>limit,result=items.slice(0,limit);
 const encoded=more?Buffer.from(JSON.stringify({id:result.at(-1)!.id,binding})).toString('base64url'):null;
 return {items:result.map(card),nextCursor:encoded?encoded+'.'+signature(encoded):null,totalCount,years:years.map(y=>({year:y.broadcastYear,count:y._count}))};
}
async function setRelations(tx:Database,actor:Actor,itemId:string,input:z.infer<typeof metadataInput>){
 if(input.categoryId)check(await tx.category.count({where:{id:input.categoryId,teamId:actor.teamId}})===1,400,'INVALID_CATEGORY','종류를 확인하세요.');
 if(input.facilityIds.length)check(await tx.facility.count({where:{id:{in:input.facilityIds},teamId:actor.teamId}})===new Set(input.facilityIds).size,400,'INVALID_FACILITY','제작부조를 확인하세요.');
 if(input.responsibleIds.length)check(await tx.membership.count({where:{userId:{in:input.responsibleIds},teamId:actor.teamId}})===new Set(input.responsibleIds).size,400,'INVALID_RESPONSIBLE','담당자를 확인하세요.');
 await tx.itemKeyword.deleteMany({where:{itemId}});await tx.itemFacility.deleteMany({where:{itemId}});await tx.itemResponsible.deleteMany({where:{itemId}});
 for(const name of [...new Set(input.keywords.map(s=>s.normalize('NFC').trim()))]){
  const keyword=await tx.keyword.upsert({where:{teamId_name:{teamId:actor.teamId,name}},create:{teamId:actor.teamId,name},update:{}});
  await tx.itemKeyword.create({data:{teamId:actor.teamId,itemId,keywordId:keyword.id}});
 }
 await tx.itemFacility.createMany({data:[...new Set(input.facilityIds)].map(facilityId=>({teamId:actor.teamId,itemId,facilityId}))});
 await tx.itemResponsible.createMany({data:[...new Set(input.responsibleIds)].map(userId=>({teamId:actor.teamId,itemId,userId}))});
}
export async function saveMetadata(actor:Actor,raw:unknown,id?:string){
 const parsed=metadataInput.extend({revision:z.number().int().positive().optional()}).parse(raw);
 const{keywords,facilityIds,responsibleIds,revision,...data}=parsed;
 return serial(async tx=>{
  if(id)await lock(tx,'archive_items',id);
  const old=id?await itemAccess(actor,id,'EDIT',tx):null;await projectAccess(actor,data.projectId,'EDIT',tx);
  check(!old||old.revision===revision,409,'REVISION_CONFLICT','다른 담당자가 자료를 수정했습니다. 새로고침하세요.');
  check(!old||old.projectId===data.projectId,400,'PROJECT_IMMUTABLE','제작 건 이동은 지원하지 않습니다.');
  if(old?.currentVersionId)check(old.kind===data.kind,400,'KIND_IMMUTABLE','보존된 자료 유형은 변경할 수 없습니다.');
  const item=old?await tx.archiveItem.update({where:{id},data:{...data,revision:{increment:1}}}):await tx.archiveItem.create({data:{...data,teamId:actor.teamId}});
  await setRelations(tx,actor,item.id,parsed);
  await tx.metadataRevision.create({data:{itemId:item.id,actorId:actor.userId,revision:item.revision,snapshot:asJson({...parsed,revision:item.revision})}});
  await tx.auditEvent.create({data:{teamId:actor.teamId,actorId:actor.userId,action:old?'METADATA_UPDATED':'ITEM_CREATED',targetId:item.id}});
  return item;
 });
}
const names=new Map<string,string>();
async function userName(id:string){if(names.size>2000)names.clear();if(!names.has(id))names.set(id,(await db.user.findUnique({where:{id},select:{name:true}}))?.name||'알 수 없음');return names.get(id)!;}
export async function detail(actor:Actor,id:string,versionId?:string){
 const allowed=await itemAccess(actor,id);
 const item=await db.archiveItem.findUniqueOrThrow({where:{id},include:includeCard});
 const versions=await db.itemVersion.findMany({where:{itemId:id,state:'READY'},orderBy:{versionNo:'desc'},select:{id:true,versionNo:true,createdAt:true,description:true,unreal:true,archive:{select:{id:true,state:true,totalBytes:true,fileCount:true}}}});
 const chosen=versionId||item.currentVersionId;
 check(!chosen||versions.some(v=>v.id===chosen),404,'VERSION_NOT_FOUND','보존 버전을 찾을 수 없습니다.');
 const version=chosen?await db.itemVersion.findFirst({where:{id:chosen,itemId:id,state:'READY'},include:{previews:true,archive:{include:{files:{where:{active:true},take:1000,orderBy:{relativePath:'asc'}}}},memos:{orderBy:{createdAt:'desc'},take:200},unreal:true,outgoing:{where:{active:true},include:{to:{include:{item:true,archive:{select:{id:true,totalBytes:true,fileCount:true,state:true}},unreal:true}}}}}}):null;
 const sources=[];
 for(const link of version?.outgoing||[]){try{await itemAccess(actor,link.to.item.id);sources.push({id:link.id,versionId:link.to.id,versionNo:link.to.versionNo,itemId:link.to.itemId,title:link.to.item.title,kind:link.to.item.kind,relation:link.relation,evidence:link.evidence,confirmedBy:link.confirmedBy?await userName(link.confirmedBy):null,confirmedAt:link.confirmedAt,archive:link.to.archive,unreal:link.to.unreal});}catch{/* Restricted links are not disclosed. */}}
 const grant=actor.role==='ADMIN'?{canEdit:true,canDelete:true,canDownload:true}:await db.projectAccess.findUnique({where:{projectId_membershipId:{projectId:allowed.projectId,membershipId:actor.membershipId}}});
 return {...card(item),categoryId:item.categoryId,managedIndependently:item.managedIndependently,project:await db.productionProject.findUnique({where:{id:item.projectId},select:{id:true,title:true}}),versions,selectedVersion:version?{id:version.id,versionNo:version.versionNo,createdAt:version.createdAt,description:version.description,descriptionRevision:version.descriptionRevision,previews:version.previews.map(p=>({id:p.id,type:p.type,state:p.state,error:p.error,metadata:p.metadata})),files:version.archive?.files.map(f=>({id:f.id,path:f.relativePath,size:f.sizeBytes,mime:f.mime,checksum:f.checksum})),archiveId:version.archive?.id,fileCount:version.archive?.fileCount,totalBytes:version.archive?.totalBytes,unreal:version.unreal,memos:version.memos.map(m=>({id:m.id,body:m.body,authorId:m.authorId,authorName:m.authorName,createdAt:m.createdAt,updatedAt:m.updatedAt,revision:m.revision})),sources}:null,permissions:{edit:!!grant?.canEdit,delete:!!grant?.canDelete,download:!!grant?.canDownload&&actor.canDownload}};
}
// 첫 버전 보존 전(업로드 실패·취소 포함)의 항목. 홈에는 노출하지 않고 작업 화면에서 이어서 업로드하거나 등록을 취소한다.
export async function listDrafts(actor:Actor){
 const items=await db.archiveItem.findMany({where:{teamId:actor.teamId,lifecycle:'ACTIVE',currentVersionId:null,project:visibleProjects(actor)},orderBy:{createdAt:'desc'},take:100,select:{id:true,title:true,kind:true,createdAt:true,projectId:true}});
 const result=[];for(const item of items){try{await itemAccess(actor,item.id,'EDIT');result.push(item);}catch{/* 편집 권한이 없는 항목은 표시하지 않는다. */}}
 return result;
}

// AR-04: 이 소스(모든 버전)를 연결한 다른 항목의 버전. 권한이 없는 항목은 이름을 노출하지 않고 개수만 센다.
export async function usedBy(actor:Actor,id:string){
 await itemAccess(actor,id);
 const links=await db.itemLink.findMany({where:{teamId:actor.teamId,active:true,to:{itemId:id},from:{state:'READY',item:{lifecycle:'ACTIVE'}}},include:{to:{select:{versionNo:true}},from:{select:{id:true,versionNo:true,itemId:true,item:{select:{title:true,kind:true,currentVersionId:true,roles:true}}}}},orderBy:{id:'asc'},take:500});
 const visible=[];let restricted=0;const allowed=new Map<string,boolean>();
 for(const link of links){
  const itemId=link.from.itemId;
  if(!allowed.has(itemId)){try{await itemAccess(actor,itemId);allowed.set(itemId,true);}catch{allowed.set(itemId,false);}}
  if(!allowed.get(itemId)){restricted++;continue;}
  visible.push({itemId,title:link.from.item.title,kind:link.from.item.kind,roles:link.from.item.roles,versionId:link.from.id,versionNo:link.from.versionNo,current:link.from.item.currentVersionId===link.from.id,sourceVersionNo:link.to.versionNo,relation:link.relation,evidence:link.evidence});
 }
 return {items:visible,restricted};
}
// AR-14: 설명·분류 변경 이력. snapshot은 저장 시점의 입력값이다.
export async function metadataHistory(actor:Actor,id:string){
 await itemAccess(actor,id);
 const rows=await db.metadataRevision.findMany({where:{itemId:id},orderBy:{revision:'desc'},take:100});
 return Promise.all(rows.map(async r=>({revision:r.revision,createdAt:r.createdAt,actorName:await userName(r.actorId),snapshot:r.snapshot})));
}
async function readyVersion(actor:Actor,versionId:string,action:'VIEW'|'EDIT'){
 const version=await db.itemVersion.findFirst({where:{id:versionId,teamId:actor.teamId}});
 check(version?.state==='READY',404,'NOT_FOUND','버전을 찾을 수 없습니다.');
 await itemAccess(actor,version.itemId,action);
 return version;
}
export async function versionDescription(actor:Actor,versionId:string){
 const version=await readyVersion(actor,versionId,'VIEW');
 const history=await db.versionDescriptionRevision.findMany({where:{versionId},orderBy:{revision:'desc'},take:100});
 return {versionId,description:version.description,revision:version.descriptionRevision,history:await Promise.all(history.map(async h=>({revision:h.revision,body:h.body,createdAt:h.createdAt,actorName:await userName(h.actorId)})))};
}
// 파일 버전을 만들지 않는 설명 수정(VER-03). revision이 다르면 409.
export async function updateVersionDescription(actor:Actor,versionId:string,body:string,revision:number){
 await readyVersion(actor,versionId,'EDIT');
 return serial(async tx=>{
  const rows=await tx.$queryRawUnsafe<{descriptionRevision:number;description:string}[]>('SELECT "descriptionRevision","description" FROM "item_versions" WHERE id=$1::uuid FOR UPDATE',versionId);
  const current=rows[0];check(current,404,'NOT_FOUND','버전을 찾을 수 없습니다.');
  check(current.descriptionRevision===revision,409,'REVISION_CONFLICT','다른 담당자가 버전 설명을 수정했습니다. 새로고침하세요.');
  const text=body.trim();
  if(text===current.description)return {versionId,description:text,revision};
  const next=revision+1;
  const updated=await tx.itemVersion.update({where:{id:versionId},data:{description:text,descriptionRevision:next}});
  await tx.versionDescriptionRevision.create({data:{teamId:actor.teamId,versionId,actorId:actor.userId,revision:next,body:text}});
  await tx.auditEvent.create({data:{teamId:actor.teamId,actorId:actor.userId,action:'VERSION_DESCRIPTION_UPDATED',targetId:versionId,detail:{revision:next}}});
  return {versionId,description:updated.description,revision:updated.descriptionRevision};
 });
}
async function memoAccess(actor:Actor,memoId:string,edit:boolean){
 const memo=await db.memo.findFirst({where:{id:memoId,teamId:actor.teamId}});
 check(memo,404,'NOT_FOUND','메모를 찾을 수 없습니다.');
 await readyVersion(actor,memo.versionId,edit?'EDIT':'VIEW');
 check(!edit||memo.authorId===actor.userId||actor.role==='ADMIN',403,'MEMO_OWNER_ONLY','작성자나 관리자만 메모를 수정할 수 있습니다.');
 return memo;
}
export async function updateMemo(actor:Actor,memoId:string,body:string,revision:number){
 await memoAccess(actor,memoId,true);
 return serial(async tx=>{
  await tx.$queryRawUnsafe('SELECT id FROM "memos" WHERE id=$1::uuid FOR UPDATE',memoId);
  const memo=await tx.memo.findUniqueOrThrow({where:{id:memoId}});
  check(memo.revision===revision,409,'REVISION_CONFLICT','다른 담당자가 메모를 수정했습니다. 새로고침하세요.');
  // 이전 본문을 잃지 않도록 첫 수정 때 원문을 1번 이력으로 남긴다.
  if(await tx.memoRevision.count({where:{memoId}})===0)await tx.memoRevision.create({data:{memoId,actorId:memo.authorId,revision:memo.revision,body:memo.body,createdAt:memo.createdAt}});
  const updated=await tx.memo.update({where:{id:memoId},data:{body:body.trim(),revision:{increment:1},updatedAt:new Date()}});
  await tx.memoRevision.create({data:{memoId,actorId:actor.userId,revision:updated.revision,body:updated.body}});
  await tx.auditEvent.create({data:{teamId:actor.teamId,actorId:actor.userId,action:'MEMO_UPDATED',targetId:memoId,detail:{revision:updated.revision}}});
  return updated;
 });
}
export async function memoHistory(actor:Actor,memoId:string){
 const memo=await memoAccess(actor,memoId,false);
 const rows=await db.memoRevision.findMany({where:{memoId},orderBy:{revision:'desc'}});
 return {memoId,revision:memo.revision,history:await Promise.all(rows.map(async r=>({revision:r.revision,body:r.body,createdAt:r.createdAt,actorName:await userName(r.actorId)})))};
}
