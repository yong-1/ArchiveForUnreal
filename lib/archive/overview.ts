// 제작 건 상세(/archive/projects/[id])와 Unreal 보존 상세(/archive/unreal/[id]) 조회.
import { db } from './db';
import { Actor,projectAccess,itemAccess } from './access';
import { check } from './errors';
import { POLICY_VERSION } from './policy';
export async function projectOverview(actor:Actor,projectId:string){
 const project=await projectAccess(actor,projectId);
 const items=await db.archiveItem.findMany({where:{projectId,teamId:actor.teamId,lifecycle:'ACTIVE'},orderBy:[{broadcastYear:{sort:'desc',nulls:'last'}},{title:'asc'}],take:500,include:{responsibles:{include:{user:{select:{id:true,name:true}}}},currentVersion:{select:{id:true,versionNo:true,createdAt:true,archive:{select:{state:true,totalBytes:true,fileCount:true}},unreal:{select:{engineVersion:true,validationStatus:true}},previews:{where:{state:'READY',type:'POSTER'},select:{id:true}}}}}});
 const grants=await db.projectAccess.findMany({where:{projectId},include:{membership:{include:{user:{select:{id:true,name:true}}}}}});
 const admins=await db.membership.findMany({where:{teamId:actor.teamId,role:'ADMIN'},include:{user:{select:{id:true,name:true}}}});
 const people=new Map<string,{id:string;name:string;roles:Set<string>}>();
 const add=(id:string,name:string,role:string)=>{const p=people.get(id)||{id,name,roles:new Set<string>()};p.roles.add(role);people.set(id,p);};
 for(const a of admins)add(a.user.id,a.user.name,'관리자');
 for(const g of grants)add(g.membership.user.id,g.membership.user.name,g.canEdit?(g.canDelete?'편집·삭제':'편집'):'조회');
 for(const i of items)for(const r of i.responsibles)add(r.user.id,r.user.name,'담당');
 const versionIds=items.flatMap(i=>i.currentVersionId?[i.currentVersionId]:[]);
 const history=await db.auditEvent.findMany({where:{teamId:actor.teamId,targetId:{in:[projectId,...items.map(i=>i.id),...versionIds]}},orderBy:{createdAt:'desc'},take:50});
 const names=new Map((await db.user.findMany({where:{id:{in:[...new Set(history.map(h=>h.actorId))]}},select:{id:true,name:true}})).map(u=>[u.id,u.name]));
 const pick=(role:string)=>items.filter(i=>i.roles.includes(role)&&i.currentVersionId).map(i=>({id:i.id,title:i.title,kind:i.kind,roles:i.roles,broadcastYear:i.broadcastYear,versionNo:i.currentVersion?.versionNo,state:i.currentVersion?.archive?.state,totalBytes:i.currentVersion?.archive?.totalBytes,fileCount:i.currentVersion?.archive?.fileCount,poster:i.currentVersion?.previews[0]?.id,unreal:i.currentVersion?.unreal}));
 return {project:{id:project.id,title:project.title,description:project.description,createdAt:project.createdAt},
  results:pick('RESULT'),sources:pick('SOURCE').filter(s=>s.kind!=='UNREAL_PROJECT'),unreal:pick('SOURCE').concat(pick('RESULT')).filter((s,i,a)=>s.kind==='UNREAL_PROJECT'&&a.findIndex(x=>x.id===s.id)===i),
  drafts:items.filter(i=>!i.currentVersionId).map(i=>({id:i.id,title:i.title,kind:i.kind})),
  people:[...people.values()].map(p=>({id:p.id,name:p.name,roles:[...p.roles]})),
  history:history.map(h=>({id:h.id,action:h.action,targetId:h.targetId,createdAt:h.createdAt,actorName:names.get(h.actorId)||'알 수 없음'}))};
}
export async function unrealOverview(actor:Actor,versionId:string){
 const version=await db.itemVersion.findFirst({where:{id:versionId,teamId:actor.teamId,state:'READY'},include:{item:{select:{id:true,title:true,kind:true}},unreal:true,archive:{include:{validations:{orderBy:{createdAt:'desc'},take:50}}}}});
 check(version?.unreal&&version.archive,404,'NOT_FOUND','Unreal 보존 버전을 찾을 수 없습니다.');
 await itemAccess(actor,version.itemId);
 const plan=await db.archivePlan.findUnique({where:{id:version.archive.planId},select:{policyVersion:true,state:true,summary:true}});
 const groups=await db.planEntry.groupBy({by:['decision','resolution','action'],where:{planId:version.archive.planId},_count:true,_sum:{sizeBytes:true}});
 const stats={INCLUDE:{count:0,bytes:0n},EXCLUDE:{count:0,bytes:0n},REVIEW_INCLUDED:{count:0,bytes:0n},REVIEW_EXCLUDED:{count:0,bytes:0n},REMOVED:{count:0,bytes:0n},INHERITED:{count:0,bytes:0n}};
 for(const g of groups){
  const bytes=g._sum.sizeBytes||0n;
  const key=g.action==='REMOVE'?'REMOVED':g.decision==='REVIEW'?(g.resolution==='EXCLUDE'?'REVIEW_EXCLUDED':'REVIEW_INCLUDED'):g.decision==='EXCLUDE'?'EXCLUDE':'INCLUDE';
  stats[key as keyof typeof stats].count+=g._count;stats[key as keyof typeof stats].bytes+=bytes;
  if(g.action==='INHERIT'){stats.INHERITED.count+=g._count;stats.INHERITED.bytes+=bytes;}
 }
 const surveyed=Object.entries(stats).filter(([k])=>!['REMOVED','INHERITED'].includes(k)).reduce((n,[,v])=>n+v.bytes,0n);
 const included=stats.INCLUDE.bytes+stats.REVIEW_INCLUDED.bytes;
 // 절감률 = (조사 바이트 - 포함 바이트) / 조사 바이트. 조사 목록이 비면 계산하지 않는다.
 const savings=surveyed>0n?Number((surveyed-included)*10000n/surveyed)/100:null;
 const excluded=actor.role==='ADMIN'?await db.planEntry.findMany({where:{planId:version.archive.planId,OR:[{decision:'EXCLUDE',action:{not:'REMOVE'}},{resolution:'EXCLUDE'}]},orderBy:{relativePath:'asc'},take:300,select:{relativePath:true,reason:true,sizeBytes:true}}):null;
 const validators=new Map((await db.user.findMany({where:{id:{in:version.archive.validations.map(v=>v.actorId)}},select:{id:true,name:true}})).map(u=>[u.id,u.name]));
 return {item:version.item,version:{id:version.id,versionNo:version.versionNo,createdAt:version.createdAt},profile:{uprojectPath:version.unreal.uprojectPath,engineVersion:version.unreal.engineVersion,environment:version.unreal.environment,validationStatus:version.unreal.validationStatus},
  archive:{state:version.archive.state,fileCount:version.archive.fileCount,totalBytes:version.archive.totalBytes,verifiedAt:version.archive.verifiedAt,manifestHash:version.archive.manifestHash},
  policy:{version:plan?.policyVersion||POLICY_VERSION},stats,surveyedBytes:surveyed,includedBytes:included,savingsPercent:savings,
  excluded,validations:version.archive.validations.map(v=>({id:v.id,state:v.state,report:v.report,createdAt:v.createdAt,actorName:validators.get(v.actorId)||'알 수 없음',environment:v.environment}))};
}
