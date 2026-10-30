import { Suspense } from 'react';
import ArchiveApp from '@/components/archive/ArchiveApp';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{path?:string[]}>}){
 const{path}=await params;
 return <Suspense fallback={<div className="loading-state">아카이브를 준비합니다…</div>}><ArchiveApp segments={path||[]}/></Suspense>;
}
