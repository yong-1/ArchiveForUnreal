import { db,Database } from './db';
import { check } from './errors';
export type Actor={userId:string;teamId:string;membershipId:string;role:string;canDownload:boolean;name:string};
export type Action='VIEW'|'DOWNLOAD'|'EDIT'|'DELETE';
export async function actorFor(userId:string,teamId?:string):Promise<Actor>{
  const user=await db.user.findUnique({where:{id:userId}});
  const membership=await db.membership.findFirst({where:{userId,...(teamId?{teamId}:{})},orderBy:{id:'asc'}});
  check(user&&membership,403,'NO_TEAM','팀 접근 권한이 없습니다.');
  return {userId,teamId:membership.teamId,membershipId:membership.id,role:membership.role,canDownload:membership.canDownload,name:user.name};
}
export async function currentActor(req?:Request):Promise<Actor>{
  const {getServerSession}=await import('next-auth');
  const {authOptions}=await import('../auth-options');
  const session=await getServerSession(authOptions);
  check(session?.user?.email,401,'UNAUTHENTICATED','로그인이 필요합니다.');
  const user=await db.user.findUnique({where:{email:session.user.email}});
  check(user,401,'UNAUTHENTICATED','계정을 확인할 수 없습니다.');
  return actorFor(user.id,req?.headers.get('x-team-id')||undefined);
}
export function admin(actor:Actor){check(actor.role==='ADMIN',403,'ADMIN_REQUIRED','관리자 권한이 필요합니다.');}
export async function projectAccess(actor:Actor,projectId:string,action:Action='VIEW',client:Database=db){
  const project=await client.productionProject.findFirst({where:{id:projectId,teamId:actor.teamId}});
  check(project,404,'NOT_FOUND','자료를 찾을 수 없습니다.');
  if(actor.role==='ADMIN')return project;
  const grant=await client.projectAccess.findUnique({where:{projectId_membershipId:{projectId,membershipId:actor.membershipId}}});
  check(grant,404,'NOT_FOUND','자료를 찾을 수 없습니다.');
  check(action!=='EDIT'||(actor.role==='EDITOR'&&grant.canEdit),403,'EDIT_DENIED','편집 권한이 없습니다.');
  check(action!=='DELETE'||(actor.role==='EDITOR'&&grant.canDelete),403,'DELETE_DENIED','삭제 권한이 없습니다.');
  check(action!=='DOWNLOAD'||(actor.canDownload&&grant.canDownload),403,'DOWNLOAD_DENIED','원본 다운로드 권한이 없습니다.');
  return project;
}
export async function itemAccess(actor:Actor,id:string,action:Action='VIEW',client:Database=db,allowPending=false){
  const item=await client.archiveItem.findFirst({where:{id,teamId:actor.teamId}});
  check(item,404,'NOT_FOUND','자료를 찾을 수 없습니다.');
  await projectAccess(actor,item.projectId,action,client);
  check(allowPending||item.lifecycle==='ACTIVE',410,'ITEM_DELETED','삭제 중이거나 삭제된 자료입니다.');
  return item;
}
export function visibleProjects(actor:Actor){
  return actor.role==='ADMIN'?{teamId:actor.teamId}:{teamId:actor.teamId,access:{some:{membershipId:actor.membershipId}}};
}
