import {readFileSync,writeFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {resolve,dirname,join,sep} from 'node:path';
import {createHash} from 'node:crypto';

const root=resolve('public'),hashes=new Map();
for(const name of readdirSync(root,{recursive:true}).filter(name=>name.endsWith('.html'))){
 const file=join(root,name),original=readFileSync(file,'utf8');
 const updated=original.replace(/(src|href)="([^"?]+\.(?:js|css))(?:\?[^" ]*)?"/g,(match,attribute,url)=>{
  if(/^(?:https?:)?\/\//.test(url))return match;
  const asset=url.startsWith('/')?join(root,url.slice(1)):resolve(dirname(file),url);
  if(!asset.startsWith(root+sep)||!existsSync(asset)||!statSync(asset).isFile())return match;
  if(!hashes.has(asset))hashes.set(asset,createHash('sha256').update(readFileSync(asset)).digest('hex').slice(0,12));
  return `${attribute}="${url}?v=${hashes.get(asset)}"`;
 });
 if(updated!==original)writeFileSync(file,updated);
}
