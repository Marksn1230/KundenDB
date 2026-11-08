import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {all,audit,get,run,transaction} from './db';
export async function copySqliteToCurrent(filename:string){
 const absolute=path.resolve(filename);if(!existsSync(absolute))throw new Error('SQLite-Quelldatei nicht gefunden.');
 const source=new DatabaseSync(absolute,{readOnly:true});
 try{
   const version=Number(source.prepare('PRAGMA user_version').get()!.user_version);if(version<4)throw new Error('SQLite-Quelle zuerst mit npm run migrate auf Schema 4 aktualisieren.');
   return await transaction(async()=>{
     for(const table of ['customers','periods','principals','deliveries','audit_log','import_receipts'])if(Number((await get<{count:number}>('SELECT COUNT(*) AS count FROM '+table))?.count||0)>0)throw new Error('Zieldatenbank ist nicht leer. Keine Bestandsdaten wurden überschrieben.');
     const counts:Record<string,number>={};
     for(const table of ['principals','customers','periods','integration_settings','deliveries','audit_log','import_receipts']){
       const rows=source.prepare('SELECT * FROM '+table).all();counts[table]=rows.length;
       if(table==='integration_settings')await run('DELETE FROM integration_settings WHERE id=1');
       for(const row of rows){const values={...row};if(table==='deliveries'&&values.status==='processing')values.status='unknown';
         const columns=Object.keys(values);await run('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',...Object.values(values) as (string|number|null)[]);
       }
     }
     for(const table of ['customers','periods','deliveries','audit_log'])await get("SELECT setval(pg_get_serial_sequence(?, 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "+table+"),0),1), COALESCE((SELECT MAX(id) FROM "+table+"),0)>0)",table);
     await audit('migration','migration.sqlite.postgres','database',{source:path.basename(absolute),counts,revoked_sessions:true});
     return counts;
   });
 }finally{source.close();}
}
