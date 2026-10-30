import { readFile } from 'node:fs/promises';
import { db } from './db';
import { check } from './errors';
import { sha256 } from './hash';
import { objectPath } from './storage';
import { storageFailure } from './paths';
export type ManifestFile={path:string;size:string;sha256:string};
export type Manifest={schemaVersion:number;itemId:string;versionId:string;planHash:string;policy:string;files:ManifestFile[];environment:unknown};
// AR-09/AR-18: NAS에 보존한 canonical manifest bytes의 해시와 DB 파일 목록을 서로 대조한다.
// 다운로드·복원 전에 호출해 DB만 맞고 NAS manifest가 손상·불일치한 보존본을 제공하지 않는다.
export async function verifyManifest(itemVersionId:string):Promise<Manifest>{
 const archive=await db.archiveVersion.findUnique({where:{itemVersionId},include:{files:{where:{active:true}}}});
 check(archive?.state==='VERIFIED'&&archive.manifestObjectId&&archive.manifestHash,409,'NOT_READY','검증된 보존본이 아닙니다.');
 const{path}=await objectPath(archive.manifestObjectId);
 const bytes=await storageFailure(()=>readFile(path));
 check(sha256(bytes)===archive.manifestHash,409,'MANIFEST_CORRUPT','보존 manifest 해시가 일치하지 않습니다. 관리자에게 무결성 점검을 요청하세요.');
 const manifest=JSON.parse(bytes.toString('utf8')) as Manifest;
 const key=(f:ManifestFile)=>f.path+'\u0000'+f.size+'\u0000'+f.sha256;
 const expected=new Set(archive.files.map(f=>key({path:f.relativePath,size:f.sizeBytes.toString(),sha256:f.checksum})));
 check(manifest.versionId===itemVersionId&&manifest.files.length===expected.size&&manifest.files.every(f=>expected.has(key(f))),409,'MANIFEST_MISMATCH','보존 manifest와 DB 파일 목록이 다릅니다. 관리자에게 무결성 점검을 요청하세요.');
 return manifest;
}
