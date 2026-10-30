import { timingSafeEqual } from 'node:crypto';
import { hash } from 'bcrypt-ts';
import { z } from 'zod';
import { db,serial } from './db';
import { check } from './errors';
import { configuredPaths } from './paths';
import { mkdir } from 'node:fs/promises';
export const bootstrapInput=z.object({token:z.string().min(32).max(256),email:z.email(),name:z.string().min(1).max(80),password:z.string().min(12).max(128),teamName:z.string().min(1).max(100)});
export async function bootstrap(raw:unknown){
  const input=bootstrapInput.parse(raw);
  const secret=process.env.BOOTSTRAP_TOKEN||'';
  check(secret.length>=32&&secret.length===input.token.length&&timingSafeEqual(Buffer.from(secret),Buffer.from(input.token)),403,'INVALID_SETUP_TOKEN','초기 설정 토큰을 확인하세요.');
  const paths=configuredPaths();
  for(const p of Object.values(paths))await mkdir(p,{recursive:true});
  const passwordHash=await hash(input.password,12);
  return serial(async tx=>{
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(987654321)');
    check(await tx.user.count()===0,409,'ALREADY_INITIALIZED','이미 초기 설정을 완료했습니다.');
    const user=await tx.user.create({data:{name:input.name,email:input.email.toLowerCase(),hashedPassword:passwordHash}});
    const team=await tx.team.create({data:{name:input.teamName}});
    await tx.membership.create({data:{teamId:team.id,userId:user.id,role:'ADMIN'}});
    await tx.category.createMany({data:['예능','교양'].map(name=>({teamId:team.id,name}))});
    await tx.facility.createMany({data:['홀','중계차'].map(name=>({teamId:team.id,name}))});
    for(const[k,p]of Object.entries(paths))await tx.storageRoot.create({data:{teamId:team.id,name:k,kind:k.toUpperCase(),path:p}});
    await tx.auditEvent.create({data:{teamId:team.id,actorId:user.id,action:'INITIALIZED',targetId:team.id}});
    return {initialized:true};
  });
}
export async function setupStatus(){
  try{return {configured:!!process.env.DATABASE_URL,initialized:await db.user.count()>0};}
  catch{return {configured:false,initialized:false};}
}
