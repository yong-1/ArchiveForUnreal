import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
export const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function canonical(value:unknown):string {
  if(typeof value==='bigint') return JSON.stringify(value.toString());
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.entries(value as Record<string,unknown>).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
}
export const hashJson=(value:unknown)=>sha256(canonical(value));
export async function fileHash(p:string) {
  const h=createHash('sha256'); for await(const chunk of createReadStream(p))h.update(chunk); return h.digest('hex');
}
