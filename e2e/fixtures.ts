import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
export const ADMIN={email:'admin@e2e.test',password:'e2e-admin-password-2026!',name:'E2E 관리자'};
export const VIEWER={email:'viewer@e2e.test',password:'e2e-viewer-password-2026!',name:'E2E 조회자'};
export const statePath=(who:'admin'|'viewer')=>path.join(process.env.E2E_DATA_ROOT!,'auth',who+'.json');
export const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export const png=(color:string,width=640,height=360)=>sharp({create:{width,height,channels:4,background:color}}).png().toBuffer();
export const fbx=(text:string)=>Buffer.from('; FBX 7.4.0 project file\n; '+text+'\n');
