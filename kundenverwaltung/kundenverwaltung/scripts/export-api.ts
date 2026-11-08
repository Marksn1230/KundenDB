import {writeFileSync,mkdirSync} from 'node:fs';
import {openapi} from '../lib/openapi';
mkdirSync('docs',{recursive:true});writeFileSync('docs/openapi.json',JSON.stringify(openapi,null,2)+'\n');
console.log('docs/openapi.json aktualisiert.');
