'use client';
import { useEffect,useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { api,post } from '@/components/archive/client';
import { ErrorBox,Icon } from '@/components/archive/ui';
export default function AuthPage(){
 const router=useRouter(),[status,setStatus]=useState<{configured:boolean;initialized:boolean}|null>(null),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false),[form,setForm]=useState({email:'',password:'',name:'',teamName:'',token:''});
 const refresh=()=>api<{configured:boolean;initialized:boolean}>('setup').then(setStatus).catch(setError);
 useEffect(()=>{refresh();},[]);
 const setup=!!status?.configured&&!status.initialized;
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();setBusy(true);setError(null);
  try{
   if(setup)await post('setup',form);
   const result=await signIn('credentials',{email:form.email,password:form.password,redirect:false});
   if(result?.error)throw new Error('이메일 또는 비밀번호를 확인하세요.');
   router.replace('/archive');router.refresh();
  }catch(error){setError(error);refresh();}finally{setBusy(false);}
 };
 return <div className="auth-page"><div className="auth-brand brand"><span className="brand-mark">N</span><span>NEXTFLIX<small>PRODUCTION ARCHIVE</small></span></div><div className="auth-layout"><section className="auth-story"><span className="eyebrow">OUR WORK LIVES ON.</span><h1>한 번의 제작이,<br/><em>다음의 시작으로.</em></h1><p>완성한 영상과 이미지부터<br/>그 안의 아이디어와 제작 소스까지.<br/>우리 팀의 기록을 한곳에 보존하세요.</p><div className="auth-pills"><span><Icon name="film" size={18}/>영상</span><span><Icon name="image" size={18}/>이미지</span><span><Icon name="box" size={18}/>제작 원본</span></div><div className="auth-grid-art"><i/><i/><i/><i/></div></section><section className="auth-panel"><span className="eyebrow">{setup?'WELCOME TO YOUR ARCHIVE':'TEAM WORKSPACE'}</span><h2>{setup?'팀 아카이브 시작하기':'다시 만나 반갑습니다.'}</h2><p>{setup?'첫 관리자 계정과 팀을 등록하세요.':'팀 계정으로 아카이브에 로그인하세요.'}</p><ErrorBox error={error}/>
  {status&&!status.configured?<div className="notice"><p>데이터베이스 연결을 준비하고 있습니다. 서버 설정을 확인한 뒤 다시 시도하세요.</p><button className="button" onClick={refresh}>연결 다시 확인</button></div>:<form className="stack-form" onSubmit={submit}>
  {setup&&<><label>초기 설정 키<input type="password" required minLength={32} value={form.token} onChange={e=>setForm({...form,token:e.target.value})} autoComplete="off"/><small>서버 관리자가 준비한 초기 설정 키를 입력하세요.</small></label><div className="form-grid"><label>이름<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} maxLength={80} autoComplete="name"/></label><label>팀 이름<input required value={form.teamName} onChange={e=>setForm({...form,teamName:e.target.value})} maxLength={100}/></label></div></>}
  <label>이메일<input type="email" autoComplete="email" placeholder="name@team.com" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>비밀번호<input type="password" autoComplete={setup?'new-password':'current-password'} required minLength={setup?12:undefined} maxLength={128} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>{setup&&<p className="small-note">비밀번호는 12자 이상으로 설정하세요. 팀원은 초기 설정 후 관리자가 등록할 수 있습니다.</p>}<button className="button primary full-width" disabled={busy||!status}>{busy?'처리 중…':setup?'팀 아카이브 만들기':'로그인'}<Icon name="arrow" size={17}/></button></form>}
  <div className="auth-footnote"><i className="live-dot"/>우리 팀만을 위한 제작 아카이브</div></section></div><footer className="auth-footer">NEXTFLIX ARCHIVE <span>기록을 연결하고, 제작을 이어갑니다.</span></footer></div>;
}
