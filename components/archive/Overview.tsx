/* eslint-disable @next/next/no-img-element -- Authenticated WebP derivatives must be served directly without a second optimizer. */
'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { useSearchParams } from 'next/navigation';
import { Detail } from './types';
import { api,post,bytes,kinds,stateLabel,date } from './client';
import { Empty,ErrorBox,Icon,Loading } from './ui';
import { useState } from 'react';

type Entry={id:string;title:string;kind:string;roles:string[];broadcastYear:number|null;versionNo?:string;state?:string;totalBytes?:string;fileCount?:number;poster?:string;unreal?:{engineVersion:string;validationStatus:string}|null};
type ProjectView={project:{id:string;title:string;description:string;createdAt:string};results:Entry[];sources:Entry[];unreal:Entry[];drafts:{id:string;title:string;kind:string}[];people:{id:string;name:string;roles:string[]}[];history:{id:string;action:string;targetId:string;createdAt:string;actorName:string}[]};
const actions:Record<string,string>={ITEM_CREATED:'항목 등록',METADATA_UPDATED:'정보 수정',VERSION_COMMITTED:'새 버전 보존',VERSION_DESCRIPTION_UPDATED:'버전 설명 수정',MEMO_UPDATED:'메모 수정',DELETE_CONFIRMED:'삭제 확인',DELETE_COMPLETED:'삭제 완료',OPERATOR_VALIDATION_RECORDED:'UE 검증 기록',DRAFT_ABANDONED:'미확정 버전 정리'};

function EntryRow({e}:{e:Entry}){
 return <Link className="source-row" href={(e.kind==='UNREAL_PROJECT'?'/archive/unreal/':'/archive/items/')+e.id}><span className="file-icon">{e.poster?<img src={'/api/archive/media/'+e.poster} alt="" width={36} height={36}/>:<Icon name={e.kind==='VIDEO'?'film':e.kind==='IMAGE'?'image':'box'} size={23}/>}</span><div><b>{e.title}</b><p>{kinds[e.kind]} · v{e.versionNo} · {e.fileCount??0}개 · {bytes(e.totalBytes)}{e.unreal?' · UE '+(e.unreal.engineVersion||'미기록')+' · '+(stateLabel[e.unreal.validationStatus]||e.unreal.validationStatus):''}</p></div><span className="muted">{e.broadcastYear||'연도 미상'}</span></Link>;
}
function Group({title,eyebrow,entries,empty}:{title:string;eyebrow:string;entries:Entry[];empty:string}){
 return <section className="content-panel"><span className="eyebrow">{eyebrow}</span><h2>{title} <span>{entries.length}</span></h2>{entries.length?entries.map(e=><EntryRow key={e.id} e={e}/>):<p className="muted">{empty}</p>}</section>;
}
// /archive/projects/[id]: 제작 건의 결과물·소스·UE·참여자·이력
export function ProjectDetail({projectId}:{projectId:string}){
 const{data,error}=useSWR<ProjectView>(['project-overview',projectId],()=>api('projects/'+projectId+'/overview'),{shouldRetryOnError:false});
 if(error)return <div className="page-container"><ErrorBox error={error}/><Link className="button" href="/archive/projects">제작 건 목록</Link></div>;
 if(!data)return <Loading/>;
 return <div className="page-container"><div className="breadcrumb"><Link href="/archive/projects">제작 건</Link><span>/</span><span>{data.project.title}</span></div>
  <div className="page-heading"><span className="eyebrow">PRODUCTION PROJECT</span><h1>{data.project.title}</h1><p>{data.project.description||'설명이 없습니다.'}</p><div className="hero-actions"><Link className="button" href={'/archive?project='+projectId}>결과물 카드로 보기</Link><Link className="button subtle" href={'/archive/sources?project='+projectId}>소스 카드로 보기</Link></div></div>
  <div className="detail-layout"><div className="detail-main">
   <Group eyebrow="RESULTS" title="제작 결과물" entries={data.results} empty="보존된 결과물이 없습니다."/>
   <Group eyebrow="SOURCES" title="제작 소스" entries={data.sources} empty="보존된 소스가 없습니다."/>
   <Group eyebrow="UNREAL" title="Unreal 프로젝트" entries={data.unreal} empty="보존된 Unreal 프로젝트가 없습니다."/>
   {data.drafts.length>0&&<section className="content-panel"><span className="eyebrow">DRAFTS</span><h2>보존 버전이 없는 항목 <span>{data.drafts.length}</span></h2>{data.drafts.map(d=><div className="operation-row" key={d.id}><Icon name="clock"/><div><b>{d.title}</b><small>{kinds[d.kind]}</small></div><Link className="button button-small" href={'/archive/items/'+d.id+'/edit'}>파일 업로드 계속</Link></div>)}</section>}
  </div><aside className="detail-aside">
   <section className="side-panel"><span className="eyebrow">PEOPLE</span><h2>참여자</h2>{data.people.length?<dl>{data.people.map(p=><div key={p.id}><dt>{p.name}</dt><dd>{p.roles.join(' · ')}</dd></div>)}</dl>:<p className="muted">등록된 참여자가 없습니다.</p>}</section>
   <section className="side-panel"><span className="eyebrow">HISTORY</span><h2>최근 이력</h2>{data.history.length?<ol className="history-list">{data.history.map(h=><li key={h.id}><div><b>{actions[h.action]||h.action}</b><small>{h.actorName} · {date(h.createdAt)}</small></div></li>)}</ol>:<p className="muted">이력이 없습니다.</p>}</section>
  </aside></div>
 </div>;
}

type Stat={count:number;bytes:string};
type UnrealView={item:{id:string;title:string};version:{id:string;versionNo:string;createdAt:string};profile:{uprojectPath:string;engineVersion:string;environment:{distribution?:string;build?:string;notes?:string;plugins?:{name:string;version?:string;required?:boolean}[]};validationStatus:string};archive:{state:string;fileCount:number;totalBytes:string;verifiedAt:string|null;manifestHash:string|null};policy:{version:string};stats:Record<'INCLUDE'|'EXCLUDE'|'REVIEW_INCLUDED'|'REVIEW_EXCLUDED'|'REMOVED'|'INHERITED',Stat>;surveyedBytes:string;includedBytes:string;savingsPercent:number|null;excluded:{relativePath:string;reason:string;sizeBytes:string}[]|null;validations:{id:string;state:string;report:string;createdAt:string;actorName:string}[]};
// /archive/unreal/[itemId]?version=: UE 환경·보존 범위·검증·전체 다운로드
export function UnrealPage({itemId}:{itemId:string}){
 const params=useSearchParams();
 const{data:item,error:itemError}=useSWR<Detail>(['detail',itemId,params.get('version')],()=>api('items/'+itemId+(params.get('version')?'?version='+params.get('version'):'')),{shouldRetryOnError:false});
 const versionId=item?.selectedVersion?.id;
 const{data,error}=useSWR<UnrealView>(versionId?['unreal',versionId]:null,()=>api('unreal/'+versionId),{shouldRetryOnError:false});
 const[job,setJob]=useState<string|null>(null),[failure,setFailure]=useState<unknown>(null);
 if(itemError||error)return <div className="page-container"><ErrorBox error={itemError||error}/></div>;
 if(item&&!versionId)return <div className="page-container"><Empty title="보존된 버전이 없습니다" description="파일 업로드와 검증을 완료해 주세요."/></div>;
 if(!item||!data)return <Loading/>;
 const env=data.profile.environment||{};
 const row=(label:string,s:Stat)=><div><b>{s.count.toLocaleString('ko-KR')}</b><span>{label} · {bytes(s.bytes)}</span></div>;
 return <div className="page-container"><div className="breadcrumb"><Link href="/archive/sources?kind=UNREAL_PROJECT">Unreal 프로젝트</Link><span>/</span><Link href={'/archive/items/'+itemId}>{data.item.title}</Link><span>/</span><span>보존 범위</span></div>
  <div className="page-heading"><span className="eyebrow">UNREAL PROJECT · v{data.version.versionNo}</span><h1>{data.item.title}</h1><p>재생성 캐시만 제외하고, 미사용 Content를 포함한 프로젝트 원본을 보존했습니다. 실행용 빌드는 보존 대상이 아닙니다.</p></div>
  <div className="detail-layout"><div className="detail-main">
   <section className="content-panel"><span className="eyebrow">PRESERVATION SCOPE</span><h2>보존 범위 · 정책 {data.policy.version}</h2>
    <div className="stat-grid">{row('포함',data.stats.INCLUDE)}{row('검토 후 포함',data.stats.REVIEW_INCLUDED)}{row('제외(캐시·로그)',data.stats.EXCLUDE)}{row('검토 후 제외',data.stats.REVIEW_EXCLUDED)}{row('이전 버전에서 승계',data.stats.INHERITED)}{row('이번 버전에서 제거',data.stats.REMOVED)}</div>
    <p className="muted">조사 {bytes(data.surveyedBytes)} 중 {bytes(data.includedBytes)} 보존{data.savingsPercent!==null?' · 절감률 '+data.savingsPercent+'%':''}</p>
    {data.excluded&&<details><summary>제외한 파일 (관리자 보고서, 최대 300개)</summary><div className="plan-table">{data.excluded.map(f=><div className="plan-file-row" key={f.relativePath}><span>{f.relativePath}</span><small>{f.reason} · {bytes(f.sizeBytes)}</small></div>)}</div></details>}
   </section>
   <section className="content-panel"><span className="eyebrow">VALIDATION</span><h2>에디터 열기 검증 기록</h2><p className="small-note">파일 보존 검증(해시)과 UE 에디터에서 실제로 열어 본 검증은 별개입니다.</p>{data.validations.length?<ol className="history-list">{data.validations.map(v=><li key={v.id}><div><b>{stateLabel[v.state]||v.state}</b><small>{v.actorName} · {date(v.createdAt)}</small></div><p>{v.report}</p></li>)}</ol>:<p className="muted">아직 기록이 없습니다.</p>}</section>
  </div><aside className="detail-aside">
   <section className="side-panel"><span className="eyebrow">ENVIRONMENT</span><h2>복원 환경</h2><dl><div><dt>엔진</dt><dd>{data.profile.engineVersion||'미기록'}</dd></div><div><dt>형태</dt><dd>{env.distribution==='CUSTOM'?'커스텀 엔진':'Launcher'}</dd></div><div><dt>build</dt><dd>{env.build||'미기록'}</dd></div><div><dt>.uproject</dt><dd>{data.profile.uprojectPath}</dd></div><div><dt>에디터 검증</dt><dd>{stateLabel[data.profile.validationStatus]||data.profile.validationStatus}</dd></div></dl>
    {!!env.plugins?.length&&<><h3>필수 플러그인</h3><ul className="check-list">{env.plugins.map(p=><li key={p.name}><Icon name="check" size={14}/>{p.name}{p.version?' '+p.version:''}</li>)}</ul></>}{env.notes&&<p className="small-note">{env.notes}</p>}</section>
   <section className="side-panel"><span className="eyebrow">ARCHIVE</span><h2>보존본</h2><dl><div><dt>상태</dt><dd>{stateLabel[data.archive.state]||data.archive.state}</dd></div><div><dt>파일</dt><dd>{data.archive.fileCount}개 · {bytes(data.archive.totalBytes)}</dd></div><div><dt>검증</dt><dd>{data.archive.verifiedAt?date(data.archive.verifiedAt):'—'}</dd></div></dl>
    {item.permissions.download&&<><button className="button primary full-width" onClick={async()=>{try{setJob((await post<{id:string}>('downloads',{versionId:data.version.id})).id);}catch(e){setFailure(e);}}}><Icon name="download"/>전체 프로젝트 다운로드 준비</button><a className="button subtle full-width" href={'/api/archive/versions/'+data.version.id+'/manifest'} target="_blank" rel="noreferrer">보존 manifest 보기</a></>}
    {job&&<p className="small-note" role="status">작업 관리에서 ZIP 준비 상태를 확인하세요. <Link href="/archive/jobs">작업 관리</Link></p>}<ErrorBox error={failure}/></section>
  </aside></div>
 </div>;
}

type Integrity={roots:{id:string;name:string;kind:string;state:string;checkedAt:string|null}[];counts:Record<string,number>;problems:{id:string;state:string;size:string;affects:{itemId:string;title:string;versionNo:string|null;path:string}[]}[];lastRun:{state:string;createdAt:string;result:Record<string,unknown>|null}|null};
// 관리자 설정: 저장소 상태·객체 무결성·정리 작업
export function IntegrityPanel(){
 const{data,error,mutate}=useSWR<Integrity>('integrity',()=>api('admin/integrity'),{refreshInterval:10000,shouldRetryOnError:false});
 const[message,setMessage]=useState(''),[failure,setFailure]=useState<unknown>(null);
 return <section className="content-panel"><span className="eyebrow">INTEGRITY</span><h2>보존 무결성·정리</h2><p className="small-note">정기 작업이 만료된 업로드·임시 ZIP·미확정 버전을 정리하고 보존 파일의 존재·크기·해시를 점검합니다. 오프라인 저장소의 파일은 없음으로 판정하지 않습니다.</p><ErrorBox error={error||failure}/>
  {!data?<Loading/>:<>
   <div className="stat-grid">{['AVAILABLE','MISSING','CORRUPT','STAGING','PURGED'].map(s=><div key={s}><b>{(data.counts[s]||0).toLocaleString('ko-KR')}</b><span>{({AVAILABLE:'정상',MISSING:'파일 없음',CORRUPT:'손상',STAGING:'준비 중',PURGED:'회수됨'} as Record<string,string>)[s]}</span></div>)}</div>
   {data.roots.map(r=><div className="storage-row" key={r.id}><Icon name="folder"/><div><b>{r.name}</b><small>{r.kind} · {r.checkedAt?date(r.checkedAt)+' 점검':'점검 전'}</small></div><span className={r.state==='ONLINE'?'muted':'danger-text'}>{r.state==='ONLINE'?'연결됨':'연결 안 됨'}</span></div>)}
   {data.problems.length>0&&<div className="error-box" role="alert"><b>확인이 필요한 보존 파일 {data.problems.length}개</b>{data.problems.slice(0,20).map(p=><div key={p.id}><small>{p.state==='MISSING'?'파일 없음':'손상'} · {bytes(p.size)} · {p.affects.map(a=>a.title+' v'+a.versionNo+' '+a.path).join(', ')||'연결 항목 없음'}</small></div>)}</div>}
   <p className="small-note">마지막 점검: {data.lastRun?date(data.lastRun.createdAt)+' · '+(stateLabel[data.lastRun.state]||data.lastRun.state):'없음'}</p>
   <button className="button" onClick={async()=>{setFailure(null);try{await post('admin/maintenance');setMessage('점검 작업을 예약했습니다. 작업 관리에서 진행을 확인하세요.');mutate();}catch(e){setFailure(e);}}}>지금 점검</button>{message&&<p className="notice">{message}</p>}
  </>}
 </section>;
}
