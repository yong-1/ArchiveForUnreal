'use client';
import { useState } from 'react';
import { Plan } from './types';
import { api,bytes } from './client';
import { Icon,ErrorBox } from './ui';
export function PlanPanel({plan,onUpdate}:{plan:Plan;onUpdate:()=>Promise<void>}){
 const[decisions,setDecisions]=useState<Record<string,string>>({}),[page,setPage]=useState(0),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false);
 const reviews=plan.entries.filter(e=>e.decision==='REVIEW'&&!e.resolution),included=plan.entries.filter(e=>(e.resolution||e.decision)==='INCLUDE'),excluded=plan.entries.filter(e=>(e.resolution||e.decision)==='EXCLUDE');
 const save=async(values:Record<string,string>)=>{setBusy(true);setError(null);try{await api('plans/'+plan.id,{method:'PATCH',body:JSON.stringify({revision:plan.revision,decisions:values})});await onUpdate();setDecisions({});}catch(e){setError(e);}finally{setBusy(false);}};
 return <section className="plan-panel"><div className="plan-heading"><Icon name="folder"/><div><h3>보존 계획</h3><p>{included.length}개 보존 · {excluded.length}개 제외 · {reviews.length}개 검토 필요</p></div><b>{bytes(included.reduce((n,e)=>n+Number(e.sizeBytes),0))}</b></div>
  {reviews.length>0&&<><div className="notice">필수 바이너리·고유 설정·미분류 파일은 보존 여부를 확인해 주세요. Content와 제작 출력물은 기본 보존합니다.</div><div className="inline-actions"><button type="button" className="button button-small" disabled={busy} onClick={()=>save(Object.fromEntries(reviews.map(r=>[r.canonicalPath,'INCLUDE'])))}>검토 파일 모두 보존</button><button type="button" className="button button-small subtle" disabled={busy||!Object.keys(decisions).length} onClick={()=>save(decisions)}>선택한 판단 반영</button></div>
   <div className="plan-table">{reviews.slice(page*50,page*50+50).map(e=><div className="review-row" key={e.id}><div><b>{e.relativePath}</b><small>{e.reason} · {bytes(e.sizeBytes)}</small></div><select aria-label={e.relativePath+' 보존 판단'} value={decisions[e.canonicalPath]||''} onChange={v=>setDecisions(d=>({...d,[e.canonicalPath]:v.target.value}))}><option value="">선택 필요</option><option value="INCLUDE">보존</option><option value="EXCLUDE">제외</option></select></div>)}</div>
   {reviews.length>50&&<div className="inline-actions"><button type="button" className="button button-small" onClick={()=>setPage(p=>p-1)} disabled={page===0}>이전</button><span>{page+1} / {Math.ceil(reviews.length/50)}</span><button type="button" className="button button-small" onClick={()=>setPage(p=>p+1)} disabled={(page+1)*50>=reviews.length}>다음</button></div>}</>}
  <details><summary>포함·제외·교체 내역 보기</summary><div className="plan-table">{plan.entries.slice(0,500).map(e=><div className="plan-file-row" key={e.id}><span className={'decision '+(e.resolution||e.decision).toLowerCase()}>{({INCLUDE:'보존',EXCLUDE:'제외',REVIEW:'검토'} as Record<string,string>)[e.resolution||e.decision]}</span><span title={e.relativePath}>{e.relativePath}<small>{e.reason}</small></span><small>{({REPLACE:'교체',ADD:'추가',INHERIT:'승계',REMOVE:'제거'} as Record<string,string>)[e.action]} · {bytes(e.sizeBytes)}</small></div>)}</div>{plan.entries.length>500&&<p className="small-note">전체 {plan.entries.length}개 중 처음 500개 표시</p>}</details><ErrorBox error={error}/>
 </section>;
}
