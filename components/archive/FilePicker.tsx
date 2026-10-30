'use client';
import { useRef } from 'react';
import { bytes } from './client';
import { Icon } from './ui';
export type FileEntry={file:File;path:string};
export const canonicalPath=(p:string)=>p.replace(/\\/g,'/').normalize('NFC').toLowerCase();
export function FilePicker({files,onChange,label='원본 파일',prefix='',setPrefix}:{files:FileEntry[];onChange:(files:FileEntry[])=>void;label?:string;prefix?:string;setPrefix?:(v:string)=>void}){
 const folder=useRef<HTMLInputElement>(null),input=useRef<HTMLInputElement>(null);
 const select=(selected:FileList|null,stripRoot=false)=>{
  if(!selected)return;
  onChange(Array.from(selected).map(file=>{const relative=file.webkitRelativePath?(stripRoot?file.webkitRelativePath.split('/').slice(1).join('/'):file.webkitRelativePath):file.name;return {file,path:[prefix,relative].filter(Boolean).join('/')};}));
 };
 return <div className="file-picker"><label className="field-label">{label}</label><div className="drop-zone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();select(e.dataTransfer.files);}}><span className="drop-icon"><Icon name="plus" size={26}/></span><h3>파일을 끌어 놓거나 선택하세요</h3><p>원본 파일·폴더를 NAS에 보존합니다</p><div className="inline-actions"><button className="button button-small" type="button" onClick={()=>input.current?.click()}>파일 선택</button><button className="button button-small subtle" type="button" onClick={()=>folder.current?.click()}>폴더 선택</button></div><input hidden type="file" multiple ref={input} onChange={e=>select(e.target.files)}/><input hidden type="file" multiple ref={el=>{folder.current=el;el?.setAttribute('webkitdirectory','');}} onChange={e=>select(e.target.files,true)}/></div>
  {setPrefix&&<label className="small-field">보존 상대폴더 (선택)<input placeholder="예: Content/Models" value={prefix} onChange={e=>{const old=prefix;setPrefix(e.target.value);onChange(files.map(f=>({...f,path:[e.target.value,old&&f.path.startsWith(old+'/')?f.path.slice(old.length+1):f.path].filter(Boolean).join('/')})));}}/></label>}
  {files.length>0&&<div className="selected-files"><div><b>{files.length}개 선택</b><span>{bytes(files.reduce((n,f)=>n+f.file.size,0))}</span><button className="text-button" type="button" onClick={()=>onChange([])}>선택 해제</button></div>{files.slice(0,12).map(f=><p key={f.path}><span>{f.path}</span><small>{bytes(f.file.size)}</small></p>)}{files.length>12&&<small>외 {files.length-12}개</small>}</div>}
 </div>;
}
