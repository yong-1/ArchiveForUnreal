// v6.1 TDD B0 보강: 결과물만 삭제, 삭제 경쟁, NAS 부분 실패·재시도, 확정 중 중단 복구,
// 그리고 AR-04/14(실사용 확인·역탐색·버전 설명·메모 이력).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,rm,stat,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHarness,fbx,randomUUID } from './setup';
const h=createHarness(55441);
const bin=(text:string)=>Buffer.from(text);

test('DEL-03: result-only delete removes result bytes but keeps exclusive source and unlinks it',async()=>{
 const source=await h.version(await h.item('전용 소스','MODEL3D',['SOURCE']),{'rocket.fbx':fbx('rocket')});
 const result=await h.version(await h.item('결과물만 삭제'),{'final.bin':bin('final')},{sources:[source.currentVersionId!]});
 const resultFile=await h.db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:result.currentVersionId!}}});
 const sourceFile=await h.db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:source.currentVersionId!}}});
 const plan=await h.deletions.createDeletePlan(h.actor,result.id,'resultOnly');
 const snapshot=plan.plan as {items:{id:string}[];shared:{id:string;reason:string}[]};
 assert.deepEqual(snapshot.items.map(i=>i.id),[result.id]);
 assert.equal(snapshot.shared[0].id,source.id);
 await h.deletions.confirmDelete(h.actor,plan.id,plan.hash,randomUUID(),true);
 await h.finish((await h.db.job.findFirstOrThrow({where:{type:'DELETE',targetId:plan.id}})).id);
 assert.equal((await h.db.archiveItem.findUniqueOrThrow({where:{id:result.id}})).lifecycle,'DELETED');
 assert.equal((await h.db.archiveItem.findUniqueOrThrow({where:{id:source.id}})).lifecycle,'ACTIVE');
 const resultPath=await h.objectFile(resultFile.storageObjectId);
 await assert.rejects(()=>stat(resultPath),{code:'ENOENT'});
 assert.equal((await readFile(await h.objectFile(sourceFile.storageObjectId))).toString(),'; FBX rocket');
 assert.equal((await h.catalog.usedBy(h.actor,source.id)).items.length,0,'삭제된 결과물과의 연결은 해제');
 await assert.rejects(()=>h.downloads.fileContent(h.actor,resultFile.id,new Request('http://localhost/x')),{status:404});
});

test('DEL-06: stale plans, duplicate confirmations and active uploads are rejected without changes',async()=>{
 const source=await h.version(await h.item('경쟁 소스','MODEL3D',['SOURCE']),{'s.fbx':fbx('s')});
 const a=await h.version(await h.item('경쟁 결과 A'),{'a.bin':bin('a')},{sources:[source.currentVersionId!]});
 const plan=await h.deletions.createDeletePlan(h.actor,a.id);
 assert.equal((plan.plan as {items:unknown[]}).items.length,2,'계획 시점에는 전용 소스');
 // 계획 후 다른 결과물이 같은 소스를 참조하면 확인은 409이고 아무것도 바뀌지 않는다.
 await h.version(await h.item('경쟁 결과 B'),{'b.bin':bin('b')},{sources:[source.currentVersionId!]});
 await assert.rejects(()=>h.deletions.confirmDelete(h.actor,plan.id,plan.hash,randomUUID(),true),{code:'STALE_DELETE_PLAN'});
 assert.equal((await h.db.archiveItem.findUniqueOrThrow({where:{id:source.id}})).lifecycle,'ACTIVE');
 assert.equal((await h.db.archiveItem.findUniqueOrThrow({where:{id:a.id}})).lifecycle,'ACTIVE');
 // 새 계획은 공유로 판정하고, 같은 키 재확인은 같은 요청, 다른 키는 거절.
 const fresh=await h.deletions.createDeletePlan(h.actor,a.id);
 assert.equal((fresh.plan as {shared:{id:string}[]}).shared[0].id,source.id);
 const key=randomUUID();
 const first=await h.deletions.confirmDelete(h.actor,fresh.id,fresh.hash,key,true);
 const again=await h.deletions.confirmDelete(h.actor,fresh.id,fresh.hash,key,true);
 assert.equal(first.id,again.id);
 await assert.rejects(()=>h.deletions.confirmDelete(h.actor,fresh.id,fresh.hash,randomUUID(),true),{code:'DELETE_CLOSED'});
 assert.equal(await h.db.job.count({where:{type:'DELETE',targetId:fresh.id}}),1);
 // 업로드 진행 중인 항목은 삭제 계획 자체를 막는다.
 const busy=await h.version(await h.item('업로드 중 삭제'),{'c.bin':bin('c')});
 await h.uploads.createBatch(h.actor,{requestKey:randomUUID(),items:[{itemId:busy.id,baseVersionId:busy.currentVersionId,revision:busy.revision,files:[{path:'d.bin',size:'1'}]}]});
 await assert.rejects(()=>h.deletions.createDeletePlan(h.actor,busy.id),{code:'UPLOAD_ACTIVE'});
 // 삭제 중(DELETE_PENDING)인 소스에는 새 버전 공개·연결을 할 수 없다.
 await assert.rejects(()=>h.uploads.createBatch(h.actor,{requestKey:randomUUID(),items:[{itemId:a.id,baseVersionId:a.currentVersionId,revision:a.revision,files:[{path:'e.bin',size:'1'}]}]}),{status:410});
});

test('DEL-07: NAS removal failure is PARTIAL, keeps the item hidden, and an idempotent retry completes',async()=>{
 const record=await h.version(await h.item('NAS 실패 삭제'),{'x.bin':bin('x'),'y.bin':bin('y')});
 const files=await h.db.archiveFile.findMany({where:{archive:{itemVersionId:record.currentVersionId!}},orderBy:{relativePath:'asc'}});
 const blocked=await h.objectFile(files[0].storageObjectId);
 const plan=await h.deletions.createDeletePlan(h.actor,record.id);
 await h.deletions.confirmDelete(h.actor,plan.id,plan.hash,randomUUID(),true);
 // 파일 대신 비어 있지 않은 폴더가 있으면 unlink가 실패한다(잠금·권한 거절 모사).
 await rm(blocked);await mkdir(blocked);await writeFile(path.join(blocked,'lock'),'');
 const first=await h.deletions.processDelete(h.actor,plan.id,async()=>{});
 assert.equal(first.partial,true);
 assert.equal((await h.db.deleteRequest.findUniqueOrThrow({where:{id:plan.id}})).state,'PARTIAL');
 assert.equal((await h.db.archiveItem.findUniqueOrThrow({where:{id:record.id}})).lifecycle,'DELETE_PENDING','실패 중에는 완료로 표시하지 않음');
 assert.equal(await h.db.deleteEntry.count({where:{requestId:plan.id,state:'FAILED'}}),1);
 await assert.rejects(()=>h.catalog.detail(h.actor,record.id),{status:410});
 await rm(blocked,{recursive:true});
 const second=await h.deletions.processDelete(h.actor,plan.id,async()=>{});
 assert.equal(second.completed,true);
 assert.equal(await h.db.deleteEntry.count({where:{requestId:plan.id,state:'FAILED'}}),0);
 assert.equal((await h.db.archiveItem.findUniqueOrThrow({where:{id:record.id}})).lifecycle,'DELETED');
});

test('UPL-07: a commit interrupted after copying bytes publishes nothing and resumes to exactly one new version',async()=>{
 const{ArchiveError}=await import('../../lib/archive/errors');
 const record=await h.version(await h.item('확정 중 중단'),{'keep.bin':bin('v1-keep'),'swap.bin':bin('v1-swap')});
 const v1=record.currentVersionId!;
 const{sha256}=await import('../../lib/archive/hash');
 const files={'swap.bin':bin('v2-swap'),'add.bin':bin('v2-add')};
 const batch=await h.uploads.createBatch(h.actor,{requestKey:randomUUID(),items:[{itemId:record.id,baseVersionId:v1,revision:record.revision,files:Object.entries(files).map(([p,b])=>({path:p,size:String(b.length)}))}]});
 for(const s of batch.sessions){const c=files[s.path as keyof typeof files];await h.uploads.registerSessionChecksum(h.actor,s.id,sha256(c));await h.uploads.receivePart(h.actor,s.id,0,c);await h.uploads.completeSession(h.actor,s.id);}
 const latest=await h.uploads.batchStatus(h.actor,batch.id);
 const queued=await h.uploads.commitBatch(h.actor,batch.id,Object.fromEntries(latest.plans.map(p=>[p.id,p.hash])));
 // worker가 일부 파일을 보존 NAS에 쓴 뒤 소유권을 잃은 상황(프로세스 중단·lease 만료)
 let calls=0;
 await assert.rejects(()=>h.uploads.processCommit(h.actor,batch.id,async()=>{if(++calls>4)throw new ArchiveError(409,'LEASE_LOST','중단 모사');}),{code:'LEASE_LOST'});
 const after=await h.db.archiveItem.findUniqueOrThrow({where:{id:record.id}});
 assert.equal(after.currentVersionId,v1,'중단 중에는 대표가 바뀌지 않음');
 assert.equal(await h.db.itemVersion.count({where:{itemId:record.id,state:'READY'}}),1,'새 공개 버전 없음');
 const oldKeep=await h.db.archiveFile.findFirstOrThrow({where:{archive:{itemVersionId:v1},relativePath:'swap.bin'}});
 const oldBody=await h.downloads.fileContent(h.actor,oldKeep.id,new Request('http://localhost/x'));
 assert.equal(Buffer.from(await oldBody.arrayBuffer()).toString(),'v1-swap','기존 버전 bytes 불변');
 // 같은 job을 다시 실행하면 같은 draft를 이어서 확정한다.
 await h.finish(queued.jobId!);
 const done=await h.db.archiveItem.findUniqueOrThrow({where:{id:record.id}});
 const published=await h.db.itemVersion.findMany({where:{itemId:record.id,state:'READY'},orderBy:{versionNo:'asc'}});
 assert.deepEqual(published.map(v=>v.versionNo),[1n,2n]);
 assert.equal(done.currentVersionId,published[1].id);
 const v2files=await h.db.archiveFile.findMany({where:{archive:{itemVersionId:published[1].id}},orderBy:{relativePath:'asc'}});
 assert.deepEqual(v2files.map(f=>f.relativePath),['add.bin','keep.bin','swap.bin']);
 assert.equal(await h.db.itemVersion.count({where:{itemId:record.id}}),2,'draft를 중복 생성하지 않음');
 const sessionObjects=(await h.db.uploadSession.findMany({where:{batchId:batch.id}})).map(s=>s.objectId);
 for(const id of sessionObjects)assert.ok(v2files.some(f=>f.storageObjectId===id),'중단 전에 쓴 객체를 재사용');
});

test('AR-04/SRC-01: used-confirmed links keep confirmer and evidence and are reverse-searchable',async()=>{
 const source=await h.version(await h.item('실사용 위성','MODEL3D',['SOURCE']),{'sat.fbx':fbx('sat')});
 const result=await h.version(await h.item('실사용 결과'),{'r.bin':bin('r')},{sources:[source.currentVersionId!],linkDetails:{[source.currentVersionId!]:{relation:'USED_CONFIRMED',evidence:'3번 컷 위성 모델'}}});
 const detail=await h.catalog.detail(h.actor,result.id);
 assert.equal(detail.selectedVersion!.sources[0].relation,'USED_CONFIRMED');
 assert.equal(detail.selectedVersion!.sources[0].evidence,'3번 컷 위성 모델');
 assert.equal(detail.selectedVersion!.sources[0].confirmedBy,'테스트 관리자');
 const used=await h.catalog.usedBy(h.actor,source.id);
 assert.equal(used.items[0].itemId,result.id);assert.equal(used.items[0].relation,'USED_CONFIRMED');
 // 같은 근거로 새 버전을 만들면 최초 확인자를 유지하고, 과거 버전 연결은 바뀌지 않는다.
 const firstLink=await h.db.itemLink.findFirstOrThrow({where:{fromVersionId:result.currentVersionId!}});
 const next=await h.version(result,{'r.bin':bin('r2')},{sources:[source.currentVersionId!],linkDetails:{[source.currentVersionId!]:{relation:'USED_CONFIRMED',evidence:'3번 컷 위성 모델'}}});
 const secondLink=await h.db.itemLink.findFirstOrThrow({where:{fromVersionId:next.currentVersionId!}});
 assert.equal(secondLink.confirmedAt?.getTime(),firstLink.confirmedAt?.getTime());
 assert.equal((await h.catalog.usedBy(h.actor,source.id)).items.length,2,'과거 버전 연결도 역탐색에 표시');
 // 연결하지 않은 대상의 확인 정보와 공개 버전 연결의 직접 수정은 거절된다.
 await assert.rejects(()=>h.uploads.createBatch(h.actor,{requestKey:randomUUID(),items:[{itemId:result.id,baseVersionId:next.currentVersionId,revision:next.revision,files:[],replaceSources:true,linkDetails:{[randomUUID()]:{relation:'USED_CONFIRMED',evidence:''}}}]}),{code:'INVALID_LINK_DETAIL'});
 await assert.rejects(()=>h.db.itemLink.update({where:{id:firstLink.id},data:{relation:'ASSOCIATED'}}));
});

test('VER-02/03, AR-14: version description and memo edits keep revisions without new file versions',async()=>{
 const record=await h.version(await h.item('설명 이력'),{'a.bin':bin('a')},{versionDescription:'첫 렌더'});
 const versionId=record.currentVersionId!;
 let desc=await h.catalog.versionDescription(h.actor,versionId);
 assert.equal(desc.description,'첫 렌더');assert.equal(desc.history.length,1);
 await h.catalog.updateVersionDescription(h.actor,versionId,'색 보정 수정',desc.revision);
 await assert.rejects(()=>h.catalog.updateVersionDescription(h.actor,versionId,'오래된 수정',desc.revision),{code:'REVISION_CONFLICT'});
 desc=await h.catalog.versionDescription(h.actor,versionId);
 assert.equal(desc.description,'색 보정 수정');assert.deepEqual(desc.history.map(x=>x.body),['색 보정 수정','첫 렌더']);
 assert.equal(await h.db.itemVersion.count({where:{itemId:record.id}}),1,'설명 수정은 파일 버전을 만들지 않음');
 const memo=await h.db.memo.create({data:{teamId:h.actor.teamId,versionId,authorId:h.actor.userId,authorName:'테스트 관리자',body:'처음 메모'}});
 await h.catalog.updateMemo(h.actor,memo.id,'고친 메모',1);
 await assert.rejects(()=>h.catalog.updateMemo(h.actor,memo.id,'충돌',1),{code:'REVISION_CONFLICT'});
 const history=await h.catalog.memoHistory(h.actor,memo.id);
 assert.deepEqual(history.history.map(x=>x.body),['고친 메모','처음 메모']);
 await h.catalog.saveMetadata(h.actor,{projectId:h.projectId,title:'설명 이력(수정)',kind:'FILE',roles:['RESULT'],revision:(await h.db.archiveItem.findUniqueOrThrow({where:{id:record.id}})).revision},record.id);
 const revisions=await h.catalog.metadataHistory(h.actor,record.id);
 assert.ok(revisions.length>=2,JSON.stringify(revisions.map(r=>r.revision)));assert.equal((revisions[0].snapshot as {title:string}).title,'설명 이력(수정)');
});
