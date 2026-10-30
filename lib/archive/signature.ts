// 확장자가 알려진 형식은 첫 바이트(매직 넘버)가 일치해야 한다. 확장자만으로 형식·안전성을 보장하지 않기 위한 검사다.
// 알 수 없는 확장자와 0바이트 파일은 검사하지 않는다(보존 대상에서 자동 제외하지 않음).
type Rule=(head:Buffer)=>boolean;
const starts=(...bytes:number[]):Rule=>head=>head.length>=bytes.length&&bytes.every((b,i)=>head[i]===b);
const ascii=(text:string,offset=0):Rule=>head=>head.length>=offset+text.length&&head.subarray(offset,offset+text.length).toString('latin1')===text;
const any=(...rules:Rule[]):Rule=>head=>rules.some(r=>r(head));
const isoMedia=ascii('ftyp',4);
const tiff=any(starts(0x49,0x49,0x2a,0x00),starts(0x4d,0x4d,0x00,0x2a),starts(0x49,0x49,0x2b,0x00),starts(0x4d,0x4d,0x00,0x2b));
const zip=any(starts(0x50,0x4b,0x03,0x04),starts(0x50,0x4b,0x05,0x06),starts(0x50,0x4b,0x07,0x08));
const unrealPackage=starts(0xc1,0x83,0x2a,0x9e);
const rules:Record<string,Rule>={
  png:starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a),
  jpg:starts(0xff,0xd8,0xff),jpeg:starts(0xff,0xd8,0xff),
  gif:any(ascii('GIF87a'),ascii('GIF89a')),
  webp:head=>ascii('RIFF')(head)&&ascii('WEBP',8)(head),
  avif:isoMedia,heic:isoMedia,
  bmp:ascii('BM'),
  tif:tiff,tiff:tiff,
  psd:ascii('8BPS'),
  exr:starts(0x76,0x2f,0x31,0x01),
  mp4:isoMedia,m4v:isoMedia,mov:any(isoMedia,ascii('moov',4),ascii('wide',4),ascii('mdat',4),ascii('free',4),ascii('skip',4),ascii('pnot',4)),
  webm:starts(0x1a,0x45,0xdf,0xa3),mkv:starts(0x1a,0x45,0xdf,0xa3),
  avi:head=>ascii('RIFF')(head)&&ascii('AVI ',8)(head),
  mxf:starts(0x06,0x0e,0x2b,0x34),
  wav:head=>ascii('RIFF')(head)&&ascii('WAVE',8)(head),
  pdf:ascii('%PDF-'),
  zip:zip,
  fbx:any(ascii('Kaydara FBX Binary'),head=>/^\s*;/.test(head.subarray(0,64).toString('latin1'))),
  uasset:unrealPackage,umap:unrealPackage,
};
export const SIGNATURE_BYTES=64;
export function signatureMismatch(relativePath:string,head:Buffer):boolean{
  if(head.length===0)return false;
  const ext=relativePath.split('/').at(-1)?.split('.').at(-1)?.toLowerCase()||'';
  const rule=rules[ext];
  return !!rule&&!rule(head);
}
