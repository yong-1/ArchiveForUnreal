export class RequestError extends Error {constructor(message:string,public status:number,public code:string){super(message);}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch('/api/archive/'+path,{...options,headers:{...(options.body&&typeof options.body==='string'?{'Content-Type':'application/json'}:{}),...options.headers},cache:'no-store'});
 const data=await response.json();
 if(!response.ok)throw new RequestError(data.error?.message||'요청을 처리하지 못했습니다.',response.status,data.error?.code||'REQUEST_FAILED');
 return data as T;
}
export const patch=<T>(path:string,body:unknown={})=>api<T>(path,{method:'PATCH',body:JSON.stringify(body)});
export const relationLabel:Record<string,string>={ASSOCIATED:'연관',USED_CONFIRMED:'실사용 확인'};
export const post=<T>(path:string,body:unknown={})=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
export function bytes(value:string|number|undefined){let n=Number(value||0);const units=['B','KB','MB','GB','TB'];let u=0;while(n>=1024&&u<units.length-1){n/=1024;u++;}return n.toLocaleString('ko-KR',{maximumFractionDigits:u?1:0})+' '+units[u];}
export const kinds:Record<string,string>={VIDEO:'동영상',IMAGE:'이미지',MODEL3D:'3D',FILE:'기타 파일',UNREAL_PROJECT:'Unreal'};
export const stateLabel:Record<string,string>={QUEUED:'대기 중',RUNNING:'처리 중',COMPLETED:'완료',FAILED:'실패',WAITING:'사용 중인 파일 대기',CANCELLED:'취소',UPLOADING:'업로드 중',COMMITTING:'보존·검증 중',COMMITTED:'보존 완료',PLANNED:'삭제 범위 확인',CONFIRMED:'삭제 접수',DELETING:'삭제 중',PARTIAL:'일부 실패',WAITING_FOR_LEASES:'전송 종료 대기',READY:'준비 완료',PENDING:'변환 대기',UNSUPPORTED:'미지원',NOT_TESTED:'열기 미검증',ENVIRONMENT_MISSING:'검증 환경 필요',PASSED:'수동 검증 보고',VERIFIED:'원본 보존 완료',EXPIRED:'만료'};
export function date(value:string){return new Date(value).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'});}
