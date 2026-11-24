import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');for(const dir of ['src','public','scripts','tests'])for(const file of readdirSync(path.join(root,dir)))if(/\.(mjs|js)$/.test(file))execFileSync(process.execPath,['--check',path.join(root,dir,file)]);
const html=readFileSync(path.join(root,'public/index.html'),'utf8');if(/onclick=|onload=/.test(html))throw new Error('Inline event handler violates CSP');console.log('JavaScript syntax and static entry checks passed.');
