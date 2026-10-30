/* eslint-disable @next/next/no-img-element -- Authenticated WebP derivatives must be served directly without a second optimizer. */
'use client';
import Link from 'next/link';
import { Card } from './types';
import { kinds,bytes } from './client';
export function Icon({name,size=20}:{name:string;size?:number}){
 const paths:Record<string,React.ReactNode>={
 search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
 plus:<path d="M12 5v14M5 12h14"/>,arrow:<path d="m9 5 7 7-7 7"/>,
 download:<><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/></>,
 film:<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4"/></>,
 image:<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>,
 box:<><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></>,
 folder:<path d="M3 7V4h6l3 3h9v13H3z"/>, close:<path d="m6 6 12 12M6 18 18 6"/>,
 check:<path d="m5 12 4 4L19 6"/>,edit:<><path d="m4 16-1 5 5-1L21 7l-4-4zM14 6l4 4"/></>,
 trash:<><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
 clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
 settings:<><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></>,
 play:<path d="m8 5 11 7-11 7z"/>,link:<><path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/></>,
 };
 return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]||paths.folder}</svg>;
}
export function Loading({label='불러오는 중'}:{label?:string}){return <div className="loading-state" role="status"><span className="spinner"/>{label}</div>;}
export function ErrorBox({error}:{error:unknown}){return error?<div className="error-box" role="alert">{error instanceof Error?error.message:String(error)}</div>:null;}
export function Empty({title,description,action}:{title:string;description:string;action?:React.ReactNode}){
 return <div className="empty-state"><div className="empty-symbol"><Icon name="folder" size={38}/></div><h2>{title}</h2><p>{description}</p>{action}</div>;
}
export function ArchiveCard({item}:{item:Card}){
 return <Link className={'archive-card kind-'+item.kind.toLowerCase()} href={'/archive/items/'+item.id}>
  <div className="card-art">
   {item.preview?<img src={'/api/archive/media/'+item.preview} alt="" loading="lazy"/>:<div className="card-fallback"><Icon name={item.kind==='VIDEO'?'film':item.kind==='IMAGE'?'image':'box'} size={44}/><span>{kinds[item.kind]}</span></div>}
   <span className="kind-badge">{kinds[item.kind]}</span><span className="card-open"><Icon name="arrow"/></span>
   <div className="card-meta"><span>{item.broadcastYear||'연도 미상'}</span><span>v{item.versionNo||'1'}</span></div>
  </div>
  <div className="card-caption"><h3>{item.title}</h3><p>{item.broadcastTitle||item.category?.name||'제작 아카이브'}<span>{bytes(item.totalBytes)}</span></p><div className="card-tags">{item.keywords.slice(0,3).map(k=><span key={k}>#{k}</span>)}</div></div>
 </Link>;
}

