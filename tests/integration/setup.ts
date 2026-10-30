// 통합 시험 공통 준비: 격리 PGlite(PostgreSQL 호환) + 임시 보존/임시/미리보기 루트 + 초기 관리자.
// 운영 DB·NAS에는 접속하지 않는다. 파일마다 다른 port를 사용한다.
import { after,before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdir,mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { startLocalDatabase } from '../../scripts/local-db';
type Modules={
 db:typeof import('../../lib/archive/db').db;
 uploads:typeof import('../../lib/archive/uploads');
 catalog:typeof import('../../lib/archive/catalog');
 access:typeof import('../../lib/archive/access');
 worker:typeof import('../../lib/archive/worker');
 deletions:typeof import('../../lib/archive/deletions');
 downloads:typeof import('../../lib/archive/downloads');
 storage:typeof import('../../lib/archive/storage');
};
export type Harness=Modules&{directory:string;actor:import('../../lib/archive/access').Actor;projectId:string;
 finish(jobId:string):Promise<unknown>;
 item(title:string,kind?:string,roles?:string[]):Promise<{id:string;revision:number;currentVersionId:string|null}>;
 version(item:{id:string;revision:number;currentVersionId:string|null},files:Record<string,Buffer>,options?:{sources?:string[];linkDetails?:Record<string,{relation:'ASSOCIATED'|'USED_CONFIRMED';evidence?:string}>;versionDescription?:string}):Promise<{id:string;revision:number;currentVersionId:string|null}>;
 objectFile(objectId:string):Promise<string>;
};
export const fbx=(text:string)=>Buffer.from('; FBX '+text);
export function createHarness(port:number):Harness{
 const h={} as Harness;
 let local:Awaited<ReturnType<typeof startLocalDatabase>>;
 before(async()=>{
  await mkdir('.local',{recursive:true});h.directory=await mkdtemp(path.resolve('.local/integration-'));
  local=await startLocalDatabase(port,path.join(h.directory,'database'));
  Object.assign(process.env,{DATABASE_URL:local.url,NEXTAUTH_SECRET:randomBytes(48).toString('hex'),BOOTSTRAP_TOKEN:randomBytes(32).toString('hex'),ARCHIVE_ROOT:path.join(h.directory,'archive'),STAGING_ROOT:path.join(h.directory,'staging'),PREVIEW_ROOT:path.join(h.directory,'preview'),STORAGE_RESERVE_BYTES:'0'});
  h.db=(await import('../../lib/archive/db')).db;
  h.uploads=await import('../../lib/archive/uploads');h.catalog=await import('../../lib/archive/catalog');h.access=await import('../../lib/archive/access');
  h.worker=await import('../../lib/archive/worker');h.deletions=await import('../../lib/archive/deletions');h.downloads=await import('../../lib/archive/downloads');h.storage=await import('../../lib/archive/storage');
  const{bootstrap}=await import('../../lib/archive/bootstrap');
  await bootstrap({token:process.env.BOOTSTRAP_TOKEN,email:'admin@archive.test',password:'test-only-password-123!',name:'테스트 관리자',teamName:'검증 전용 팀'});
  h.actor=await h.access.actorFor((await h.db.user.findUniqueOrThrow({where:{email:'admin@archive.test'}})).id);
  h.projectId=(await h.db.productionProject.create({data:{teamId:h.actor.teamId,title:'검증 제작 건'}})).id;
 });
 after(async()=>{await h.db?.$disconnect();await local?.close();if(h.directory&&path.resolve(h.directory).startsWith(path.resolve('.local')+path.sep))await rm(h.directory,{recursive:true,force:true});});
 h.finish=async(jobId:string)=>{
  for(let i=0;i<100;i++){const job=await h.db.job.findUniqueOrThrow({where:{id:jobId}});if(job.state==='COMPLETED')return job;assert.notEqual(job.state,'FAILED',job.error||'작업 실패');await h.worker.runOne();}
  throw Error('작업이 완료되지 않았습니다.');
 };
 h.item=(title,kind='FILE',roles=['RESULT'])=>h.catalog.saveMetadata(h.actor,{projectId:h.projectId,title,kind,roles,broadcastYear:2026,keywords:['검증']});
 h.version=async(record,files,options={})=>{
  const{sha256}=await import('../../lib/archive/hash');
  const batch=await h.uploads.createBatch(h.actor,{requestKey:randomUUID(),items:[{itemId:record.id,baseVersionId:record.currentVersionId,revision:record.revision,files:Object.entries(files).map(([name,bytes])=>({path:name,size:String(bytes.length)})),sourceVersionIds:options.sources||[],replaceSources:true,linkDetails:options.linkDetails||{},versionDescription:options.versionDescription||''}]});
  for(const session of batch.sessions){const content=files[session.path];await h.uploads.registerSessionChecksum(h.actor,session.id,sha256(content));await h.uploads.receivePart(h.actor,session.id,0,content);await h.uploads.completeSession(h.actor,session.id);}
  const latest=await h.uploads.batchStatus(h.actor,batch.id),result=await h.uploads.commitBatch(h.actor,batch.id,Object.fromEntries(latest.plans.map(p=>[p.id,p.hash])));
  assert.ok('jobId' in result&&result.jobId);await h.finish(result.jobId);
  return h.db.archiveItem.findUniqueOrThrow({where:{id:record.id}});
 };
 h.objectFile=async(objectId:string)=>{const o=await h.db.storageObject.findUniqueOrThrow({where:{id:objectId},include:{root:true}});return path.join(o.root.path,...o.objectKey.split('/'));};
 return h;
}
export { randomUUID };
