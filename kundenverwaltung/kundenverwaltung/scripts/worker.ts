import {schedulerTick} from '../lib/messages';
import {audit,closeDatabase} from '../lib/db';
import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
console.log('Benachrichtigungsdienst gestartet · Europe/Vienna · Versand gemäß Datenbankschaltern.');
while(!stopped){
 try{await schedulerTick();await writeFile(path.join(tmpdir(),'kundenraum-worker-heartbeat'),new Date().toISOString());}
 catch{try{await audit('scheduler','scheduler.error','worker',{status:'configuration_or_transport_error'});}catch{console.error('Worker: Datenbank nicht bereit.');}}
 if(process.argv.includes('--once'))break;await new Promise(resolve=>setTimeout(resolve,60000));
}
await closeDatabase();
