/* eslint-disable @next/next/no-img-element -- Authenticated WebP derivatives must be served directly without a second optimizer. */
'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { useRouter,useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card,Context } from './types';
import { api,kinds } from './client';
import { ArchiveCard,Empty,ErrorBox,Icon,Loading } from './ui';
type Page={items:Card[];nextCursor:string|null;totalCount:number;years:{year:number|null;count:number}[]};
export function Library({context,sources}:{context:Context;sources:boolean}){
 const router=useRouter(),params=useSearchParams(),search=params.toString();
 const[q,setQ]=useState(params.get('q')||''),[composing,setComposing]=useState(false);
 const[data,setData]=useState<Page|null>(null),[loading,setLoading]=useState(true),[more,setMore]=useState(false),[error,setError]=useState<unknown>(null);
 const request=useRef(0);
 const scoped=new URLSearchParams(search);scoped.set('role',sources?'SOURCE':'RESULT');const query=scoped.toString();
 const update=useCallback((key:string,value:string)=>{const next=new URLSearchParams(search);value?next.set(key,value):next.delete(key);router.replace((sources?'/archive/sources':'/archive')+(next.size?'?'+next.toString():''),{scroll:false});},[search,sources,router]);
 useEffect(()=>{setQ(new URLSearchParams(search).get('q')||'');},[search]);
 useEffect(()=>{if(composing)return;const timer=setTimeout(()=>{const old=new URLSearchParams(search).get('q')||'';if(q!==old)update('q',q);},300);return()=>clearTimeout(timer);},[q,composing,search,update]);
 useEffect(()=>{
  const controller=new AbortController(),generation=++request.current;setLoading(true);setError(null);setData(null);
  api<Page>('items?'+query,{signal:controller.signal}).then(page=>{if(generation===request.current)setData(page);}).catch(e=>{if(e.name!=='AbortError'&&generation===request.current)setError(e);}).finally(()=>{if(generation===request.current)setLoading(false);});
  return()=>controller.abort();
 },[query]);
 const loadMore=async()=>{if(!data?.nextCursor)return;setMore(true);const generation=request.current;try{const next=await api<Page>('items?'+query+'&cursor='+encodeURIComponent(data.nextCursor));if(generation===request.current)setData(old=>old?{...next,items:[...old.items,...next.items]}:next);}catch(e){setError(e);}finally{setMore(false);}};
 const years=[...new Set(data?.items.map(i=>i.broadcastYear)||[])].sort((a,b)=>(b??-1)-(a??-1));
 const featured=data?.items[0];
 return <>
  <section className={'library-hero '+(sources?'sources-hero':'')}>
   {featured?.preview&&<img className="hero-backdrop" src={'/api/archive/media/'+featured.preview} alt=""/>}
   <div className="hero-shade"/>
   <div className="hero-copy"><span className="eyebrow"><span className="live-dot"/>{sources?'PRODUCTION SOURCES':'YOUR TEAM. YOUR ARCHIVE.'}</span>
    <h1>{sources?<>필요한 소스를,<br/><em>다시 꺼내 쓰세요.</em></>:<>다음 제작은,<br/><em>지난 기록에서.</em></>}</h1>
    <p>{sources?'3D, 이미지, 파일, Unreal 프로젝트까지. 결과물에 연결된 제작 원본을 한곳에서 찾으세요.':'함께 만든 영상과 이미지, 그 안의 제작 소스까지.\n지난 작업을 찾아보고 다음 아이디어를 이어가세요.'}</p>
    <div className="hero-actions">{context.user.role!=='VIEWER'&&<Link className="button primary" href={'/archive/new'+(sources?'?role=SOURCE':'')}><Icon name="plus"/>{sources?'소스 보관하기':'제작물 등록하기'}</Link>}<a className="button subtle" href="#collection">아카이브 둘러보기<Icon name="arrow" size={16}/></a></div>
   </div>
   <div className="hero-index"><span>COLLECT. CONNECT. CREATE.</span><div><b>{data?.totalCount??'—'}</b><span>개의 {sources?'제작 소스':'제작 결과물'}</span></div><small>원본은 NAS에 안전하게 보존합니다</small></div>
  </section>
  <div className="page-container library-body" id="collection">
   <div className="collection-heading"><div><span className="eyebrow">THE COLLECTION</span><h2>{sources?'제작 소스':'제작 결과물'} <span>{data?.totalCount??0}</span></h2></div><span className="muted desktop-only">방송연도별로 쌓이는 우리 팀의 기록</span></div>
   <div className="filter-bar">
    <div className="type-tabs" role="group" aria-label="자료 유형">{(sources?['','MODEL3D','IMAGE','FILE','UNREAL_PROJECT']:['','VIDEO','IMAGE']).map(kind=><button key={kind} className={(params.get('kind')||'')===kind?'selected':''} onClick={()=>update('kind',kind)}>{kind?kinds[kind]:'전체'}</button>)}</div>
    <div className="search-input"><Icon name="search" size={19}/><input aria-label="제목, 키워드, 설명 검색" placeholder="제목, 키워드, 메모 검색" value={q} onChange={e=>setQ(e.target.value)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={e=>{setComposing(false);setQ(e.currentTarget.value);}}/>{q&&<button className="icon-button" aria-label="검색어 지우기" onClick={()=>setQ('')}><Icon name="close" size={15}/></button>}</div>
   </div>
   <div className="filter-selects">
    <select aria-label="방송연도" value={params.get('year')||''} onChange={e=>update('year',e.target.value)}><option value="">모든 방송연도</option>{data?.years.map(y=><option key={y.year||'unknown'} value={y.year||'unknown'}>{y.year?y.year+'년':'연도 미상'} ({y.count})</option>)}</select>
    <select aria-label="제작 건" value={params.get('project')||''} onChange={e=>update('project',e.target.value)}><option value="">모든 제작 건</option>{context.projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select>
    <select aria-label="종류" value={params.get('category')||''} onChange={e=>update('category',e.target.value)}><option value="">모든 종류</option>{context.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <select aria-label="담당자" value={params.get('responsible')||''} onChange={e=>update('responsible',e.target.value)}><option value="">모든 담당자</option>{context.users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>
    <select aria-label="제작부조" value={params.get('facility')||''} onChange={e=>update('facility',e.target.value)}><option value="">모든 제작부조</option>{context.facilities.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>
    <button className={params.get('favorites')?'filter-favorite active':'filter-favorite'} onClick={()=>update('favorites',params.get('favorites')?'':'true')}>☆ 내 보관함</button>
    {search&&<button className="text-button" onClick={()=>router.replace(sources?'/archive/sources':'/archive',{scroll:false})}>필터 초기화</button>}
   </div>
   <ErrorBox error={error}/>
   {loading?<div className="card-grid" aria-label="자료를 불러오는 중">{Array.from({length:8},(_,i)=><div key={i} className="skeleton-card"/>)}</div>:!data?.items.length?<Empty title={search?'검색 결과가 없습니다':'첫 제작물을 보존해 주세요'} description={search?'검색어나 필터를 바꾸어 다시 찾아보세요.':'완성한 영상·이미지와 제작에 사용한 소스를 등록하면\n우리 팀의 아카이브가 시작됩니다.'} action={context.user.role!=='VIEWER'&&!search?<Link href="/archive/new" className="button primary"><Icon name="plus"/>제작물 등록</Link>:undefined}/>:
    years.map(year=><section className="year-section" key={year??'unknown'}><div className="year-heading"><h3>{year?<>{year}<small>년</small></>:'연도 미상'}</h3><span className="year-line"/><span>{data.items.filter(i=>i.broadcastYear===year).length}개 표시</span></div><div className="card-grid">{data.items.filter(i=>i.broadcastYear===year).map(item=><ArchiveCard key={item.id} item={item}/>)}</div></section>)}
   {data?.nextCursor&&<div className="load-more"><button className="button" disabled={more} onClick={loadMore}>{more?'불러오는 중…':'더 보기'}<Icon name="arrow" size={16}/></button></div>}
  </div>
 </>;
}

