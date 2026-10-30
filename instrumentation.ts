export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.ARCHIVE_INLINE_WORKER==='1'&&process.env.NODE_ENV!=='production'){
  const {startDevelopmentWorker}=await import('./lib/archive/dev-worker');
  startDevelopmentWorker();
 }
}
