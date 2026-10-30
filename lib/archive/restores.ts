import { mkdir,copyFile,constants,stat } from 'node:fs/promises';
import path from 'node:path';
import { db } from './db';
import { Actor,admin,itemAccess } from './access';
import { check } from './errors';
import { rootsSeparate,safePath } from './paths';
import { objectLease,releaseLeases,objectPath,availableSpace } from './storage';
import { verifyManifest } from './manifest';
import { fileHash } from './hash';
export async function queueRestore(actor:Actor,versionId:string){
 admin(actor);const version=await db.itemVersion.findUnique({where:{id:versionId}});
 check(version?.state==='READY',404,'NOT_FOUND','복원할 버전을 찾을 수 없습니다.');await itemAccess(actor,version.itemId,'DOWNLOAD');
 check(process.env.RESTORE_ROOT,503,'RESTORE_ROOT_MISSING','새 작업 공간용 RESTORE_ROOT 설정이 필요합니다. ZIP 다운로드 후 직접 복원할 수도 있습니다.');
 return db.job.create({data:{teamId:actor.teamId,actorId:actor.userId,type:'RESTORE',targetId:versionId}});
}
export async function processRestore(actor:Actor,versionId:string,jobId:string,assertLease:()=>Promise<void>,progress:(data:Record<string,unknown>)=>Promise<void>=async()=>{}){
 admin(actor);const version=await db.itemVersion.findUnique({where:{id:versionId},include:{archive:{include:{files:{where:{active:true}}}},unreal:true}});
 check(version?.archive?.state==='VERIFIED',409,'NOT_READY','검증한 보존본이 필요합니다.');await itemAccess(actor,version.itemId,'DOWNLOAD');
 const root=process.env.RESTORE_ROOT;check(root,503,'RESTORE_ROOT_MISSING','새 복원 루트를 설정하세요.');
 const others=await db.storageRoot.findMany({where:{teamId:actor.teamId}});
 check(rootsSeparate([root,...others.map(r=>r.path)]),400,'OVERLAPPING_ROOTS','복원 위치와 원본·보존 저장소가 겹칩니다.');
 await verifyManifest(versionId);
 const target=await safePath(root,jobId,true);await mkdir(target,{recursive:true});
 // 이미 복원된 파일을 제외한 남은 바이트만큼 여유 공간이 있어야 시작한다(용량 폭증 방지).
 let remaining=0n;for(const file of version.archive.files){try{await stat(await safePath(target,file.relativePath));}catch{remaining+=file.sizeBytes;}}
 await availableSpace(target,remaining);
 const owner='restore:'+jobId;await objectLease(version.archive.files.map(f=>f.storageObjectId),owner);
 try{
  let done=0;
  for(const file of version.archive.files){
   await assertLease();await progress({phase:'restore',done:done++,total:version.archive.files.length});const source=await objectPath(file.storageObjectId),destination=await safePath(target,file.relativePath,true);
   try{await copyFile(source.path,destination,constants.COPYFILE_EXCL);}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    check((await stat(destination)).isFile()&&await fileHash(destination)===file.checksum,409,'RESTORE_CONFLICT','이전 복원 파일이 다릅니다. 덮어쓰지 않았습니다. 새 복원 작업을 요청하세요.');
   }
   check(await fileHash(destination)===file.checksum,409,'RESTORE_CORRUPT','복원 파일 체크섬이 일치하지 않습니다.');
  }
  await assertLease();
  await db.restoreValidation.create({data:{archiveId:version.archive.id,actorId:actor.userId,state:'NOT_TESTED',environment:{schemaVersion:1,workspaceId:jobId},report:'manifest 파일 복원 검증 완료. UE 에디터 열기 검증은 수행하지 않았습니다.'}});
  return {workspaceId:jobId,fileCount:version.archive.files.length,fileIntegrity:'VERIFIED',unrealValidation:'NOT_TESTED'};
 }finally{await releaseLeases(owner);}
}
