import { dispatch } from '@/lib/archive/api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{path:string[]}>};
async function handler(req:Request,context:Context){return dispatch(req,(await context.params).path);}
export {handler as GET,handler as POST,handler as PUT,handler as PATCH,handler as DELETE,handler as HEAD};
