import { runOne } from './worker';
import { scheduleMaintenance } from './maintenance';
export function startDevelopmentWorker(){
 const state=globalThis as unknown as {archiveDevelopmentWorker?:boolean};
 if(state.archiveDevelopmentWorker)return;
 state.archiveDevelopmentWorker=true;
 let lastSchedule=0;
 const tick=async()=>{try{if(Date.now()-lastSchedule>60_000){lastSchedule=Date.now();await scheduleMaintenance();}await runOne();}catch(error){console.error('[development-worker]',error instanceof Error?error.name:'error');}finally{setTimeout(tick,750).unref();}};
 void tick();
}
