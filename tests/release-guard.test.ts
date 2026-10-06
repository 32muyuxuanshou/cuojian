import {expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

it('does not confuse mask CSS classes with API credentials and rejects a real-looking key',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'cuojian-build-guard-'));
 try{
  await writeFile(path.join(directory,'index.js'),'const styles="mask-radial-at-bottom-right mask-conic-from-transparent";');
  expect(execFileSync(process.execPath,['scripts/check-public-build.mjs',directory],{encoding:'utf8'})).toContain('passed');
  await writeFile(path.join(directory,'index.js'),'const apiKey="sk-'+ 'a'.repeat(32)+'";');
  expect(()=>execFileSync(process.execPath,['scripts/check-public-build.mjs',directory],{stdio:'pipe'})).toThrow();
 }finally{
  const resolved=path.resolve(directory);const prefix=path.join(path.resolve(tmpdir()),'cuojian-build-guard-');
  if(!resolved.startsWith(prefix))throw new Error('Invalid test cleanup path');
  await rm(resolved,{recursive:true,force:true});
 }
});
