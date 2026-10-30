'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sha256 } from '@noble/hashes/sha2.js';
import { Batch } from './types';
import { api,post,stateLabel } from './client';
import { ErrorBox,Loading } from './ui';
import { PlanPanel } from './PlanPanel';
import { FilePicker,FileEntry,canonicalPath } from './FilePicker';
async function digest(file:File,stopped:()=>boolean,progress:(p:number)=>void){
 const hash=sha256.create(),reader=file.stream().getReader();let read=0;
 try{for(;;){if(stopped()){await reader.cancel();throw new Error('업로드를 일시중지했습니다.');}const{done,value}=await reader.read();if(done)break;hash.update(value);read+=value.length;progress(file.size?read/file.size:1);}}finally{reader.releaseLock();}
 return Array.from(hash.digest(),v=>v.toString(16).padStart(2,'0')).join('');
}
export function Transfer({initial,resumeId}:{initial?:{batch:Batch;fileMap:Map<string,FileEntry>};resumeId?:string}){
 const router=useRouter(),[batch,setBatch]=useState<Batch|null>(initial?.batch||null),[fileMap,setFileMap]=useState(initial?.fileMap||new Map<string,FileEntry>()),[busy,setBusy]=useState(false),[phase,setPhase]=useState('보존 계획을 확인하세요'),[progress,setProgress]=useState(0),[error,setError]=useState<unknown>(null);
 const stopped=useRef(false),controller=useRef<AbortController|null>(null),id=batch?.id||resumeId;
 const refresh=useCallback(async()=>{if(id)setBatch(await api<Batch>('upload-batches/'+id));},[id]);
 useEffect(()=>{if(!initial&&resumeId)api<Batch>('upload-batches/'+resumeId).then(setBatch).catch(setError);},[resumeId,initial]);
 const batchState=batch?.state,resultItem=batch?.result?.[0]?.itemId;
 useEffect(()=>{if(batchState==='COMMITTED'&&resultItem)router.replace('/archive/items/'+resultItem);if(batchState&&['QUEUED','COMMITTING'].includes(batchState)){const timer=setInterval(()=>refresh().catch(setError),1500);return()=>clearInterval(timer);}},[batchState,resultItem,refresh,router]);
 useEffect(()=>()=>{stopped.current=true;controller.current?.abort();},[]);
 const start=async()=>{
  if(!batch)return;stopped.current=false;controller.current=new AbortController();setBusy(true);setError(null);
  try{
   const current=await api<Batch>('upload-batches/'+batch.id);setBatch(current);
   if(current.plans.some(p=>p.state!=='READY'))throw new Error('검토 파일의 보존 여부를 먼저 확정하세요.');
   const all=current.sessions.filter(s=>s.state!=='SKIPPED'),total=all.reduce((n,s)=>n+Number(s.size),0);let sent=0;
   for(const session of all){
    if(['RECEIVED','COMMITTED'].includes(session.state)){sent+=Number(session.size);continue;}
    const selected=fileMap.get(session.itemId+':'+canonicalPath(session.path));
    if(!selected||selected.file.size!==Number(session.size))throw new Error(session.path+' 원본 파일을 다시 선택하세요.');
    setPhase('파일 무결성 확인: '+session.path);
    const checksum=await digest(selected.file,()=>stopped.current,p=>setProgress(p*100));
    await post('uploads/'+session.id+'/checksum',{checksum});
    const count=Math.max(1,Math.ceil(Number(session.size)/current.chunkSize));
    for(let part=0;part<count;part++){
     if(stopped.current)throw new Error('업로드를 일시중지했습니다.');
     const length=Math.min(current.chunkSize,Number(session.size)-part*current.chunkSize);
     if(!session.parts.some(p=>p.partNo===part)){
      setPhase('원본 전송: '+session.path);
      const response=await fetch('/api/archive/uploads/'+session.id+'/parts/'+part,{method:'PUT',body:selected.file.slice(part*current.chunkSize,part*current.chunkSize+length),signal:controller.current.signal});
      if(!response.ok){const body=await response.json();throw new Error(body.error?.message||'청크 전송에 실패했습니다.');}
     }
     sent+=length;setProgress(total?sent/total*100:100);
    }
    await post('uploads/'+session.id+'/complete');
   }
   const latest=await api<Batch>('upload-batches/'+batch.id);
   await post('upload-batches/'+batch.id+'/commit',{planHashes:Object.fromEntries(latest.plans.map(p=>[p.id,p.hash]))});
   setPhase('NAS 보존·체크섬 검증 후 새 버전이 공개됩니다');await refresh();
  }catch(e){setError(e instanceof Error&&e.name==='AbortError'?new Error('전송을 일시중지했습니다. 이어서 업로드할 수 있습니다.'):e);await refresh().catch(()=>{});}finally{setBusy(false);}
 };
 if(!batch)return <div className="page-container"><ErrorBox error={error}/>{!error&&<Loading/>}</div>;
 const review=batch.plans.some(p=>p.state==='REVIEW');
 return <div className="page-container transfer-page">
  <span className="eyebrow">ARCHIVE UPLOAD</span><h1>원본을 안전하게 보존합니다.</h1>
  <p className="muted">변경 없는 파일은 이전 보존본에서 승계합니다.</p>
  <div className="editor-layout"><div>
   {batch.plans.map(p=><PlanPanel key={p.id+':'+p.revision} plan={p} onUpdate={refresh}/>)}
   {(!initial||!!error)&&batch.items.map(item=><section className="content-panel" key={item.id}>
    <h3>{item.title} · 이어서 전송할 파일</h3>
    <FilePicker files={[...fileMap.entries()].filter(([key])=>key.startsWith(item.id+':')).map(([,f])=>f)} onChange={selected=>setFileMap(old=>{const next=new Map([...old].filter(([key])=>!key.startsWith(item.id+':')));for(const f of selected)next.set(item.id+':'+canonicalPath(f.path),f);return next;})}/>
   </section>)}
  </div><aside><section className="side-panel sticky-panel">
   <span className="eyebrow">TRANSFER STATUS</span><h2>{stateLabel[batch.state]||batch.state}</h2><p aria-live="polite">{phase}</p>
   <div className="progress-track" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="현재 단계 진행"><span style={{width:progress+'%'}}/></div><small>{Math.round(progress)}%</small>
   <ErrorBox error={error}/>{batch.jobs[0]?.error&&<ErrorBox error={batch.jobs[0].error}/>}
   {batch.state==='UPLOADING'&&<><button className="button primary full-width" type="button" onClick={start} disabled={busy||review}>{review?'검토 판단이 필요합니다':busy?'전송 중…':'전송·새 버전 보존'}</button>{busy?<button className="button full-width" onClick={()=>{stopped.current=true;controller.current?.abort();}}>일시중지</button>:<button className="button subtle full-width" onClick={async()=>{try{await post('upload-batches/'+batch.id+'/cancel');router.replace('/archive/jobs');}catch(e){setError(e);}}}>이 업로드 취소</button>}</>}
   {['QUEUED','COMMITTING'].includes(batch.state)&&<Loading label="보존 작업 진행 중"/>}<Link className="button subtle full-width" href="/archive/jobs">작업 관리에서 확인</Link></section></aside></div></div>;
}
