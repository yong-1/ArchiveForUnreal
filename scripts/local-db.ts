import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFile,mkdir,readdir } from 'node:fs/promises';
import path from 'node:path';
export async function startLocalDatabase(port=Number(process.env.LOCAL_DB_PORT||55432),directory=path.resolve('.local/postgres')){
 await mkdir(directory,{recursive:true});
 const database=await PGlite.create(directory);
 await database.exec('CREATE TABLE IF NOT EXISTS _archive_local_schema (name text PRIMARY KEY)');
 for(const entry of (await readdir('prisma/migrations',{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){
  const applied=await database.query('SELECT name FROM _archive_local_schema WHERE name=$1',[entry.name]);
  if(!applied.rows.length){await database.exec(await readFile(path.resolve('prisma/migrations',entry.name,'migration.sql'),'utf8'));await database.query('INSERT INTO _archive_local_schema(name) VALUES ($1)',[entry.name]);}
 }
 const server=new PGLiteSocketServer({db:database,port,host:'127.0.0.1',maxConnections:10});
 await server.start();
 return {url:'postgresql://postgres@127.0.0.1:'+port+'/postgres?connection_limit=1&connect_timeout=15',close:async()=>{await server.stop();await database.close();}};
}
if(process.argv[1]?.replace(/\\/g,'/').endsWith('/local-db.ts')){
 const local=await startLocalDatabase();console.log('개발용 PostgreSQL 호환 DB: 127.0.0.1:55432 (PGlite, 운영용 아님)');
 const close=async()=>{await local.close();process.exit(0);};process.on('SIGINT',close);process.on('SIGTERM',close);
}
