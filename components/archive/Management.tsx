'use client';
import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Context,Job,Plan,DeletePlan } from './types';
import { api,post,date,stateLabel } from './client';
import { Empty,ErrorBox,Icon,Loading } from './ui';
import { PlanPanel } from './PlanPanel';
import { IntegrityPanel } from './Overview';
const jobNames:Record<string,string>={COMMIT:'버전 보존·검증',PREVIEW:'AV1·WebP 미리보기',DOWNLOAD:'전체 다운로드 준비',DELETE:'아카이브 삭제',SCAN:'NAS 원본 조사',IMPORT:'NAS 보존 등록',RESTORE:'새 작업공간 복원',MAINTENANCE:'정리·무결성 점검'};
function SourcePlan({id}:{id:string}){
 const{data:plan,error,mutate}=useSWR<Plan>(['source-plan',id],()=>api('plans/'+id),{shouldRetryOnError:false});
 const[message,setMessage]=useState(''),[failure,setFailure]=useState<unknown>(null);
 if(!plan)return <><ErrorBox error={error}/>{!error&&<Loading/>}</>;
 return <div><PlanPanel key={plan.revision} plan={plan} onUpdate={async()=>{await mutate();}}/><ErrorBox error={failure}/>{message?<p className="notice">{message}</p>:<button className="button primary" disabled={plan.state!=='READY'} onClick={async()=>{try{await post('plans/'+id+'/execute',{hash:plan.hash});setMessage('원본 읽기 전용 복사 작업을 접수했습니다. 아래 작업 목록에서 진행을 확인하세요.');}catch(e){setFailure(e);}}}>확인한 파일을 NAS에 보존</button>}</div>;
}
function DeleteReport({id}:{id:string}){
 const{data,error,mutate}=useSWR<DeletePlan>(['deletion',id],()=>api('delete-requests/'+id),{refreshInterval:2500,shouldRetryOnError:false});
 const[failure,setFailure]=useState<unknown>(null);
 const cancel=async()=>{try{await post('delete-requests/'+id+'/cancel');await mutate();}catch(error){setFailure(error);}};
 const cancelButton=data?.state==='CONFIRMED'&&!data.startedAt?<button className="button button-small" onClick={cancel}>물리 삭제 시작 전 취소</button>:null;
 return <div className="delete-report"><ErrorBox error={error||failure}/>{cancelButton}{data&&<><p><b>{stateLabel[data.state]||data.state}</b> · 대상 {data.plan.items.map(i=>i.title).join(', ')}</p>{data.plan.shared.length>0&&<p className="preserved-note">공유 소스 보존: {data.plan.shared.map(i=>i.title).join(', ')}</p>}<p>{data.entries.filter(e=>e.state==='PURGED').length}개 물리 객체 제거 · {data.entries.filter(e=>e.state==='RETAINED').length}개 공유 참조 보존 · {data.entries.filter(e=>e.state==='FAILED').length}개 실패</p>{data.entries.filter(e=>e.state==='FAILED').slice(0,10).map(e=><small key={e.id}>{e.reason}</small>)}</>}</div>;
}
function DraftItems(){
 const{data,mutate}=useSWR<{id:string;title:string;kind:string;createdAt:string}[]>('archive-drafts',()=>api('items/drafts'),{refreshInterval:10000,shouldRetryOnError:false});
 const[confirming,setConfirming]=useState<string|null>(null),[failure,setFailure]=useState<unknown>(null);
 if(!data?.length)return null;
 const discard=async(id:string)=>{try{const plan=await post<{id:string;hash:string}>('items/'+id+'/delete-plans',{scope:'resultOnly'});await post('delete-requests',{planId:plan.id,hash:plan.hash,confirmed:true,requestKey:crypto.randomUUID()});setConfirming(null);await mutate();}catch(e){setFailure(e);}};
 return <section className="content-panel"><h2>보존 버전이 없는 등록 항목</h2><p className="small-note">업로드가 실패·취소되어 첫 버전이 없는 항목입니다. 홈에는 표시되지 않습니다.</p><ErrorBox error={failure}/>{data.map(item=><div className="operation-row" key={item.id}><Icon name="clock"/><div><b>{item.title}</b><small>{date(item.createdAt)}</small></div><Link className="button button-small" href={'/archive/items/'+item.id+'/edit'}>파일 업로드 계속</Link>{confirming===item.id?<><button className="button button-small" onClick={()=>discard(item.id)}>등록 취소 확인</button><button className="text-button" onClick={()=>setConfirming(null)}>유지</button></>:<button className="text-button" onClick={()=>setConfirming(item.id)}>등록 취소</button>}</div>)}</section>;
}
export function JobsPage({context}:{context:Context}){
 const{data:jobs,error,mutate}=useSWR<Job[]>('archive-jobs',()=>api('jobs'),{refreshInterval:2000,shouldRetryOnError:false});
 const{data:batches,mutate:refreshBatches}=useSWR<{id:string;state:string;createdAt:string}[]>('archive-batches',()=>api('upload-batches'),{refreshInterval:5000,shouldRetryOnError:false});
 const[selected,setSelected]=useState<string|null>(null),[failure,setFailure]=useState<unknown>(null);
 return <div className="page-container"><div className="page-heading"><span className="eyebrow">ARCHIVE OPERATIONS</span><h1>작업 관리</h1><p>업로드, 보존 검증, 미리보기, 다운로드와 삭제의 진행을 확인하세요.</p></div><ErrorBox error={error||failure}/>
  <DraftItems/>
  {!!batches?.length&&<section className="content-panel"><h2>진행 중이거나 중단된 업로드</h2>{batches.map(b=><div className="operation-row" key={b.id}><Icon name="folder"/><div><b>{stateLabel[b.state]||b.state}</b><small>{date(b.createdAt)}</small></div><Link className="button button-small" href={'/archive/new?resume='+b.id}>{b.state==='UPLOADING'?'이어서 업로드':'상세 확인'}</Link>{b.state==='UPLOADING'&&<button className="text-button" onClick={async()=>{try{await post('upload-batches/'+b.id+'/cancel');refreshBatches();}catch(e){setFailure(e);}}}>취소</button>}</div>)}</section>}
  {!jobs&&!error?<Loading/>:!jobs?.length?<Empty title="아직 실행한 작업이 없습니다" description="원본을 등록하면 보존·변환 작업을 여기에서 확인할 수 있습니다."/>:<div className="jobs-list">{jobs.map(job=><section className="job-card" key={job.id}><div className="job-header"><span className={'status-dot '+job.state.toLowerCase()}/><div><h3>{jobNames[job.type]||job.type}</h3><small>{date(job.createdAt)}</small></div><span className={'status-label '+job.state.toLowerCase()}>{stateLabel[job.state]||job.state}</span></div><ErrorBox error={job.error}/>{job.state==='RUNNING'&&typeof job.progress?.total==='number'&&job.progress.total>0&&<div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={job.progress.total} aria-valuenow={job.progress.done||0}><span style={{width:Math.round(100*(job.progress.done||0)/job.progress.total)+'%'}}/></div>}{job.type==='MAINTENANCE'&&job.state==='COMPLETED'&&job.result&&<p className="small-note">정리: 만료 업로드 {String(job.result.expiredBatches??0)} · 미확정 버전 {String(job.result.abandonedDrafts??0)} · 회수 객체 {String(job.result.purgedObjects??0)} · 무결성 확인 {String((job.result.integrity as {checked?:number})?.checked??0)}</p>}
   <div className="inline-actions">{job.state==='FAILED'&&<button className="button button-small" onClick={async()=>{try{await post('jobs/'+job.id+'/retry');mutate();}catch(e){setFailure(e);}}}>같은 작업 재시도</button>}
   {job.type==='DOWNLOAD'&&job.state==='COMPLETED'&&<a className="button button-small primary" href={'/api/archive/downloads/'+job.id+'/content'}><Icon name="download" size={16}/>ZIP 다운로드</a>}
   {job.type==='SCAN'&&job.result?.planId&&<button className="button button-small" onClick={()=>setSelected(selected===job.id?null:job.id)}>보존 계획 확인</button>}
   {job.type==='DELETE'&&<button className="button button-small subtle" onClick={()=>setSelected(selected===job.id?null:job.id)}>삭제 범위·파일 처리 결과</button>}
   {['PREVIEW','RESTORE'].includes(job.type)&&<Link className="text-button" href={'/archive/jobs'}>{job.type==='RESTORE'&&job.state==='COMPLETED'?'파일 복원 검증 완료 · 에디터 열기 별도':'원본 보존 상태와 별도로 처리'}</Link>}</div>
   {selected===job.id&&job.type==='SCAN'&&job.result?.planId&&<SourcePlan id={job.result.planId}/>}
   {selected===job.id&&job.type==='DELETE'&&<DeleteReport id={job.targetId}/>}
   {job.type==='RESTORE'&&job.result?.workspaceId&&<p className="small-note">복원 폴더: 관리자가 설정한 복원 루트 / {job.result.workspaceId}</p>}
  </section>)}</div>}
 </div>;
}
export function ProjectsPage({context,onChange}:{context:Context;onChange:()=>void}){
 const[title,setTitle]=useState(''),[description,setDescription]=useState(''),[error,setError]=useState<unknown>(null);
 return <div className="page-container"><div className="page-heading"><span className="eyebrow">PRODUCTION PROJECTS</span><h1>제작 건</h1><p>하나의 제작에 속한 결과물과 소스를 함께 모읍니다.</p></div><ErrorBox error={error}/>
  {context.user.role!=='VIEWER'&&<form className="content-panel inline-create" onSubmit={async e=>{e.preventDefault();try{await post('projects',{title,description});setTitle('');setDescription('');onChange();}catch(e){setError(e);}}}><input aria-label="제작 건 이름" placeholder="새 제작 건 이름" value={title} onChange={e=>setTitle(e.target.value)} required maxLength={200}/><input aria-label="제작 건 설명" placeholder="설명 (선택)" value={description} onChange={e=>setDescription(e.target.value)} maxLength={5000}/><button className="button primary"><Icon name="plus" size={17}/>제작 건 만들기</button></form>}
  <div className="project-grid">{context.projects.map(p=><Link key={p.id} href={'/archive/projects/'+p.id} className="project-card"><span className="file-icon"><Icon name="folder" size={30}/></span><h2>{p.title}</h2><p>결과물·소스·UE·참여자·이력 보기<Icon name="arrow" size={16}/></p></Link>)}</div>{!context.projects.length&&<Empty title="제작 건부터 시작하세요" description="방송·프로그램·제작 단위로 아카이브를 정리할 수 있습니다."/>}
 </div>;
}
export function SettingsPage({context,onChange}:{context:Context;onChange:()=>void}){
 const[error,setError]=useState<unknown>(null),[message,setMessage]=useState('');
 const[user,setUser]=useState({name:'',email:'',password:'',role:'EDITOR'}),[grant,setGrant]=useState({membershipId:'',projectId:'',canEdit:false,canDelete:false,canDownload:true}),[source,setSource]=useState({name:'',path:''}),[facility,setFacility]=useState(''),[category,setCategory]=useState('');
 const perform=async(fn:()=>Promise<unknown>,success:string)=>{setError(null);setMessage('');try{await fn();setMessage(success);onChange();}catch(e){setError(e);}};
 return <div className="page-container settings-page"><div className="page-heading"><span className="eyebrow">TEAM WORKSPACE</span><h1>팀 설정</h1><p>{context.team.name} · {context.user.name}</p></div><ErrorBox error={error}/>{message&&<div className="notice">{message}</div>}
  <section className="content-panel"><h2>파일 서비스</h2><div className="service-cards"><div><span>영상 프리뷰</span><b>AV1</b><small>원본은 NAS 별도 보존</small></div><div><span>이미지·썸네일</span><b>WebP</b><small>원본 해상도·파일 유지</small></div><div><span>메타데이터</span><b>PostgreSQL</b><small>관계형 테이블 + JSONB</small></div></div></section>
  <section className="content-panel"><h2>등록된 저장소</h2>{context.roots.map(root=><div className="storage-row" key={root.id}><Icon name="folder"/><div><b>{root.name}</b><small>{root.kind==='SOURCE'?'제작 원본 · 읽기 전용':root.kind==='ARCHIVE'?'원본 보존':root.kind==='PREVIEW'?'AV1·WebP':'임시 전송'}{root.path?' · '+root.path:''}</small></div><span className="muted">설정 등록됨</span></div>)}</section>
  {context.user.role==='ADMIN'&&<IntegrityPanel/>}
  {context.user.role==='ADMIN'&&<div className="settings-grid">
   <section className="content-panel"><h2>팀원 계정 등록</h2><form className="stack-form" onSubmit={e=>{e.preventDefault();perform(()=>post('admin/users',user),'팀원을 등록했습니다.');}}><label>이름<input value={user.name} onChange={e=>setUser({...user,name:e.target.value})} required/></label><label>이메일<input type="email" value={user.email} onChange={e=>setUser({...user,email:e.target.value})} required/></label><label>초기 비밀번호<input type="password" value={user.password} onChange={e=>setUser({...user,password:e.target.value})} required minLength={12} autoComplete="new-password"/></label><label>역할<select value={user.role} onChange={e=>setUser({...user,role:e.target.value})}><option value="VIEWER">조회자</option><option value="EDITOR">편집자</option><option value="ADMIN">관리자</option></select></label><button className="button">팀원 등록</button></form></section>
   <section className="content-panel"><h2>제작 건별 접근 권한</h2><form className="stack-form" onSubmit={e=>{e.preventDefault();perform(()=>post('admin/access',grant),'접근 권한을 저장했습니다.');}}><label>팀원<select required value={grant.membershipId} onChange={e=>setGrant({...grant,membershipId:e.target.value})}><option value="">선택</option>{context.users.map(u=><option key={u.id} value={u.membershipId}>{u.name} · {u.role}</option>)}</select></label><label>제작 건<select required value={grant.projectId} onChange={e=>setGrant({...grant,projectId:e.target.value})}><option value="">선택</option>{context.projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>{([['canEdit','편집·업로드'],['canDelete','삭제'],['canDownload','원본 다운로드']] as const).map(([key,label])=><label className="checkbox-label" key={key}><input type="checkbox" checked={grant[key]} onChange={e=>setGrant({...grant,[key]:e.target.checked})}/>{label}</label>)}<p className="small-note">편집·삭제는 편집자 역할과 해당 권한이 함께 필요합니다. 관리자는 팀 내 전체 제작 건을 관리합니다.</p><button className="button">권한 저장</button></form></section>
   <section className="content-panel"><h2>승인 원본 NAS 등록</h2><p className="small-note">서버에서 승인한 경로만 등록할 수 있습니다. 보존 NAS와 분리된 제작 원본을 지정하세요.</p><form className="stack-form" onSubmit={e=>{e.preventDefault();perform(()=>post('admin/sources',source),'원본 저장소를 등록했습니다.');}}><label>이름<input value={source.name} onChange={e=>setSource({...source,name:e.target.value})} required placeholder="팀 제작 원본"/></label><label>승인 경로<input value={source.path} onChange={e=>setSource({...source,path:e.target.value})} required placeholder="서버에 승인된 NAS 경로"/></label><button className="button">원본 NAS 등록</button></form></section>
   <section className="content-panel"><h2>제작 기준정보</h2><form className="inline-create" onSubmit={e=>{e.preventDefault();perform(()=>post('admin/facilities',{name:facility}),'제작부조를 등록했습니다.');}}><input aria-label="제작부조 이름" placeholder="제작부조 이름" required value={facility} onChange={e=>setFacility(e.target.value)}/><button className="button">추가</button></form><div className="tags">{context.facilities.map(f=><span key={f.id}>{f.name}</span>)}</div><form className="inline-create" onSubmit={e=>{e.preventDefault();perform(()=>post('admin/categories',{name:category}),'종류를 등록했습니다.');}}><input aria-label="종류 이름" placeholder="종류 이름" required value={category} onChange={e=>setCategory(e.target.value)}/><button className="button">추가</button></form><div className="tags">{context.categories.map(c=><span key={c.id}>{c.name}</span>)}</div></section>
  </div>}
 </div>;
}

