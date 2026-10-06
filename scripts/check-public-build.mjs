import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(process.argv[2]||'mobile-dist');
async function inspect(directory){
 const unsafe=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isDirectory())unsafe.push(...await inspect(file));
  else if(/\.(?:js|mjs|html|json)$/.test(file)){
   const source=await readFile(file,'utf8');
   if(/sk-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[opusr]_[A-Za-z0-9]{30,}/.test(source))unsafe.push(path.relative(root,file));
  }
 }
 return unsafe;
}
const unsafe=await inspect(root);
if(unsafe.length){console.error('Refusing public release: credential-like strings found in '+unsafe.join(', '));process.exitCode=1;}
else console.log('Public build credential check passed.');
