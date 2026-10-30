// E2E-H(빈 PostgreSQL 신규 구축): 빈 DB → 초기 설정 키로 첫 관리자·팀 등록 → 제작 건·조회 전용 계정 준비.
import { request,type FullConfig } from '@playwright/test';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ADMIN,VIEWER,statePath } from './fixtures';
export default async function globalSetup(_config:FullConfig){
 const root=process.env.E2E_DATA_ROOT!,base=process.env.E2E_BASE_URL!;
 if(!path.basename(root).startsWith('qa-'))throw new Error('E2E는 qa- 로 시작하는 격리 폴더에서만 실행합니다.');
 const secrets=JSON.parse(await readFile(path.join(root,'dev-secrets.json'),'utf8'));
 const api=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}});
 const status=await (await api.get('/api/archive/setup')).json();
 if(!status.configured)throw new Error('개발 DB가 준비되지 않았습니다.');
 if(!status.initialized){
  const r=await api.post('/api/archive/setup',{data:{token:secrets.bootstrap,email:ADMIN.email,password:ADMIN.password,name:ADMIN.name,teamName:'QA · E2E 격리 팀'}});
  if(r.status()!==201)throw new Error('초기 설정 실패: '+await r.text());
  // 초기화 재실행은 거절되어야 한다(중복 관리자·팀 0).
  const again=await api.post('/api/archive/setup',{data:{token:secrets.bootstrap,email:'second@e2e.test',password:'another-password-123!',name:'두 번째',teamName:'중복'}});
  if(again.status()!==409)throw new Error('초기 설정 재실행이 거절되지 않았습니다: '+again.status());
 }
 await mkdir(path.dirname(statePath('admin')),{recursive:true});
 for(const account of [ADMIN,VIEWER]){
  const ctx=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}});
  if(account===VIEWER){
   const admin=await login(ADMIN);
   const created=await admin.post('/api/archive/admin/users',{data:{name:VIEWER.name,email:VIEWER.email,password:VIEWER.password,role:'VIEWER'}});
   if(![201,409].includes(created.status()))throw new Error('조회 계정 생성 실패: '+await created.text());
   await admin.dispose();
  }
  await ctx.dispose();
  const session=await login(account);
  await session.storageState({path:statePath(account===ADMIN?'admin':'viewer')});
  await session.dispose();
 }
 const admin=await login(ADMIN);
 const projects=await (await admin.get('/api/archive/projects')).json() as {id:string;title:string}[];
 if(!projects.some(p=>p.title==='E2E 우주 특집'))await admin.post('/api/archive/projects',{data:{title:'E2E 우주 특집',description:'브라우저 자동 검증 전용 제작 건'}});
 await writeFile(path.join(root,'e2e-ready.json'),JSON.stringify({at:new Date().toISOString()}));
 await admin.dispose();await api.dispose();
 async function login(account:{email:string;password:string}){
  const ctx=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}});
  const{csrfToken}=await (await ctx.get('/api/auth/csrf')).json();
  const r=await ctx.post('/api/auth/callback/credentials',{form:{csrfToken,email:account.email,password:account.password,json:'true',callbackUrl:base+'/archive'}});
  if(!r.ok())throw new Error('로그인 실패: '+account.email);
  return ctx;
 }
}
