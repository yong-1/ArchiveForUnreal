// 운영자가 정리·무결성 점검을 즉시 한 번 실행할 때 사용한다(평소에는 worker가 주기적으로 예약).
// 사용: npm run maintenance  (DATABASE_URL과 저장소 경로는 .env.local/.env에서 읽음)
import { config } from 'dotenv';
config({path:'.env.local',quiet:true});config({quiet:true});
const{db}=await import('../lib/archive/db');
const{actorFor}=await import('../lib/archive/access');
const{processMaintenance}=await import('../lib/archive/maintenance');
try{
 for(const team of await db.team.findMany({select:{id:true,name:true}})){
  const owner=await db.membership.findFirst({where:{teamId:team.id,role:'ADMIN'},orderBy:{id:'asc'}});
  if(!owner){console.log(team.name+': 관리자가 없어 건너뜁니다.');continue;}
  const result=await processMaintenance(await actorFor(owner.userId,team.id),team.id,async()=>{});
  console.log(team.name+':',JSON.stringify(result,null,2));
 }
}finally{await db.$disconnect();}
