import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=path.resolve(process.env.QA_DATA_ROOT||'.local/qa-ui-20261029');
assert.ok(path.basename(root).startsWith('qa-'),'QA 전용 폴더만 사용합니다.');
const secrets=JSON.parse(await readFile(path.join(root,'dev-secrets.json'),'utf8'));
const origin='http://localhost:3000',jar=new Map<string,string>();
async function request(url:string,method='GET',body?:unknown,headers:Record<string,string>={}){
 const raw=body instanceof Uint8Array||body instanceof URLSearchParams;
 const response=await fetch(origin+url,{method,headers:{...(method!=='GET'?{Origin:origin}:{}),...(body&&!raw?{'Content-Type':'application/json'}:{}),...(body instanceof URLSearchParams?{'Content-Type':'application/x-www-form-urlencoded'}:{}),Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...headers},body:body===undefined?undefined:raw?body:JSON.stringify(body),redirect:'manual'});
 for(const cookie of response.headers.getSetCookie()){const first=cookie.split(';')[0],index=first.indexOf('=');jar.set(first.slice(0,index),first.slice(index+1));}
 return response;
}
async function call<T=Record<string,unknown>>(url:string,method='GET',body?:unknown):Promise<T>{
 const r=await request('/api/archive/'+url,method,body);const data=await r.json();
 assert.ok(r.ok,url+': '+r.status+' '+(data.error?.message||''));return data as T;
}
const setup=await call<{configured:boolean;initialized:boolean}>('setup');
assert.equal(setup.configured,true);
if(!setup.initialized)await call('setup','POST',{token:secrets.bootstrap,email:'qa@archive.test',password:'qa-fixture-password-2026!',name:'검증 담당자',teamName:'QA · 격리된 검증'});
const csrf=await (await request('/api/auth/csrf')).json();
const signin=await request('/api/auth/callback/credentials','POST',new URLSearchParams({csrfToken:csrf.csrfToken,email:'qa@archive.test',password:'qa-fixture-password-2026!',json:'true',callbackUrl:origin+'/archive'}));
assert.ok(signin.ok);
const context=await call<{team:{name:string};roots:{path:string}[]}>('context');
assert.equal(context.team.name,'QA · 격리된 검증');
assert.ok(context.roots.every(r=>path.resolve(r.path).startsWith(root+path.sep)));
assert.equal((await fetch(origin+'/api/archive/items')).status,401);
assert.equal((await request('/api/archive/projects','POST',{title:'CSRF test'},{Origin:'https://invalid.example'})).status,403);
const project=await call<{id:string}>('projects','POST',{title:'[검증용] 우주 제작',description:'자동 기능 검증 전용 자료'});
async function upload(title:string,kind:string,filename:string,buffer:Buffer,year:number,roles=['RESULT'],sourceVersionIds:string[]=[]){
 const item=await call<{id:string;revision:number}>('items','POST',{projectId:project.id,title,kind,roles,broadcastYear:year,broadcastTitle:'검증용 제작물',description:'이 자료는 격리된 QA 환경에서 업로드·다운로드를 검증하기 위해 생성했습니다.',keywords:['우주','QA']});
 const batch=await call<{id:string;sessions:{id:string}[];plans:{id:string;hash:string}[]}>('upload-batches','POST',{requestKey:randomUUID(),items:[{itemId:item.id,revision:item.revision,baseVersionId:null,files:[{path:filename,size:String(buffer.length)}],sourceVersionIds,replaceSources:true}]});
 const session=batch.sessions[0];await call('uploads/'+session.id+'/checksum','POST',{checksum:createHash('sha256').update(buffer).digest('hex')});
 assert.equal((await request('/api/archive/uploads/'+session.id+'/parts/0','PUT',new Uint8Array(buffer))).status,200);
 await call('uploads/'+session.id+'/complete','POST',{});
 const queued=await call<{jobId:string}>('upload-batches/'+batch.id+'/commit','POST',{planHashes:Object.fromEntries(batch.plans.map(p=>[p.id,p.hash]))});
 for(let attempt=0;attempt<120;attempt++){const job=await call<{state:string;error?:string}>('jobs/'+queued.jobId);if(job.state==='COMPLETED')break;assert.notEqual(job.state,'FAILED',job.error);await new Promise(r=>setTimeout(r,500));assert.ok(attempt<119);}
 const detail=await call<{versionId:string;selectedVersion:{files:{id:string}[]}}>('items/'+item.id);
 const original=await request('/api/archive/files/'+detail.selectedVersion.files[0].id+'/content');assert.deepEqual(Buffer.from(await original.arrayBuffer()),buffer);
 return {itemId:item.id,versionId:detail.versionId,fileId:detail.selectedVersion.files[0].id};
}
const source=await upload('[검증용] 인공위성 FBX','MODEL3D','Satellite.fbx',Buffer.from('; FBX QA fixture - satellite source bytes'),2026,['SOURCE']);
const png=await sharp({create:{width:1280,height:720,channels:4,background:'#294956'}}).png().toBuffer();
const image=await upload('[검증용] 지구 키비주얼','IMAGE','Earth.png',png,2026,['RESULT'],[source.versionId]);
const image2=await upload('[검증용] 방송 이미지','IMAGE','Title.png',await sharp({create:{width:1280,height:720,channels:4,background:'#49465e'}}).png().toBuffer(),2025);
const videoFixture=path.join(root,'qa-original.mp4');
await promisify(execFile)(ffmpeg!,['-nostdin','-f','lavfi','-i','color=c=0x193b46:s=320x180:r=12','-t','0.5','-c:v','libx264','-pix_fmt','yuv420p','-y',videoFixture],{windowsHide:true,timeout:30000});
const video=await upload('[검증용] 영상 AV1 프리뷰','VIDEO','Final.mp4',await readFile(videoFixture),2026,['RESULT'],[source.versionId]);
for(const [record,type,mime] of [[image,'WEBP:','image/webp'],[video,'AV1','video/webm']] as const){
 let ready:string|undefined;
 for(let attempt=0;attempt<120;attempt++){
  const detail=await call<{selectedVersion:{previews:{id:string;type:string;state:string}[]}}>('items/'+record.itemId);
  const preview=detail.selectedVersion.previews.find(p=>p.type.startsWith(type));assert.notEqual(preview?.state,'FAILED');
  if(preview?.state==='READY'){ready=preview.id;break;}await new Promise(r=>setTimeout(r,500));
 }
 assert.ok(ready,'미리보기 준비');const media=await request('/api/archive/media/'+ready);assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),mime);assert.ok((await media.arrayBuffer()).byteLength>0);
}
const page=await call<{items:{id:string}[];nextCursor:string|null}>('items?limit=1');
assert.equal(page.items.length,1);assert.ok(page.nextCursor);
const next=await call<{items:{id:string}[]}>('items?limit=1&cursor='+encodeURIComponent(page.nextCursor!));
assert.notEqual(next.items[0].id,page.items[0].id);
assert.equal((await request('/api/archive/items?limit=1&kind=IMAGE&cursor='+encodeURIComponent(page.nextCursor!))).status,400);
const literal=await call<{totalCount:number}>('items?q=%25');assert.equal(literal.totalCount,0);
const ranged=await request('/api/archive/files/'+image.fileId+'/content','GET',undefined,{Range:'bytes=0-7'});assert.equal(ranged.status,206);
const deletion=await call<{plan:{shared:unknown[];items:unknown[]}}>('items/'+image.itemId+'/delete-plans','POST',{scope:'resultAndExclusiveSources'});
assert.equal(deletion.plan.shared.length,1);assert.equal(deletion.plan.items.length,1);
await writeFile(path.join(root,'qa-result.json'),JSON.stringify({projectId:project.id,source,image,image2,video},null,2));
console.log('HTTP QA 통과: 로그인, 권한/CSRF, 4개 자료 업로드·원본 대조, 페이지·검색·Range·공유 삭제 계획. 비밀 값은 출력하지 않았습니다.');
