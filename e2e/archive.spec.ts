// TDD 10장 E2E 시나리오(브라우저). 실제 UE 에디터·SMB 장애·백업 복구(E2E-C/D 일부)는 운영 시험 체크리스트로 분리한다.
import { test,expect,type APIRequestContext,type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { statePath,sha,png,fbx } from './fixtures';

test.use({storageState:statePath('admin')});
test.describe.configure({mode:'serial'});

const base=()=>process.env.E2E_BASE_URL!;
async function call<T>(api:APIRequestContext,url:string,method='GET',data?:unknown):Promise<T>{
 const r=await api.fetch('/api/archive/'+url,{method,data,headers:{Origin:base()}});
 const body=await r.json();
 if(!r.ok())throw new Error(url+' '+r.status()+' '+(body.error?.message||''));
 return body as T;
}
// 시나리오 준비용 API 업로드(화면 업로드는 E2E-A/F에서 직접 검증한다).
async function uploadViaApi(api:APIRequestContext,projectId:string,title:string,kind:string,files:Record<string,Buffer>,roles=['RESULT'],sources:string[]=[]){
 const item=await call<{id:string;revision:number}>(api,'items','POST',{projectId,title,kind,roles,broadcastYear:2026,keywords:['E2E']});
 const batch=await call<{id:string;sessions:{id:string;path:string}[];plans:{id:string;hash:string}[]}>(api,'upload-batches','POST',{requestKey:randomUUID(),items:[{itemId:item.id,revision:item.revision,baseVersionId:null,files:Object.entries(files).map(([p,b])=>({path:p,size:String(b.length)})),sourceVersionIds:sources,replaceSources:true}]});
 for(const s of batch.sessions){
  const bytes=files[s.path];
  await call(api,'uploads/'+s.id+'/checksum','POST',{checksum:sha(bytes)});
  const r=await api.fetch('/api/archive/uploads/'+s.id+'/parts/0',{method:'PUT',data:bytes,headers:{Origin:base(),'Content-Type':'application/octet-stream'}});
  expect(r.status()).toBe(200);
  await call(api,'uploads/'+s.id+'/complete','POST',{});
 }
 const queued=await call<{jobId:string}>(api,'upload-batches/'+batch.id+'/commit','POST',{planHashes:Object.fromEntries(batch.plans.map(p=>[p.id,p.hash]))});
 await expect.poll(async()=>(await call<{state:string}>(api,'jobs/'+queued.jobId)).state,{timeout:120_000}).toBe('COMPLETED');
 return call<{id:string;versionId:string}>(api,'items/'+item.id);
}
async function projectId(api:APIRequestContext){return (await call<{id:string;title:string}[]>(api,'projects')).find(p=>p.title==='E2E 우주 특집')!.id;}
async function startTransfer(page:Page){
 await page.getByRole('button',{name:'전송·새 버전 보존'}).click();
 await page.waitForURL(/\/archive\/items\/[0-9a-f-]{36}(\?.*)?$/,{timeout:150_000});
}
async function downloadBytes(page:Page,trigger:()=>Promise<void>){
 const[download]=await Promise.all([page.waitForEvent('download'),trigger()]);
 return readFile((await download.path())!);
}

let resultId='',sourceId='';
let earthV1:Buffer;

test('E2E-H/A/B: empty catalog → image result with new FBX source → card → detail → connected source → exact download',async({page})=>{
 await page.goto('/archive');
 await expect(page.getByRole('heading',{name:'첫 제작물을 보존해 주세요'})).toBeVisible();
 earthV1=await png('#284a5c');
 const satellite=fbx('satellite v1');
 await page.goto('/archive/new');
 await page.getByLabel('제작 건').selectOption({label:'E2E 우주 특집'});
 await page.getByLabel('자료 유형').selectOption('IMAGE');
 await page.getByLabel('제목',{exact:true}).fill('E2E 지구 키비주얼');
 await page.getByLabel('방송연도').fill('2026');
 await page.getByLabel('키워드').fill('지구, E2E');
 await page.locator('.file-picker').first().locator('input[type=file]:not([webkitdirectory])').setInputFiles({name:'Earth.png',mimeType:'image/png',buffer:earthV1});
 await page.getByRole('button',{name:'새 소스 추가'}).click();
 const group=page.locator('.source-group').first();
 await group.getByLabel('새 소스 제목').fill('E2E 인공위성 FBX');
 await group.getByLabel('새 소스 유형').selectOption('MODEL3D');
 await group.locator('input[type=file]:not([webkitdirectory])').setInputFiles({name:'Satellite.fbx',mimeType:'application/octet-stream',buffer:satellite});
 await group.getByLabel('이 결과물에서 실사용 확인').check();
 await group.getByLabel('새 소스 확인 근거').fill('키비주얼 중앙 위성');
 await page.getByRole('button',{name:'등록·보존 계획 확인'}).click();
 await startTransfer(page);
 resultId=page.url().match(/items\/([0-9a-f-]{36})/)![1];
 await expect(page.getByRole('heading',{name:'E2E 지구 키비주얼'})).toBeVisible();
 // 이미지 단독 제작 건: 영상 없이 갤러리·원본 다운로드
 await expect(page.locator('.image-gallery img').first()).toBeVisible({timeout:60_000});
 const original=await downloadBytes(page,()=>page.getByRole('link',{name:'Earth.png 원본 다운로드'}).click());
 expect(sha(original)).toBe(sha(earthV1));
 // 필요할 때 연결 소스를 펼쳐 확인
 await page.locator('details.sources-panel summary').click();
 const sourceRow=page.locator('.sources-panel .source-row').filter({hasText:'E2E 인공위성 FBX'});
 await expect(sourceRow.locator('.relation-badge')).toHaveText('실사용 확인');
 await expect(sourceRow).toContainText('키비주얼 중앙 위성');
 await sourceRow.getByRole('link').click();
 sourceId=page.url().match(/items\/([0-9a-f-]{36})/)![1];
 const fbxBytes=await downloadBytes(page,()=>page.getByRole('link',{name:'Satellite.fbx 원본 다운로드'}).click());
 expect(fbxBytes.equals(satellite)).toBe(true);
 await expect(page.getByRole('heading',{name:/이 소스를 사용하는 작업/})).toBeVisible();
 await expect(page.locator('.source-row').filter({hasText:'E2E 지구 키비주얼'})).toBeVisible();
 // 홈 카드·검색·URL 복원
 await page.goto('/archive');
 await expect(page.locator('.archive-card').filter({hasText:'E2E 지구 키비주얼'})).toBeVisible();
 await page.getByLabel('제목, 키워드, 설명 검색').fill('키비주얼');
 await expect(page).toHaveURL(/q=%ED%82%A4%EB%B9%84%EC%A3%BC%EC%96%BC|q=키비주얼/);
 await page.reload();
 await expect(page.getByLabel('제목, 키워드, 설명 검색')).toHaveValue('키비주얼');
 await expect(page.locator('.archive-card')).toHaveCount(1);
});

test('E2E-F: edit replaces the same path, adds a file, keeps v1 bytes and exposes both versions',async({page})=>{
 const earthV2=await png('#6a3d2a'),notes=await png('#203020',320,180);
 await page.goto('/archive/items/'+resultId+'/edit');
 await page.locator('.file-picker').first().locator('input[type=file]:not([webkitdirectory])').setInputFiles([{name:'Earth.png',mimeType:'image/png',buffer:earthV2},{name:'Notes.png',mimeType:'image/png',buffer:notes}]);
 await page.getByLabel('이번 버전 설명 (선택)').fill('색 보정 버전');
 await page.getByRole('button',{name:'변경 저장·보존 계획 확인'}).click();
 await expect(page.locator('.plan-panel').first()).toContainText('Earth.png');
 await startTransfer(page);
 await expect(page.getByLabel('보존 버전 선택')).toContainText('v2');
 await expect(page.getByText('색 보정 버전')).toBeVisible();
 const v2=await downloadBytes(page,()=>page.getByRole('link',{name:'Earth.png 원본 다운로드'}).click());
 expect(sha(v2)).toBe(sha(earthV2));
 const v1Id=await page.getByLabel('보존 버전 선택').locator('option').filter({hasText:'v1'}).getAttribute('value');
 await page.getByLabel('보존 버전 선택').selectOption(v1Id!);
 await expect(page).toHaveURL(new RegExp('version='+v1Id));
 const v1=await downloadBytes(page,()=>page.getByRole('link',{name:'Earth.png 원본 다운로드'}).click());
 expect(sha(v1)).toBe(sha(earthV1));
 await expect(page.getByRole('link',{name:'Notes.png 원본 다운로드'})).toHaveCount(0);
});

test('E2E-E: a viewer without project access cannot see or fetch results; download permission is enforced',async({browser,request})=>{
 const viewer=await browser.newContext({storageState:statePath('viewer')});
 const page=await viewer.newPage();
 await page.goto('/archive');
 await expect(page.locator('.archive-card')).toHaveCount(0);
 await page.goto('/archive/items/'+resultId);
 await expect(page.locator('.error-box')).toContainText('자료를 찾을 수 없습니다');
 const viewerApi=viewer.request;
 expect((await viewerApi.get('/api/archive/items/'+resultId)).status()).toBe(404);
 expect((await viewerApi.post('/api/archive/items/'+resultId+'/delete-plans',{data:{},headers:{Origin:base()}})).status()).toBe(404);
 // 조회만 허용(원본 다운로드 불가)으로 권한 부여 → 카드는 보이지만 원본은 403
 const context=await call<{users:{email?:string;membershipId:string}[]}>(request,'context');
 const membershipId=context.users.find(u=>u.email==='viewer@e2e.test')!.membershipId;
 await call(request,'admin/access','POST',{membershipId,projectId:await projectId(request),canEdit:false,canDelete:false,canDownload:false});
 await page.goto('/archive');
 await expect(page.locator('.archive-card').filter({hasText:'E2E 지구 키비주얼'})).toBeVisible();
 const detail=await (await viewerApi.get('/api/archive/items/'+resultId)).json();
 expect((await viewerApi.get('/api/archive/files/'+detail.selectedVersion.files[0].id+'/content')).status()).toBe(403);
 await page.goto('/archive/items/'+resultId);
 await expect(page.getByRole('link',{name:'Earth.png 원본 다운로드'})).toHaveCount(0);
 await viewer.close();
});

test('E2E-G: default delete removes the result and its exclusive source, keeps a shared source and the other result',async({page,request})=>{
 const project=await projectId(request);
 const shared=await uploadViaApi(request,project,'E2E 공유 로켓','MODEL3D',{'Rocket.fbx':fbx('rocket')},['SOURCE']);
 const keep=await uploadViaApi(request,project,'E2E 유지 결과','IMAGE',{'Keep.png':await png('#445566')},['RESULT'],[shared.versionId]);
 const target=await uploadViaApi(request,project,'E2E 삭제 결과','IMAGE',{'Gone.png':await png('#665544')},['RESULT'],[shared.versionId]);
 // 기존 결과물(E2E 지구 키비주얼)은 전용 FBX 소스를 가진다.
 await page.goto('/archive/items/'+resultId);
 await page.getByRole('button',{name:'결과물 삭제'}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByLabel(/결과물과 연결 아카이브 함께 삭제/)).toBeChecked();
 await expect(dialog).toContainText('2개 항목');
 await dialog.getByRole('button',{name:'취소'}).click();
 await expect(dialog).toBeHidden();
 expect((await request.get('/api/archive/items/'+resultId)).status()).toBe(200);
 // 공유 소스가 있는 결과물: 공유 소스 보존 안내 후 실제 삭제
 await page.goto('/archive/items/'+target.id);
 await page.getByRole('button',{name:'결과물 삭제'}).click();
 await expect(page.getByRole('dialog')).toContainText('보존되는 소스: E2E 공유 로켓');
 await page.getByRole('dialog').getByRole('button',{name:'확인한 범위 삭제'}).click();
 await page.waitForURL(/\/archive\/jobs/);
 await expect.poll(async()=>(await request.get('/api/archive/items/'+target.id)).status(),{timeout:120_000}).toBe(410);
 expect((await request.get('/api/archive/items/'+shared.id)).status()).toBe(200);
 expect((await request.get('/api/archive/items/'+keep.id)).status()).toBe(200);
 // 전용 소스까지 함께 삭제(기본 선택)
 await page.goto('/archive/items/'+resultId);
 await page.getByRole('button',{name:'결과물 삭제'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'확인한 범위 삭제'}).click();
 await page.waitForURL(/\/archive\/jobs/);
 await expect.poll(async()=>(await request.get('/api/archive/items/'+resultId)).status(),{timeout:120_000}).toBe(410);
 expect((await request.get('/api/archive/items/'+sourceId)).status()).toBe(410);
 await page.goto('/archive');
 await expect(page.locator('.archive-card').filter({hasText:'E2E 지구 키비주얼'})).toHaveCount(0);
 await expect(page.locator('.archive-card').filter({hasText:'E2E 유지 결과'})).toBeVisible();
});

test('Project and integrity screens render for an administrator',async({page})=>{
 await page.goto('/archive/projects');
 await page.getByRole('link',{name:/E2E 우주 특집/}).click();
 await expect(page.getByRole('heading',{name:'E2E 우주 특집'})).toBeVisible();
 await expect(page.getByRole('heading',{name:/제작 결과물/})).toBeVisible();
 await expect(page.getByRole('heading',{name:'참여자'})).toBeVisible();
 await page.goto('/archive/settings');
 await expect(page.getByRole('heading',{name:'보존 무결성·정리'})).toBeVisible();
 await page.getByRole('button',{name:'지금 점검'}).click();
 await expect(page.getByText('점검 작업을 예약했습니다')).toBeVisible();
});
