import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,mkdtemp,readdir,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {audit} from './db';
import {fail} from './domain';
type Job={id:string;owner:string;status:'running'|'ready'|'failed'|'downloading';filename:string;directory:string;file:string;expires_at:number;bytes?:number;error?:string};
const state=globalThis as unknown as {kundenraumBackups?:Map<string,Job>;kundenraumBackupStarting?:boolean;kundenraumBackupTimer?:ReturnType<typeof setInterval>};
const jobs=state.kundenraumBackups??=new Map<string,Job>();
const root=path.join(tmpdir(),'kundenraum-backups');
const lifetime=15*60000;
async function removeDirectory(directory:string){const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(root)||!/^job-[a-zA-Z0-9]+$/.test(path.basename(resolved)))throw new Error('Ungültiger Backup-Pfad.');await rm(resolved,{recursive:true,force:true});}
export const backupAvailable=()=>Boolean(process.env.DATABASE_URL?.startsWith('postgres'));
export async function cleanupBackups(now=Date.now()){
 for(const[id,job]of jobs)if(job.expires_at<=now){jobs.delete(id);await removeDirectory(job.directory);}
 try{for(const entry of await readdir(root,{withFileTypes:true})){
  if(!entry.isDirectory()||!/^job-[a-zA-Z0-9]+$/.test(entry.name))continue;
  const directory=path.join(root,entry.name);if([...jobs.values()].some(j=>j.directory===directory))continue;
  if(now-(await stat(directory)).mtimeMs>lifetime)await removeDirectory(directory);
 }}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
function scheduleCleanup(){if(!state.kundenraumBackupTimer){state.kundenraumBackupTimer=setInterval(()=>{void cleanupBackups().catch(()=>{});},60000);state.kundenraumBackupTimer.unref();}}
export async function startBackup(owner:string){
 if(!backupAvailable())fail('Datenbank-Backups zum Herunterladen benötigen den PostgreSQL-Serverbetrieb. Diese lokale Umgebung verwendet SQLite.',503);
 await cleanupBackups();scheduleCleanup();
 if(state.kundenraumBackupStarting||[...jobs.values()].some(j=>j.status==='running'))fail('Es wird bereits ein Backup erstellt. Bitte später erneut versuchen.',409);
 state.kundenraumBackupStarting=true;
 try{
 await mkdir(root,{recursive:true,mode:0o700});const directory=await mkdtemp(path.join(root,'job-'));
 const id=randomUUID(),filename='kundenraum-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump';
 const job:Job={id,owner,status:'running',filename,directory,file:path.join(directory,filename),expires_at:Date.now()+lifetime};jobs.set(id,job);
 try{await audit(owner,'backup.create',id,{format:'custom',expires_at:new Date(job.expires_at).toISOString()});}
 catch(error){jobs.delete(id);await removeDirectory(directory);throw error;}
 // pg_dump receives credentials only through the child environment, never argv or logs.
 const database=process.env.DATABASE_URL!;
 void generate(job,database).catch(()=>{});
 return publicJob(job);
 }finally{state.kundenraumBackupStarting=false;}
}
export async function generate(job:Job,database:string){
 try{
  const connection=new URL(database),environment:NodeJS.ProcessEnv={...process.env,PGHOST:connection.hostname.replace(/^\[|\]$/g,''),PGPORT:connection.port||'5432',PGDATABASE:decodeURIComponent(connection.pathname.slice(1)),PGUSER:decodeURIComponent(connection.username),PGPASSWORD:decodeURIComponent(connection.password),PGCONNECT_TIMEOUT:'10'};
  delete environment.PGSERVICE;delete environment.PGSERVICEFILE;
  for(const [parameter,key]of Object.entries({sslmode:'PGSSLMODE',sslrootcert:'PGSSLROOTCERT',sslcert:'PGSSLCERT',sslkey:'PGSSLKEY',sslcrl:'PGSSLCRL',options:'PGOPTIONS',channel_binding:'PGCHANNELBINDING'})){const value=connection.searchParams.get(parameter);if(value)environment[key]=value;}
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(/* turbopackIgnore: true */ process.env.PG_DUMP_PATH||'pg_dump',['--format=custom','--no-password','--file',job.file],{shell:false,windowsHide:true,env:environment,stdio:['ignore','ignore','pipe']});
   // Discard libpq/pg_dump messages: they can contain database names or connection details.
   let diagnostic='dump_failed';child.stderr.on('data',chunk=>{const message=String(chunk).toLowerCase();if(message.includes('password authentication failed'))diagnostic='database_authentication';else if(message.includes('could not open output file'))diagnostic='output_file';else if(message.includes('connection')||message.includes('socket'))diagnostic='database_connection';else if(message.includes('version mismatch'))diagnostic='client_version';else if(message.includes('does not exist'))diagnostic='database_missing';});const timeout=setTimeout(()=>{child.kill();reject(new Error('timeout'));},10*60000);timeout.unref();
   child.once('error',(error:NodeJS.ErrnoException)=>{clearTimeout(timeout);reject(new Error(error.code==='ENOENT'?'tool_missing':'process_failed'));});child.once('exit',code=>{clearTimeout(timeout);code===0?resolve():reject(new Error(diagnostic));});
  });
  const size=(await stat(job.file)).size;if(size<5)throw new Error('empty');
  await audit(job.owner,'backup.ready',job.id,{bytes:size,format:'custom'});
  job.bytes=size;job.status='ready';
 }catch(error){
  job.status='failed';job.error='Backup konnte nicht erstellt werden. Bitte PostgreSQL-Erreichbarkeit, freien Speicher und die passende pg_dump-Version serverseitig prüfen.';
  await removeDirectory(job.directory);await audit(job.owner,'backup.failed',job.id,{reason:error instanceof Error&&['dump_failed','timeout','empty','database_authentication','output_file','database_connection','client_version','database_missing','tool_missing','process_failed'].includes(error.message)?error.message:'dump_failed'}).catch(()=>{});
 }
}
function publicJob(job:Job){return{id:job.id,status:job.status,filename:job.filename,expires_at:new Date(job.expires_at).toISOString(),bytes:job.bytes,error:job.error};}
async function ownedJob(id:string,owner:string){await cleanupBackups();const job=jobs.get(id);if(!job||job.owner!==owner)fail('Backup nicht gefunden oder bereits abgelaufen.',404);return job;}
export async function backupStatus(id:string,owner:string){return publicJob(await ownedJob(id,owner));}
export async function downloadBackup(id:string,owner:string){
 const job=await ownedJob(id,owner);if(job.status!=='ready')fail('Backup ist noch nicht bereit oder wurde bereits heruntergeladen.',409);
 job.status='downloading';
 try{await audit(owner,'backup.download',job.id,{bytes:job.bytes});}
 catch(error){job.status='ready';throw error;}
 const stream=createReadStream(job.file);
 const remove=()=>{jobs.delete(job.id);void removeDirectory(job.directory).catch(()=>{});};
 stream.once('close',remove);stream.once('error',remove);
 return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+job.filename+'"','Content-Length':String(job.bytes),'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
}

scheduleCleanup();void cleanupBackups().catch(()=>{});

export async function safetyBackup(owner:string){
 const directory=path.resolve(/* turbopackIgnore: true */process.env.BACKUP_DIRECTORY||'./backups');await mkdir(directory,{recursive:true,mode:0o700});
 const id=randomUUID(),filename='before-restore-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump';
 const job:Job={id,owner,status:'running',filename,directory,file:path.join(directory,filename),expires_at:Date.now()+lifetime};
 // A separate temp directory keeps a failed dump from affecting retained safety backups.
 const started=await startBackup(owner);let pending=await ownedJob(started.id,owner);
 while(pending.status==='running'){await new Promise(resolve=>setTimeout(resolve,100));pending=await ownedJob(started.id,owner);}
 if(pending.status!=='ready')fail('Sicherheitsbackup fehlgeschlagen; Wiederherstellung abgebrochen.',503);
 const {copyFile}=await import('node:fs/promises');await copyFile(pending.file,job.file);await removeDirectory(pending.directory);jobs.delete(pending.id);
 await audit(owner,'restore.safety',id,{filename});return filename;
}
