import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativePath,rootsSeparate } from '../lib/archive/paths';
import { unrealDecision,pluginRoots } from '../lib/archive/policy';
import { byteRange } from '../lib/archive/downloads';
import { canonical,hashJson } from '../lib/archive/hash';
test('PLAN-03/SEC: reject traversal, absolute/ADS/reserved paths and Windows restore collisions',()=>{
 for(const value of ['../secret','a/../../secret','C:/secret','/etc/passwd','a.txt:secret','a/NUL.txt','a/thing.','a//b','_ARCHIVE/manifest.json'])assert.throws(()=>relativePath(value));
 assert.equal(relativePath('Content/지구.uasset').canonical,relativePath('content/지구.UASSET').canonical);
 assert.equal(relativePath('Texture/'+String.fromCharCode(0x1100,0x1161)+'.png').canonical,relativePath('texture/가.png').canonical);
 assert.equal(rootsSeparate(['/archive','/archive/staging']),false);
});
test('UEF-01~07/12: exclude only scoped generated data and preserve Content and render outputs',()=>{
 for(const file of ['Content/Intermediate/Real.uasset','Content/Saved/Real.uasset','Content/Unused.umap','Config/DefaultEngine.ini','Source/Main.Build.cs','Build/Windows/icon.ico','Saved/MovieRenders/Final.mp4','Plugins/P/Content/Unused.uasset'])assert.equal(unrealDecision(file).decision,'INCLUDE',file);
 for(const file of ['Intermediate/Cached.obj','DerivedDataCache/hash','Saved/Logs/editor.log','Plugins/P/Intermediate/generated.obj'])assert.equal(unrealDecision(file).decision,'EXCLUDE',file);
 for(const file of ['Binaries/Win64/Required.dll','Saved/Config/Windows/Editor.ini','Saved/Autosaves/map.umap','unknown.custom'])assert.equal(unrealDecision(file).decision,'REVIEW',file);
 const plugins=pluginRoots(['Plugins/Vendor/Tool/Tool.uplugin']);
 assert.equal(unrealDecision('Plugins/Vendor/Tool/Intermediate/Content/cache.bin',plugins).decision,'EXCLUDE');
 assert.equal(unrealDecision('Plugins/Vendor/Tool/Content/Intermediate/Real.uasset',plugins).decision,'INCLUDE');
 assert.equal(unrealDecision('Plugins/Vendor/Tool/Binaries/Win64/Tool.dll',plugins).decision,'REVIEW');
});
test('DOWN-03: valid full, suffix, open and invalid/multi-range handling',()=>{
 assert.deepEqual(byteRange('bytes=2-4',10n),{start:2n,end:4n,partial:true});
 assert.deepEqual(byteRange('bytes=-3',10n),{start:7n,end:9n,partial:true});
 assert.deepEqual(byteRange('bytes=9-',10n),{start:9n,end:9n,partial:true});
 for(const value of ['bytes=10-','bytes=4-2','bytes=0-1,4-5','bytes=-0','invalid'])assert.throws(()=>byteRange(value,10n));
});
test('DB-06: canonical manifest hash is independent of JSONB key order and preserves 64-bit bytes',()=>{
 assert.equal(hashJson({a:1,b:{d:4,c:3}}),hashJson({b:{c:3,d:4},a:1}));
 assert.equal(canonical({bytes:9007199254740993n}),'{"bytes":"9007199254740993"}');
});
test('UPL-03/NFR-03: known extensions must carry a matching file signature',async()=>{
 const{signatureMismatch}=await import('../lib/archive/signature');
 const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0]);
 assert.equal(signatureMismatch('Textures/Earth.png',png),false);
 assert.equal(signatureMismatch('Textures/Earth.PNG',Buffer.from('MZ executable')),true);
 assert.equal(signatureMismatch('Final.mp4',Buffer.concat([Buffer.from([0,0,0,0x18]),Buffer.from('ftypisom')])),false);
 assert.equal(signatureMismatch('Final.mp4',png),true);
 assert.equal(signatureMismatch('Content/Map.umap',Buffer.from([0xc1,0x83,0x2a,0x9e,1])),false);
 assert.equal(signatureMismatch('Models/Rocket.fbx',Buffer.from('Kaydara FBX Binary  \0')),false);
 assert.equal(signatureMismatch('Models/Rocket.fbx',Buffer.from('; FBX 7.4.0 project file')),false);
 assert.equal(signatureMismatch('Models/Rocket.fbx',Buffer.from('<html>')),true);
 assert.equal(signatureMismatch('notes/unknown.xyz',Buffer.from('anything')),false,'미지원 확장자는 차단하지 않는다');
 assert.equal(signatureMismatch('empty.png',Buffer.alloc(0)),false,'0바이트 파일은 크기 검증으로 처리한다');
});
