import path from 'node:path';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { check, ArchiveError } from './errors';
export function relativePath(input: string): { path: string; canonical: string } {
  const normalized=input.replace(/\\/g,'/').normalize('NFC');
  check(normalized.length>0 && normalized.length<=1024 && !normalized.startsWith('/') && !/[\x00-\x1f\x7f:]/.test(normalized),400,'INVALID_PATH','허용하지 않는 파일 경로입니다.');
  const parts=normalized.split('/');
  check(parts[0].toLowerCase()!=='_archive',400,'RESERVED_PATH','_archive 경로는 다운로드 manifest용으로 예약되어 있습니다.');
  check(parts.every(p=>p!==''&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p)&&!/[<>"|?*]/.test(p)&& !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)),400,'INVALID_PATH','Windows에서 안전하게 복원할 수 없는 경로입니다.');
  return {path:normalized,canonical:normalized.toLocaleLowerCase('en-US')};
}
export function within(root:string,target:string) {
  const rel=path.relative(path.resolve(root),path.resolve(target));
  return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);
}
export function rootsSeparate(paths:string[]) {
  const resolved=paths.map(p=>path.resolve(p).toLocaleLowerCase('en-US'));
  return resolved.every((p,i)=>resolved.every((q,j)=>i===j||(p!==q&&!within(p,q)&&!within(q,p))));
}
export async function safePath(root:string,key:string,createParents=false) {
  const rel=relativePath(key).path;
  const base=path.resolve(root);
  const target=path.resolve(base,...rel.split('/'));
  check(within(base,target),400,'ROOT_ESCAPE','허용 저장소를 벗어난 경로입니다.');
  if(createParents) await mkdir(base,{recursive:true});
  const baseStat=await lstat(base);
  check(baseStat.isDirectory()&&!baseStat.isSymbolicLink(),400,'UNSAFE_ROOT','저장소 루트에 링크를 사용할 수 없습니다.');
  const canonicalBase=await realpath(base);
  let current=base;
  for(const part of rel.split('/').slice(0,-1)) {
    current=path.join(current,part);
    if(createParents) await mkdir(current,{recursive:true});
    const stat=await lstat(current);
    check(stat.isDirectory()&&!stat.isSymbolicLink(),400,'UNSAFE_PATH','링크·파일을 경로로 사용할 수 없습니다.');
  }
  try { const s=await lstat(target); check(!s.isSymbolicLink(),400,'UNSAFE_PATH','링크 파일은 허용하지 않습니다.'); }
  catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
  const actualParent=await realpath(path.dirname(target));
  check(actualParent===canonicalBase||within(canonicalBase,actualParent),400,'ROOT_ESCAPE','물리 경로가 저장소를 벗어납니다.');
  return target;
}
export function configuredPaths() {
  const base=path.resolve('.local');
  const archive=process.env.ARCHIVE_ROOT||(process.env.NODE_ENV!=='production'?path.join(base,'archive'):'');
  const staging=process.env.STAGING_ROOT||(process.env.NODE_ENV!=='production'?path.join(base,'staging'):'');
  const preview=process.env.PREVIEW_ROOT||(process.env.NODE_ENV!=='production'?path.join(base,'preview'):'');
  check(archive&&staging&&preview,503,'STORAGE_NOT_CONFIGURED','보존·임시·미리보기 저장소 설정이 필요합니다.');
  check(rootsSeparate([archive,staging,preview]),400,'OVERLAPPING_ROOTS','저장소 루트는 서로 분리해야 합니다.');
  return {archive:path.resolve(/*turbopackIgnore: true*/archive),staging:path.resolve(/*turbopackIgnore: true*/staging),preview:path.resolve(/*turbopackIgnore: true*/preview)};
}
export async function storageFailure<T>(fn:()=>Promise<T>):Promise<T> {
  try{return await fn();}catch(e){if(e instanceof ArchiveError)throw e;throw new ArchiveError(503,'STORAGE_UNAVAILABLE','NAS 파일에 접근할 수 없습니다. 연결과 권한을 확인하세요.');}
}
