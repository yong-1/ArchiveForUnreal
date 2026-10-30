import { json } from '@/lib/archive/http';
export async function GET(){return json({error:{code:'REPLACED',message:'/api/archive/favorites를 사용하세요.'}},410);}
export const POST=GET;
export const DELETE=GET;
