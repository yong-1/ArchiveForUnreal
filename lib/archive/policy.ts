import { relativePath } from './paths';
export type Decision='INCLUDE'|'EXCLUDE'|'REVIEW';
export function pluginRoots(files:string[]):string[]{
 return files.map(f=>relativePath(f).path.toLowerCase()).filter(f=>f.startsWith('plugins/')&&f.endsWith('.uplugin')).map(f=>f.slice(0,f.lastIndexOf('/'))).sort((a,b)=>b.length-a.length);
}
export function unrealDecision(input:string,roots:string[]=[]):{decision:Decision;reason:string} {
  const p=relativePath(input).path.toLowerCase().split('/');
  const first=p[0];
  const full=p.join('/'),plugin=roots.find(r=>full.startsWith(r+'/'));
  const systemIndex=plugin?plugin.split('/').length:first==='plugins'?2:0;
  const scope=p[systemIndex],rest=p.slice(systemIndex+1);
  if(first==='content'||(first==='plugins'&&scope==='content')) return {decision:'INCLUDE',reason:'미사용 항목을 포함한 Content 보존'};
  if(scope==='intermediate'||scope==='deriveddatacache'||scope==='.vs'||scope==='.idea') return {decision:'EXCLUDE',reason:'재생성 가능한 캐시·중간 파일'};
  if(scope==='saved'&&['logs','crashes'].includes(rest[0])) return {decision:'EXCLUDE',reason:'진단 로그·크래시 자료'};
  if(scope==='saved'&&/\.(mp4|mov|mxf|avi|webm|png|jpe?g|exr|tiff?|bmp)$/i.test(p.at(-1)||'')) return {decision:'INCLUDE',reason:'Saved 아래 제작 출력 영상·이미지'};
  if(scope==='saved'||scope==='binaries'||/\.(dll|lib)$/i.test(p.at(-1)||'')) return {decision:'REVIEW',reason:'필수 바이너리·설정·고유 작업 여부 확인 필요'};
  if(['config','source','build','shaders','resources','scripts','plugins'].includes(first)||/\.(uproject|uplugin|build\.cs|target\.cs)$/i.test(p.at(-1)||'')) return {decision:'INCLUDE',reason:'프로젝트 재편집 입력'};
  return {decision:'REVIEW',reason:'미분류 파일의 보존 여부 확인 필요'};
}
export function mimeFor(p:string):string {
  const ext=p.split('.').at(-1)?.toLowerCase();
  return ({mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',mxf:'application/mxf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif',pdf:'application/pdf'} as Record<string,string>)[ext||'']||'application/octet-stream';
}
// GET /api/archive/policies 에서 제공하는 현재 보존 정책 설명. 판정 로직은 unrealDecision이 기준이다.
export const POLICY_VERSION='ue-cache-only-v1';
export const POLICY_RULES:{scope:string;decision:Decision|'INCLUDE/REVIEW';reason:string}[]=[
  {scope:'.uproject / .uplugin / *.Build.cs / *.Target.cs',decision:'INCLUDE',reason:'엔진 연결·모듈 descriptor'},
  {scope:'Content/** (프로젝트·플러그인)',decision:'INCLUDE',reason:'미사용 항목을 포함한 Content 전체 보존'},
  {scope:'Config/**, Source/**, Build/**, Shaders/**, Resources/**, Scripts/**',decision:'INCLUDE',reason:'재편집·재빌드 입력'},
  {scope:'Intermediate/**, DerivedDataCache/**, .vs/**, .idea/** (루트·플러그인 단위)',decision:'EXCLUDE',reason:'재생성 가능한 캐시·중간 파일'},
  {scope:'Saved/Logs/**, Saved/Crashes/**',decision:'EXCLUDE',reason:'진단 로그·크래시 자료'},
  {scope:'Saved/** 아래 영상·이미지 출력',decision:'INCLUDE',reason:'에디터 출력 결과물'},
  {scope:'Saved/** 기타, Binaries/**, *.dll, *.lib',decision:'REVIEW',reason:'필수 바이너리·설정·고유 작업 여부 확인'},
  {scope:'그 밖의 미분류 파일',decision:'REVIEW',reason:'자동 누락하지 않고 사람이 판단'},
];
