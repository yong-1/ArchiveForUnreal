'use client';
import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { HistoryEntry,MetadataHistory,UsedBy } from './types';
import { api,patch,date,kinds,relationLabel } from './client';
import { ErrorBox,Icon,Loading } from './ui';

function HistoryList({entries}:{entries:HistoryEntry[]}){
 if(!entries.length)return <p className="muted">아직 수정 이력이 없습니다.</p>;
 return <ol className="history-list">{entries.map(h=><li key={h.revision}><div><b>r{h.revision}</b><small>{h.actorName} · {date(h.createdAt)}</small></div><p>{h.body||'(빈 설명)'}</p></li>)}</ol>;
}

// AR-14·VER-03: 버전별 설명. 수정해도 파일 버전은 늘지 않고 revision 이력만 쌓인다.
export function VersionDescription({versionId,description,revision,canEdit,onSaved}:{versionId:string;description:string;revision:number;canEdit:boolean;onSaved:()=>void}){
 const[editing,setEditing]=useState(false),[text,setText]=useState(description),[error,setError]=useState<unknown>(null),[showHistory,setShowHistory]=useState(false),[busy,setBusy]=useState(false);
 const{data:history}=useSWR<{history:HistoryEntry[]}>(showHistory?['version-description',versionId,revision]:null,()=>api('versions/'+versionId+'/description'));
 const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError(null);try{await patch('versions/'+versionId+'/description',{body:text,revision});setEditing(false);onSaved();}catch(err){setError(err);}finally{setBusy(false);}};
 return <section className="content-panel"><span className="eyebrow">THIS VERSION</span><div className="section-title"><h2>이 버전의 설명</h2><div className="inline-actions">{canEdit&&!editing&&<button className="text-button" onClick={()=>{setText(description);setEditing(true);}}><Icon name="edit" size={15}/>수정</button>}<button className="text-button" aria-expanded={showHistory} onClick={()=>setShowHistory(!showHistory)}>수정 이력</button></div></div>
  {editing?<form onSubmit={save}><textarea aria-label="버전 설명" value={text} onChange={e=>setText(e.target.value)} maxLength={20000} placeholder="이 버전에서 바뀐 점, 사용한 렌더 설정 등을 남겨 주세요."/><ErrorBox error={error}/><div className="form-actions"><button type="button" className="button button-small subtle" onClick={()=>setEditing(false)}>취소</button><button className="button button-small" disabled={busy}>설명 저장</button></div><p className="small-note">설명만 바꾸면 새 파일 버전을 만들지 않습니다.</p></form>
  :<p className="description-text">{description||'이 버전에 대한 설명이 없습니다.'}</p>}
  {showHistory&&(history?<HistoryList entries={history.history}/>:<Loading/>)}
 </section>;
}

export function MemoItem({memo,canEdit,onSaved}:{memo:{id:string;body:string;authorName:string;createdAt:string;updatedAt:string|null;revision:number};canEdit:boolean;onSaved:()=>void}){
 const[editing,setEditing]=useState(false),[text,setText]=useState(memo.body),[error,setError]=useState<unknown>(null),[showHistory,setShowHistory]=useState(false);
 const{data:history}=useSWR<{history:HistoryEntry[]}>(showHistory?['memo-history',memo.id,memo.revision]:null,()=>api('memos/'+memo.id+'/revisions'));
 return <article className="memo"><div><b>{memo.authorName}</b><small>{date(memo.createdAt)}{memo.updatedAt?' · 수정됨':''}</small>{canEdit&&!editing&&<button className="text-button" onClick={()=>{setText(memo.body);setEditing(true);}}>수정</button>}{memo.revision>1&&<button className="text-button" aria-expanded={showHistory} onClick={()=>setShowHistory(!showHistory)}>이력</button>}</div>
  {editing?<form onSubmit={async e=>{e.preventDefault();try{await patch('memos/'+memo.id,{body:text,revision:memo.revision});setEditing(false);onSaved();}catch(err){setError(err);}}}><textarea aria-label="메모 수정" value={text} onChange={e=>setText(e.target.value)} maxLength={20000}/><ErrorBox error={error}/><div className="form-actions"><button type="button" className="button button-small subtle" onClick={()=>setEditing(false)}>취소</button><button className="button button-small" disabled={!text.trim()}>메모 저장</button></div></form>:<p>{memo.body}</p>}
  {showHistory&&(history?<HistoryList entries={history.history}/>:<Loading/>)}
 </article>;
}

// SRC-01: 소스 → 이 소스를 쓰는 결과물 역탐색. 권한 밖 항목은 이름 없이 개수만 표시한다.
export function UsedByPanel({itemId}:{itemId:string}){
 const{data,error}=useSWR<UsedBy>(['used-by',itemId],()=>api('items/'+itemId+'/used-by'),{shouldRetryOnError:false});
 if(error)return <ErrorBox error={error}/>;
 if(!data||(!data.items.length&&!data.restricted))return null;
 return <section className="content-panel"><span className="eyebrow">USED BY</span><h2>이 소스를 사용하는 작업 <span>{data.items.length+data.restricted}</span></h2>
  {data.items.map(u=><div className="source-row" key={u.versionId}><span className="file-icon"><Icon name={u.kind==='VIDEO'?'film':u.kind==='IMAGE'?'image':'box'} size={23}/></span><div><Link href={'/archive/items/'+u.itemId+'?version='+u.versionId}>{u.title}</Link><p>{kinds[u.kind]} · v{u.versionNo}{u.current?' (현재 대표)':' (과거 버전)'} → 이 소스 v{u.sourceVersionNo}</p></div><span className={'relation-badge '+u.relation.toLowerCase()}>{relationLabel[u.relation]||u.relation}</span></div>)}
  {data.restricted>0&&<p className="small-note">접근 권한이 없는 작업 {data.restricted}건에서도 사용 중입니다.</p>}
 </section>;
}

const fieldLabels:Record<string,string>={title:'제목',broadcastTitle:'방송 제목',broadcastYear:'방송연도',description:'전체 설명',keywords:'키워드',categoryId:'종류',facilityIds:'제작부조',responsibleIds:'담당자',roles:'역할',managedIndependently:'독립 관리'};
export function MetadataHistoryPanel({itemId}:{itemId:string}){
 const[open,setOpen]=useState(false);
 const{data}=useSWR<MetadataHistory>(open?['metadata-history',itemId]:null,()=>api('items/'+itemId+'/revisions'));
 const changed=(a:Record<string,unknown>,b?:Record<string,unknown>)=>b?Object.keys(fieldLabels).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).map(k=>fieldLabels[k]):['최초 등록'];
 return <details className="content-panel" onToggle={e=>setOpen((e.target as HTMLDetailsElement).open)}><summary><div><span className="eyebrow">HISTORY</span><h2>정보 수정 이력</h2></div><Icon name="arrow"/></summary>
  {!data?<Loading/>:<ol className="history-list">{data.map((r,i)=><li key={r.revision}><div><b>r{r.revision}</b><small>{r.actorName} · {date(r.createdAt)}</small></div><p>{changed(r.snapshot,data[i+1]?.snapshot).join(', ')||'변경 없음'}</p></li>)}</ol>}
 </details>;
}
