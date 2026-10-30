import { currentActor } from '@/lib/archive/access';
import { json,route } from '@/lib/archive/http';
export async function GET(req:Request){return route(async()=>{const actor=await currentActor(req);return json({id:actor.userId,name:actor.name,role:actor.role});});}
