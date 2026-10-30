// v6.1 AR-17/18·SAVE-05·NFR-08: 정리·무결성 점검, manifest 대조, 제작 건/UE 조회.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rename,writeFile,readFile,stat,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHarness,fbx,randomUUID } from './setup';
const h=createHarness(55443);
const bin=(text:string)=>Buffer.from(text);
const noop=async()=>{};
async function maintain(){const{processMaintenance}=await import('../../lib/archive/maintenance');return processMaintenance(h.actor,h.actor.teamId,noop);}

test('SAVE-05/OPS-03: a missing NAS file is never streamed, is flagged MISSING, and recovers only after hash check',async()=>{
 const record=await h.version(await h.item('사라진 원본'),{'a.bin':bin('alpha'),'b.bin':bin('bravo')});
 const file=await h.db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:record.currentVersionId!},relativePath:'a.bin'}});
 const p=await h.objectFile(file.storageObjectId);
 await rename(p,p+'.moved');
 await assert.rejects(()=>h.downloads.fileContent(h.actor,file.id,new Request('http://localhost/x')),{status:503});
 const report=await maintain();
 assert.ok(report.integrity.missing>=1);
 assert.equal((await h.db.storageObject.findUniqueOrThrow({where:{id:file.storageObjectId}})).state,'MISSING');
 assert.ok(await h.catalog.detail(h.actor,record.id),'메타데이터·관계 조회는 계속 가능');
 await assert.rejects(()=>h.downloads.fileContent(h.actor,file.id,new Request('http://localhost/x')),{code:'OBJECT_UNAVAILABLE'});
 await rename(p+'.moved',p);
 const again=await maintain();
 assert.equal(again.integrity.recovered,1);
 const ok=await h.downloads.fileContent(h.actor,file.id,new Request('http://localhost/x'));
 assert.equal(Buffer.from(await ok.arrayBuffer()).toString(),'alpha');
});

test('SAVE-05/DB-06: same-size corruption becomes CORRUPT and a tampered manifest blocks ZIP and restore',async()=>{
 const record=await h.version(await h.item('손상 원본'),{'c.bin':bin('charlie'),'d.bin':bin('delta')});
 const file=await h.db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:record.currentVersionId!},relativePath:'c.bin'}});
 await writeFile(await h.objectFile(file.storageObjectId),'CHARLIE');
 await maintain();
 assert.equal((await h.db.storageObject.findUniqueOrThrow({where:{id:file.storageObjectId}})).state,'CORRUPT');
 const other=await h.version(await h.item('manifest 변조'),{'e.bin':bin('echo'),'f.bin':bin('fox')});
 const archive=await h.db.archiveVersion.findUniqueOrThrow({where:{itemVersionId:other.currentVersionId!}});
 const manifestPath=await h.objectFile(archive.manifestObjectId!);
 const original=await readFile(manifestPath);
 await writeFile(manifestPath,original.toString().replace('"e.bin"','"x.bin"'));
 const{verifyManifest}=await import('../../lib/archive/manifest');
 await assert.rejects(()=>verifyManifest(other.currentVersionId!),{code:'MANIFEST_CORRUPT'});
 const job=await h.downloads.queueDownload(h.actor,other.currentVersionId!);
 for(let i=0;i<50&&['QUEUED','RUNNING'].includes((await h.db.job.findUniqueOrThrow({where:{id:job.id}})).state);i++)await h.worker.runOne();
 const failed=await h.db.job.findUniqueOrThrow({where:{id:job.id}});
 assert.equal(failed.state,'FAILED');
 assert.ok((await h.db.jobEvent.findMany({where:{jobId:job.id}})).some(e=>e.kind==='FAILED'),'작업 이력에 실패 기록');
 await writeFile(manifestPath,original);
 assert.equal((await verifyManifest(other.currentVersionId!)).files.length,2);
});

test('OPS-03/AR-10: an offline archive root is reported, not treated as missing files',async()=>{
 const record=await h.version(await h.item('오프라인 보존'),{'g.bin':bin('golf')});
 const file=await h.db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:record.currentVersionId!}}});
 const root=process.env.ARCHIVE_ROOT!;
 await rename(root,root+'-offline');
 try{
  const report=await maintain();
  assert.equal(report.roots.find(r=>r.name==='archive')?.state,'OFFLINE');
  assert.ok(report.integrity.skippedOffline>0);
  assert.equal((await h.db.storageObject.findUniqueOrThrow({where:{id:file.storageObjectId}})).state,'AVAILABLE');
 }finally{await rename(root+'-offline',root);}
 assert.equal((await maintain()).roots.find(r=>r.name==='archive')?.state,'ONLINE');
});

test('AR-17/NFR-08: expired uploads and abandoned drafts are cleaned while inherited objects stay',async()=>{
 const{ArchiveError}=await import('../../lib/archive/errors');
 const source=await h.version(await h.item('정리 대상 소스','MODEL3D',['SOURCE']),{'s.fbx':fbx('s')});
 const record=await h.version(await h.item('정리 대상'),{'keep.bin':bin('keep')});
 // 1) 전송만 하고 방치된 업로드
 const idle=await h.uploads.createBatch(h.actor,{requestKey:randomUUID(),items:[{itemId:record.id,baseVersionId:record.currentVersionId,revision:record.revision,files:[{path:'idle.bin',size:'4'}]}]});
 await h.uploads.receivePart(h.actor,idle.sessions[0].id,0,bin('idle'));
 const partFile=path.join(process.env.STAGING_ROOT!,'uploads',idle.sessions[0].id,'0');
 await stat(partFile);
 await h.db.uploadBatch.update({where:{id:idle.id},data:{expiresAt:new Date(Date.now()-1000)}});
 // 2) 확정 도중 실패한 뒤 만료된 업로드(새 파일 object와 draft 버전이 남음)
 const{sha256}=await import('../../lib/archive/hash');
 const other=await h.version(await h.item('실패 후 만료'),{'base.bin':bin('base')});
 const failing=await h.uploads.createBatch(h.actor,{requestKey:randomUUID(),items:[{itemId:other.id,baseVersionId:other.currentVersionId,revision:other.revision,files:[{path:'new.bin',size:'3'}],sourceVersionIds:[source.currentVersionId!],replaceSources:true}]});
 await h.uploads.registerSessionChecksum(h.actor,failing.sessions[0].id,sha256(bin('new')));
 await h.uploads.receivePart(h.actor,failing.sessions[0].id,0,bin('new'));await h.uploads.completeSession(h.actor,failing.sessions[0].id);
 const latest=await h.uploads.batchStatus(h.actor,failing.id);
 await h.uploads.commitBatch(h.actor,failing.id,Object.fromEntries(latest.plans.map(p=>[p.id,p.hash])));
 let calls=0;
 await assert.rejects(()=>h.uploads.processCommit(h.actor,failing.id,async()=>{if(++calls>6)throw new ArchiveError(409,'LEASE_LOST','중단');}));
 await h.db.job.updateMany({where:{targetId:failing.id,type:'COMMIT'},data:{state:'FAILED'}});
 await h.db.uploadBatch.update({where:{id:failing.id},data:{state:'FAILED',expiresAt:new Date(Date.now()-1000)}});
 const draftVersion=await h.db.itemVersion.findFirstOrThrow({where:{itemId:other.id,state:'DRAFT'}});
 const newObject=(await h.db.uploadSession.findFirstOrThrow({where:{batchId:failing.id}})).objectId!;
 assert.ok(newObject);
 // 미확정 draft의 링크가 남아 있는 동안 소스는 공유로 판정된다.
 const report=await maintain();
 assert.ok(report.expiredBatches>=1);assert.ok(report.abandonedDrafts>=1);
 assert.equal((await h.db.uploadBatch.findUniqueOrThrow({where:{id:failing.id}})).state,'EXPIRED');
 assert.equal((await h.db.itemVersion.findUniqueOrThrow({where:{id:draftVersion.id}})).state,'ABANDONED');
 assert.equal((await h.db.storageObject.findUniqueOrThrow({where:{id:newObject}})).state,'PURGED');
 const base=await h.db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:other.currentVersionId!}}});
 assert.equal((await h.db.storageObject.findUniqueOrThrow({where:{id:base.storageObjectId}})).state,'AVAILABLE','기준 버전 객체는 보존');
 await assert.rejects(()=>stat(partFile));
 // 만료된 묶음은 재시도·확정할 수 없다.
 await assert.rejects(()=>h.uploads.processCommit(h.actor,failing.id,noop),{code:'UPLOAD_CLOSED'});
 // 정리 후 소스 삭제 계획에서 버려진 draft 연결은 공유 참조로 계산하지 않는다.
 const plan=await h.deletions.createDeletePlan(h.actor,source.id);
 assert.equal((plan.plan as {items:{id:string}[]}).items.length,1);
});

test('AR-12/DEL-08: expired ZIPs are reclaimed and their links answer 410',async()=>{
 const record=await h.version(await h.item('만료 ZIP'),{'z1.bin':bin('z1'),'z2.bin':bin('z2')});
 const job=await h.downloads.queueDownload(h.actor,record.currentVersionId!);await h.finish(job.id);
 const done=await h.db.job.findUniqueOrThrow({where:{id:job.id}});
 const result=done.result as {objectId:string;expiresAt:string};
 assert.ok(typeof (done.progress as {total?:number}).total==='number','ZIP 진행률 기록');
 await h.db.job.update({where:{id:job.id},data:{result:{...result,expiresAt:new Date(Date.now()-1000).toISOString()}}});
 const report=await maintain();
 assert.equal(report.expiredDownloads,1);
 assert.equal((await h.db.storageObject.findUniqueOrThrow({where:{id:result.objectId}})).state,'PURGED');
 await assert.rejects(()=>h.downloads.jobContent(h.actor,job.id,new Request('http://localhost/x')),{status:410});
});

test('REST-01: restore refuses to start without enough free space for the remaining bytes',async()=>{
 const record=await h.version(await h.item('공간 부족 복원'),{'r.bin':bin('restore')});
 const restoreRoot=path.join(h.directory,'restore');await mkdir(restoreRoot);
 process.env.RESTORE_ROOT=restoreRoot;
 const{processRestore}=await import('../../lib/archive/restores');
 const reserve=process.env.STORAGE_RESERVE_BYTES;
 process.env.STORAGE_RESERVE_BYTES=String(10n**18n);
 try{await assert.rejects(()=>processRestore(h.actor,record.currentVersionId!,randomUUID(),noop),{code:'INSUFFICIENT_SPACE'});}
 finally{process.env.STORAGE_RESERVE_BYTES=reserve;}
 const ok=await processRestore(h.actor,record.currentVersionId!,randomUUID(),noop);
 assert.equal(ok.fileIntegrity,'VERIFIED');
});

test('UI APIs: project overview groups results/sources/UE and Unreal overview reports exclusions and savings',async()=>{
 const{projectOverview,unrealOverview}=await import('../../lib/archive/overview');
 const ue=await h.item('UE 프로젝트','UNREAL_PROJECT',['SOURCE']);
 const files={'Sat.uproject':bin('{"FileVersion":3}'),'Content/Maps/Main.umap':Buffer.from([0xc1,0x83,0x2a,0x9e,1,2,3]),'Intermediate/Build/cache.bin':bin('cache-cache-cache')};
 const{sha256}=await import('../../lib/archive/hash');
 const batch=await h.uploads.createBatch(h.actor,{requestKey:randomUUID(),items:[{itemId:ue.id,baseVersionId:null,revision:ue.revision,files:Object.entries(files).map(([p,b])=>({path:p,size:String(b.length)})),unreal:{engineVersion:'5.6',distribution:'LAUNCHER',build:'',plugins:[],notes:''}}]});
 for(const s of batch.sessions){const c=files[s.path as keyof typeof files];await h.uploads.registerSessionChecksum(h.actor,s.id,sha256(c));await h.uploads.receivePart(h.actor,s.id,0,c);await h.uploads.completeSession(h.actor,s.id);}
 const latest=await h.uploads.batchStatus(h.actor,batch.id);
 const queued=await h.uploads.commitBatch(h.actor,batch.id,Object.fromEntries(latest.plans.map(p=>[p.id,p.hash])));await h.finish(queued.jobId!);
 const version=(await h.db.archiveItem.findUniqueOrThrow({where:{id:ue.id}})).currentVersionId!;
 const view=await unrealOverview(h.actor,version);
 assert.equal(view.stats.EXCLUDE.count,1);assert.equal(view.stats.INCLUDE.count,2);
 assert.ok(view.savingsPercent!==null&&view.savingsPercent>0);
 assert.equal(view.excluded?.[0].relativePath,'Intermediate/Build/cache.bin');
 const project=await projectOverview(h.actor,h.projectId);
 assert.ok(project.unreal.some(u=>u.id===ue.id));
 assert.ok(project.results.length>0);assert.ok(project.history.length>0);
});
