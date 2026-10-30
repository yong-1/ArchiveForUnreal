import { config } from 'dotenv';
config({path:'.env.local',quiet:true});config({quiet:true});
const{runOne}=await import('../lib/archive/worker');
const{db}=await import('../lib/archive/db');
const{scheduleMaintenance}=await import('../lib/archive/maintenance');
let lastSchedule=0;
let stopping=false;
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
console.log('Archive worker 시작 (파일 작업 동시성: 1)');
while(!stopping){
 try{
  // 정리·무결성 점검은 팀마다 MAINTENANCE_INTERVAL_MINUTES(기본 60분)마다 한 번 예약된다.
  if(Date.now()-lastSchedule>60_000){lastSchedule=Date.now();await scheduleMaintenance();}
  if(!await runOne())await new Promise(r=>setTimeout(r,1000));}
 catch{console.error('worker: DB 연결을 기다립니다.');await new Promise(r=>setTimeout(r,5000));}
}
await db.$disconnect();
