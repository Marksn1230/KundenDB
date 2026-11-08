import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
const index=process.argv.indexOf('--output'),output=process.argv[index+1];
if(index<0||!output)throw new Error('Aufruf: npm run snapshot:sqlite -- --output backups/kunden.sqlite');
const target=path.resolve(output);if(existsSync(target))throw new Error('Die Zieldatei existiert bereits und wird nicht überschrieben.');
mkdirSync(path.dirname(target),{recursive:true});
const source=new DatabaseSync(path.resolve(process.env.DATABASE_PATH||'data/kunden.sqlite'),{readOnly:true});
try{source.exec("VACUUM INTO '"+target.replaceAll("'","''")+"'");console.log('Konsistenter SQLite-Snapshot angelegt:',target);}finally{source.close();}
