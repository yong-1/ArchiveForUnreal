import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ArchiveError,check } from './errors';
export function json(data:unknown,status=200) {
  return new Response(JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'}});
}
export function sameOrigin(req:Request) {
  if(['GET','HEAD','OPTIONS'].includes(req.method))return;
  const origin=req.headers.get('origin');
  const expected=new URL(process.env.NEXTAUTH_URL||req.url).origin;
  check(origin===expected,403,'INVALID_ORIGIN','요청 출처가 일치하지 않습니다.');
}
export async function limitedJson(req:Request,max=2_000_000) {
  return JSON.parse((await readLimited(req,max)).toString('utf8'));
}
export async function readLimited(req:Request,max:number) {
  const length=Number(req.headers.get('content-length')||0);
  check(length<=max,413,'TOO_LARGE','요청 크기가 제한을 초과했습니다.');
  if(!req.body)return Buffer.alloc(0);
  const reader=req.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new ArchiveError(413,'TOO_LARGE','요청 크기가 제한을 초과했습니다.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks);
}
export async function route(fn:()=>Promise<Response>) {
  const requestId=randomUUID();
  try{return await fn();}
  catch(e){
    if(e instanceof ArchiveError)return json({error:{code:e.code,message:e.message,requestId}},e.status);
    if(e instanceof ZodError)return json({error:{code:'INVALID_INPUT',message:e.issues.map(i=>i.path.join('.')+': '+i.message).slice(0,4).join(' / '),requestId}},400);
    if(e instanceof SyntaxError)return json({error:{code:'INVALID_JSON',message:'JSON 요청 형식이 올바르지 않습니다.',requestId}},400);
    if(e instanceof Prisma.PrismaClientKnownRequestError&&['P2023','P2025'].includes(e.code))return json({error:{code:e.code==='P2025'?'NOT_FOUND':'INVALID_INPUT',message:e.code==='P2025'?'자료를 찾을 수 없습니다.':'요청 값의 형식이 올바르지 않습니다.',requestId}},e.code==='P2025'?404:400);
    if(e instanceof Prisma.PrismaClientKnownRequestError&&['P2002','P2003','P2034'].includes(e.code))return json({error:{code:'CONFLICT',message:'다른 작업과 충돌했습니다. 새로고침 후 확인하세요.',requestId}},409);
    console.error('[archive]',requestId,e instanceof Error?e.name:'unknown');
    return json({error:{code:'SERVICE_UNAVAILABLE',message:'서비스 연결 또는 작업 처리에 실패했습니다. 관리자에게 요청 ID를 알려주세요.',requestId}},503);
  }
}
