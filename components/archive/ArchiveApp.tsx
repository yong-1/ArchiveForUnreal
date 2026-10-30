'use client';
import { useEffect,useState } from 'react';
import { useSession,signOut } from 'next-auth/react';
import useSWR,{useSWRConfig} from 'swr';
import Link from 'next/link';
import { usePathname,useRouter } from 'next/navigation';
import { Context } from './types';
import { api } from './client';
import { Icon,Loading,ErrorBox } from './ui';
import { Library } from './Library';
import { ItemDetail } from './ItemDetail';
import { UploadPage } from './UploadPage';
import { JobsPage,SettingsPage,ProjectsPage } from './Management';
import { ProjectDetail,UnrealPage } from './Overview';
export default function ArchiveApp({segments=[]}:{segments?:string[]}){
 const{status}=useSession(),router=useRouter(),pathname=usePathname();
 const{mutate}=useSWRConfig();
 const{data:context,error,mutate:refresh}=useSWR<Context>(status==='authenticated'?'archive-context':null,()=>api('context'),{shouldRetryOnError:false});
 const[menu,setMenu]=useState(false);
 useEffect(()=>{if(status==='unauthenticated')router.replace('/auth');},[status,router]);
 useEffect(()=>{setMenu(false);},[pathname]);
 if(status==='loading'||status==='unauthenticated')return <Loading label="팀 아카이브를 준비합니다"/>;
 return <div className="archive-app">
  <a className="skip-link" href="#main">본문으로 이동</a>
  <header className="site-header"><Link href="/archive" className="brand"><span className="brand-mark">N</span><span>NEXTFLIX<small>PRODUCTION ARCHIVE</small></span></Link>
   <button className="mobile-menu icon-button" onClick={()=>setMenu(!menu)} aria-label="메뉴 열기" aria-expanded={menu}><Icon name="folder"/></button>
   <nav className={menu?'primary-nav open':'primary-nav'} aria-label="주 메뉴">
    {[['','제작 결과물'],['sources','제작 소스'],['projects','제작 건'],['jobs','작업 관리']].map(([path,label])=><Link key={path} href={'/archive'+(path?'/'+path:'')} className={(segments[0]||'')===path?'active':''}>{label}</Link>)}
   </nav>
   <div className="header-right">{context&&<><span className="team-name"><i/>{context.team.name}</span>{context.user.role!=='VIEWER'&&<Link className="button button-small primary" href="/archive/new"><Icon name="plus" size={16}/>등록</Link>}<Link className="icon-button" href="/archive/settings" aria-label="팀 설정"><Icon name="settings"/></Link><button className="avatar" title="로그아웃" onClick={async()=>{await mutate(()=>true,undefined,{revalidate:false});await signOut({callbackUrl:'/auth'});}}>{context.user.name.slice(0,1)}</button></>}</div>
  </header>
  <main id="main">
   <ErrorBox error={error}/>
   {!context&&!error?<Loading/>:!context?<div className="page-container"><button className="button" onClick={()=>refresh()}>다시 연결</button></div>:
    segments[0]==='items'&&segments[1]&&segments[2]==='edit'?<UploadPage key={'edit:'+segments[1]} context={context} itemId={segments[1]}/>:
    segments[0]==='items'&&segments[1]?<ItemDetail key={segments[1]} context={context} itemId={segments[1]}/>:
    segments[0]==='new'?<UploadPage key="new" context={context}/>:
    segments[0]==='jobs'?<JobsPage context={context}/>:
    segments[0]==='settings'?<SettingsPage context={context} onChange={()=>refresh()}/>:
    segments[0]==='projects'&&segments[1]?<ProjectDetail key={segments[1]} projectId={segments[1]}/>:
    segments[0]==='unreal'&&segments[1]?<UnrealPage key={segments[1]} itemId={segments[1]}/>:
    segments[0]==='projects'?<ProjectsPage context={context} onChange={()=>refresh()}/>:
    <Library context={context} sources={segments[0]==='sources'}/>}
  </main>
  <footer className="site-footer"><span>NEXTFLIX ARCHIVE</span><p>제작의 기록을, 다음 제작의 자산으로.</p><span>{context?.team.name||'TEAM WORKSPACE'}</span></footer>
 </div>;
}
