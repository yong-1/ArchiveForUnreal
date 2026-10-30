import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdir,mkdtemp,rm,readFile,writeFile,stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { startLocalDatabase } from '../../scripts/local-db';
let local:Awaited<ReturnType<typeof startLocalDatabase>>,directory:string;
let db:typeof import('../../lib/archive/db').db;
let actor:import('../../lib/archive/access').Actor,projectId:string;
let services:typeof import('../../lib/archive/uploads');
let catalog:typeof import('../../lib/archive/catalog');
let access:typeof import('../../lib/archive/access');
let worker:typeof import('../../lib/archive/worker');
let deletions:typeof import('../../lib/archive/deletions');
before(async()=>{
 await mkdir('.local',{recursive:true});directory=await mkdtemp(path.resolve('.local/integration-'));
 local=await startLocalDatabase(55439,path.join(directory,'database'));
 process.env.DATABASE_URL=local.url;
 process.env.NEXTAUTH_SECRET=randomBytes(48).toString('hex');process.env.BOOTSTRAP_TOKEN=randomBytes(32).toString('hex');
 process.env.ARCHIVE_ROOT=path.join(directory,'archive');process.env.STAGING_ROOT=path.join(directory,'staging');process.env.PREVIEW_ROOT=path.join(directory,'preview');process.env.STORAGE_RESERVE_BYTES='0';
 ({db}=await import('../../lib/archive/db'));services=await import('../../lib/archive/uploads');catalog=await import('../../lib/archive/catalog');access=await import('../../lib/archive/access');worker=await import('../../lib/archive/worker');deletions=await import('../../lib/archive/deletions');
 const{bootstrap}=await import('../../lib/archive/bootstrap');
 await bootstrap({token:process.env.BOOTSTRAP_TOKEN,email:'admin@archive.test',password:'test-only-password-123!',name:'테스트 관리자',teamName:'검증 전용 팀'});
 actor=await access.actorFor((await db.user.findUniqueOrThrow({where:{email:'admin@archive.test'}})).id);
 const p=await db.productionProject.create({data:{teamId:actor.teamId,title:'우주 특집'}});projectId=p.id;
});
after(async()=>{await db?.$disconnect();await local?.close();if(directory&&path.resolve(directory).startsWith(path.resolve('.local')+path.sep))await rm(directory,{recursive:true,force:true});});
async function finish(jobId:string){
 for(let i=0;i<100;i++){
  const job=await db.job.findUniqueOrThrow({where:{id:jobId}});
  if(job.state==='COMPLETED')return job;
  assert.notEqual(job.state,'FAILED',job.error||'작업 실패');
  await worker.runOne();
 }
 throw Error('작업이 완료되지 않았습니다.');
}
async function version(item: {id:string;revision:number;currentVersionId:string|null},files:Record<string,Buffer>,sources:string[]=[]){
 const batch=await services.createBatch(actor,{requestKey:randomUUID(),items:[{itemId:item.id,baseVersionId:item.currentVersionId,revision:item.revision,files:Object.entries(files).map(([name,bytes])=>({path:name,size:String(bytes.length)})),sourceVersionIds:sources,replaceSources:true}]});
 for(const session of batch.sessions){
  const content=files[session.path];
  assert.ok(content,'file exists in fixture');
  const{sha256}=await import('../../lib/archive/hash');await services.registerSessionChecksum(actor,session.id,sha256(content));
  await services.receivePart(actor,session.id,0,content);await services.completeSession(actor,session.id);
 }
 const latest=await services.batchStatus(actor,batch.id),result=await services.commitBatch(actor,batch.id,Object.fromEntries(latest.plans.map(p=>[p.id,p.hash])));
 assert.ok('jobId' in result&&result.jobId);await finish(result.jobId);
 return db.archiveItem.findUniqueOrThrow({where:{id:item.id}});
}
// 확장자 signature 검사를 통과하는 최소 fixture
const fbx=(text:string)=>Buffer.from('; FBX '+text);
const pngBytes=(text:string)=>Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.from(text)]);
const mov=(text:string)=>Buffer.concat([Buffer.from([0,0,0,8]),Buffer.from('wide'),Buffer.from(text)]);
async function item(title:string,kind='FILE',roles=['RESULT']){
 return catalog.saveMetadata(actor,{projectId,title,kind,roles,broadcastYear:2026,keywords:['우주','재사용']});
}
test('INIT-01/02: empty PostgreSQL initializes once; credentials never returned',async()=>{
 const{bootstrap}=await import('../../lib/archive/bootstrap');
 await assert.rejects(()=>bootstrap({token:process.env.BOOTSTRAP_TOKEN,email:'second@archive.test',password:'test-only-password-123!',name:'다른 관리자',teamName:'중복'}));
 assert.equal(await db.user.count(),1);assert.equal(await db.team.count(),1);assert.equal(await db.archiveItem.count(),0);
});
test('UPL-01/02/08: versions replace by path, inherit unchanged objects, preserve old bytes',async()=>{
 let record=await item('위성 소스');
 record=await version(record,{'Models/Satellite.fbx':fbx('satellite-v1'),'Textures/Earth.png':pngBytes('texture-v1')});
 const first=await catalog.detail(actor,record.id),v1=first.selectedVersion!;
 const old=await db.archiveFile.findMany({where:{archiveVersionId:v1.archiveId}});
 record=await version(record,{'Models/Satellite.fbx':fbx('satellite-v2'),'Models/Rocket.fbx':fbx('rocket')});
 const second=await catalog.detail(actor,record.id);
 assert.equal(second.selectedVersion!.versionNo,2n);assert.equal(second.selectedVersion!.fileCount,3);
 const retained=await db.archiveFile.findFirstOrThrow({where:{archiveVersionId:second.selectedVersion!.archiveId,relativePath:'Textures/Earth.png'}});
 assert.equal(retained.storageObjectId,old.find(f=>f.relativePath==='Textures/Earth.png')!.storageObjectId);
 const{fileContent}=await import('../../lib/archive/downloads');
 const response=await fileContent(actor,old.find(f=>f.relativePath==='Models/Satellite.fbx')!.id,new Request('http://localhost/file'));
 assert.equal(Buffer.from(await response.arrayBuffer()).toString(),'; FBX satellite-v1');
});
test('UPL-04: same chunk retries are idempotent and different bytes are rejected',async()=>{
 const record=await item('청크 재전송');
 const batch=await services.createBatch(actor,{requestKey:randomUUID(),items:[{itemId:record.id,baseVersionId:null,revision:1,files:[{path:'a.bin',size:'3'}]}]});
 const session=batch.sessions[0];
 await services.receivePart(actor,session.id,0,Buffer.from('abc'));await services.receivePart(actor,session.id,0,Buffer.from('abc'));
 await assert.rejects(()=>services.receivePart(actor,session.id,0,Buffer.from('xyz')));
 assert.equal(await db.uploadPart.count({where:{sessionId:session.id}}),1);
 await services.cancelBatch(actor,batch.id);assert.equal((await db.archiveItem.findUniqueOrThrow({where:{id:record.id}})).currentVersionId,null);
 await assert.rejects(()=>stat(path.join(process.env.STAGING_ROOT!,'uploads',session.id,'0')),{code:'ENOENT'});
 await assert.rejects(()=>services.completeSession(actor,session.id),{code:'UPLOAD_CLOSED'});
});
test('VIEW-02: display is WebP while the downloaded PNG original remains byte-identical',async()=>{
 const png=await sharp({create:{width:32,height:24,channels:4,background:'#83b6aa'}}).png().toBuffer();
 const record=await version(await item('키비주얼','IMAGE'),{'Final.png':png});
 for(let i=0;i<15&&await db.previewDerivative.count({where:{versionId:record.currentVersionId!,state:'READY'}})===0;i++)await worker.runOne();
 const preview=await db.previewDerivative.findFirstOrThrow({where:{versionId:record.currentVersionId!,type:{startsWith:'WEBP:'},state:'READY'}});
 const{mediaContent,fileContent}=await import('../../lib/archive/downloads');
 const webp=await mediaContent(actor,preview.id,new Request('http://localhost/media'));
 assert.equal(webp.headers.get('content-type'),'image/webp');assert.equal(Buffer.from(await webp.arrayBuffer()).subarray(0,4).toString(),'RIFF');
 const file=await db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:record.currentVersionId!}}});
 const original=await fileContent(actor,file.id,new Request('http://localhost/file'));assert.deepEqual(Buffer.from(await original.arrayBuffer()),png);
});
test('DEL-02/04/10: confirmed delete removes exclusive assets and retains shared sources',async()=>{
 const exclusive=await version(await item('전용 소스','FILE',['SOURCE']),{'exclusive.fbx':fbx('exclusive')});
 const shared=await version(await item('공유 소스','FILE',['SOURCE']),{'shared.fbx':fbx('shared')});
 const a=await version(await item('결과 A'),{'a.mov':mov('result-a')},[exclusive.currentVersionId!,shared.currentVersionId!]);
 const b=await version(await item('결과 B'),{'b.mov':mov('result-b')},[shared.currentVersionId!]);
 const plan=await deletions.createDeletePlan(actor,a.id);
 assert.equal((plan.plan as {shared:unknown[]}).shared.length,1);
 await deletions.confirmDelete(actor,plan.id,plan.hash,randomUUID(),true);
 const job=await db.job.findFirstOrThrow({where:{type:'DELETE',targetId:plan.id}});await finish(job.id);
 assert.equal((await db.archiveItem.findUniqueOrThrow({where:{id:a.id}})).lifecycle,'DELETED');
 assert.equal((await db.archiveItem.findUniqueOrThrow({where:{id:exclusive.id}})).lifecycle,'DELETED');
 assert.equal((await db.archiveItem.findUniqueOrThrow({where:{id:shared.id}})).lifecycle,'ACTIVE');
 assert.equal((await db.archiveItem.findUniqueOrThrow({where:{id:b.id}})).lifecycle,'ACTIVE');
 const entries=await db.deleteEntry.findMany({where:{requestId:plan.id,state:'PURGED'}});
 assert.ok(entries.length>0);
 for(const entry of entries){const object=await db.storageObject.findUniqueOrThrow({where:{id:entry.objectId},include:{root:true}});await assert.rejects(()=>stat(path.join(object.root.path,...object.objectKey.split('/'))));}
});
test('SEC-01/02: team membership alone cannot view or mutate a restricted project',async()=>{
 const user=await db.user.create({data:{email:'viewer@archive.test',name:'조회자'}});
 const membership=await db.membership.create({data:{teamId:actor.teamId,userId:user.id,role:'VIEWER'}});
 const viewer=await access.actorFor(user.id);
 const target=await item('제한 자료');
 await assert.rejects(()=>access.itemAccess(viewer,target.id),{code:'NOT_FOUND'});
 await db.projectAccess.create({data:{teamId:actor.teamId,membershipId:membership.id,projectId,canDownload:true}});
 await access.itemAccess(viewer,target.id);
 await assert.rejects(()=>access.itemAccess(viewer,target.id,'DELETE'),{code:'DELETE_DENIED'});
});
test('DB-01/04: foreign-team references and in-place archive mutations are rejected by PostgreSQL',async()=>{
 const target=await version(await item('불변 보존'),{'a.bin':Buffer.from('unchanged')});
 const other=await db.team.create({data:{name:'다른 팀'}});
 await assert.rejects(()=>db.itemVersion.create({data:{teamId:other.id,itemId:target.id,createdBy:actor.userId}}));
 const file=await db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:target.currentVersionId!}}});
 await assert.rejects(()=>db.archiveFile.update({where:{id:file.id},data:{checksum:'0'.repeat(64)}}));
});
test('SAVE-01/02: approved NAS import copies read-only source and detects changed snapshots',async()=>{
 const sources=await import('../../lib/archive/sources');
 const sourceRoot=path.join(directory,'source');await mkdir(sourceRoot);
 process.env.SOURCE_ROOTS=JSON.stringify([sourceRoot]);await writeFile(path.join(sourceRoot,'model.fbx'),'; FBX nas-original');
 const root=await sources.registerSource(actor,'테스트 제작 NAS',sourceRoot);
 const record=await item('NAS 원본','FILE',['SOURCE']);
 const scan=await sources.processScan(actor,record.id,{rootId:root.id,relativePath:'',baseVersionId:null,revision:record.revision},async()=>{});
 await sources.processImport(actor,scan.planId,async()=>{});
 const job=await db.job.findFirstOrThrow({where:{type:'COMMIT',state:'QUEUED',teamId:actor.teamId}});await finish(job.id);
 assert.equal(await readFile(path.join(sourceRoot,'model.fbx'),'utf8'),'; FBX nas-original');
 const refreshed=await db.archiveItem.findUniqueOrThrow({where:{id:record.id}});
 const stale=await sources.processScan(actor,record.id,{rootId:root.id,relativePath:'',baseVersionId:refreshed.currentVersionId,revision:refreshed.revision},async()=>{});
 await writeFile(path.join(sourceRoot,'model.fbx'),'; FBX changed-after-scan');
 await assert.rejects(()=>sources.processImport(actor,stale.planId,async()=>{}),{code:'SOURCE_CHANGED'});
});

test('VIEW-01: AV1 WebM is actually encoded while the original MP4 stays intact',{timeout:120000},async()=>{
 const {default:ffmpeg}=await import('ffmpeg-static');
 const {command}=await import('../../lib/archive/previews');
 const fixture=path.join(directory,'original.mp4');
 await command(ffmpeg!,['-nostdin','-f','lavfi','-i','color=c=0x193b46:s=320x180:r=12','-t','0.5','-c:v','libx264','-pix_fmt','yuv420p','-y',fixture],async()=>{},30000);
 const original=await readFile(fixture);
 const record=await version(await item('AV1 실제 변환','VIDEO'),{'Final.mp4':original});
 const job=await db.job.findFirstOrThrow({where:{type:'PREVIEW',targetId:record.currentVersionId!}});await finish(job.id);
 const proxy=await db.previewDerivative.findUniqueOrThrow({where:{versionId_type:{versionId:record.currentVersionId!,type:'AV1'}}});
 assert.equal(proxy.state,'READY');assert.equal((proxy.metadata as {codec:string}).codec,'av1');
 const {mediaContent,fileContent}=await import('../../lib/archive/downloads');
 const preview=await mediaContent(actor,proxy.id,new Request('http://localhost/media'));
 assert.equal(preview.headers.get('content-type'),'video/webm');assert.ok((await preview.arrayBuffer()).byteLength>100);
 const file=await db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:record.currentVersionId!}}});
 assert.deepEqual(Buffer.from(await (await fileContent(actor,file.id,new Request('http://localhost/file'))).arrayBuffer()),original);
});
test('DOWN-02/03: ZIP preparation is reusable and byte-range downloads retain validators',async()=>{
 const record=await version(await item('폴더 다운로드'),{'folder/a.txt':Buffer.from('file-a'),'folder/b.txt':Buffer.from('file-b')});
 const{queueDownload,jobContent,fileContent}=await import('../../lib/archive/downloads');
 const queued=await queueDownload(actor,record.currentVersionId!);
 assert.equal((await queueDownload(actor,record.currentVersionId!)).id,queued.id);
 const job=await finish(queued.id);
 const response=await jobContent(actor,job.id,new Request('http://localhost/zip'));
 const zip=Buffer.from(await response.arrayBuffer());assert.equal(zip.subarray(0,2).toString(),'PK');
 assert.ok(zip.includes(Buffer.from('_archive/manifest.json')));
 const file=await db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:record.currentVersionId!},relativePath:'folder/a.txt'}});
 const part=await fileContent(actor,file.id,new Request('http://localhost/file',{headers:{range:'bytes=2-4'}}));
 assert.equal(part.status,206);assert.equal(await part.text(),'le-');assert.equal(part.headers.get('etag'),'"'+file.checksum+'"');
});
test('DEL-01/11: confirmed deletion can be cancelled before physical purge, restoring pinned links',async()=>{
 const source=await version(await item('취소 보존 소스','FILE',['SOURCE']),{'source.fbx':fbx('keep')});
 const result=await version(await item('삭제 취소 결과'),{'result.bin':Buffer.from('keep-result')},[source.currentVersionId!]);
 const plan=await deletions.createDeletePlan(actor,result.id);
 await deletions.confirmDelete(actor,plan.id,plan.hash,randomUUID(),true);
 await deletions.cancelDelete(actor,plan.id);
 const restored=await catalog.detail(actor,result.id);
 assert.equal(restored.selectedVersion!.sources[0].versionId,source.currentVersionId);
 assert.equal((await db.archiveItem.findUniqueOrThrow({where:{id:source.id}})).lifecycle,'ACTIVE');
});
test('DEL-08: active file leases delay purge and completion is recorded only after actual removal',async()=>{
 const record=await version(await item('전송 중 삭제'),{'payload.bin':Buffer.from('held')});
 const file=await db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:record.currentVersionId!}}});
 const{objectLease,releaseLeases}=await import('../../lib/archive/storage');await objectLease([file.storageObjectId],'integration-active-download');
 const plan=await deletions.createDeletePlan(actor,record.id);
 await deletions.confirmDelete(actor,plan.id,plan.hash,randomUUID(),true);
 assert.equal((await deletions.processDelete(actor,plan.id,async()=>{})).waiting,true);
 assert.equal((await db.deleteRequest.findUniqueOrThrow({where:{id:plan.id}})).state,'WAITING_FOR_LEASES');
 await releaseLeases('integration-active-download');
 assert.equal((await deletions.processDelete(actor,plan.id,async()=>{})).completed,true);
});

test('UPL-06/09: batch publishes result and newly linked source together; stale base cannot publish',async()=>{
 const source=await item('원자적 새 소스','MODEL3D',['SOURCE']),result=await item('원자적 결과');
 const entries=[{...result,path:'final.bin'},{...source,path:'satellite.fbx'}];
 const batch=await services.createBatch(actor,{requestKey:randomUUID(),items:entries.map(r=>({itemId:r.id,baseVersionId:null,revision:r.revision,files:[{path:r.path,size:'3'}],sourceItemIds:r.id===result.id?[source.id]:[],replaceSources:true}))});
 for(const session of batch.sessions){await services.receivePart(actor,session.id,0,Buffer.from('; F'));await services.completeSession(actor,session.id);}
 const latest=await services.batchStatus(actor,batch.id);const queued=await services.commitBatch(actor,batch.id,Object.fromEntries(latest.plans.map(p=>[p.id,p.hash])));
 await finish(queued.jobId!);
 const detail=await catalog.detail(actor,result.id);assert.equal(detail.selectedVersion!.sources[0].itemId,source.id);
 assert.equal(await db.itemVersion.count({where:{itemId:{in:[result.id,source.id]},state:'READY'}}),2);
 await assert.rejects(()=>services.createBatch(actor,{requestKey:randomUUID(),items:[{itemId:result.id,baseVersionId:null,revision:1,files:[{path:'x.bin',size:'3'}]}]}),{code:'BASE_CHANGED'});
});

test('SAVE-04: lost worker lease cannot publish object bytes',async()=>{
 const{putObject}=await import('../../lib/archive/storage');const id=randomUUID();
 await assert.rejects(()=>putObject(actor.teamId,'ARCHIVE',Buffer.from('never-publish'),id,async()=>{throw Error('lease lost');}));
 assert.equal(await db.storageObject.count({where:{id}}),0);
});

test('REST-01: isolated restore verifies files, resumes safely and never overwrites modified output',async()=>{
 const record=await version(await item('복원 검증'),{'folder/a.fbx':fbx('source-bytes')});
 process.env.RESTORE_ROOT=path.join(directory,'restore');await mkdir(process.env.RESTORE_ROOT,{recursive:true});
 const{processRestore}=await import('../../lib/archive/restores');const jobId=randomUUID();
 const restored=await processRestore(actor,record.currentVersionId!,jobId,async()=>{});assert.equal(restored.fileIntegrity,'VERIFIED');assert.equal(restored.unrealValidation,'NOT_TESTED');
 await processRestore(actor,record.currentVersionId!,jobId,async()=>{});
 const output=path.join(process.env.RESTORE_ROOT,jobId,'folder/a.fbx');await writeFile(output,'user-edit');
 await assert.rejects(()=>processRestore(actor,record.currentVersionId!,jobId,async()=>{}),{code:'RESTORE_CONFLICT'});
 assert.equal(await readFile(output,'utf8'),'user-edit');
});

