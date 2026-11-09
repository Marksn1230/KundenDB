import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';
import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';
import {createServer} from 'node:http';import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';import {SignJWT,generateKeyPair,exportJWK} from 'jose';import {chromium} from 'playwright';
const execute=promisify(execFile);
const control=(bin:string,args:string[])=>new Promise<void>((resolve,reject)=>{const child=spawn(bin,args,{stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('PostgreSQL-Kontrollbefehl fehlgeschlagen.')));});
const binaryDir=process.env.TEST_PG_BIN||path.resolve('.runtime/postgres/pgsql/bin');
const executable=(name:string)=>path.join(binaryDir,name+(process.platform==='win32'?'.exe':''));
async function freePort(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const port=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return port;}
const caddyBinary=process.env.TEST_CADDY_BINARY||path.resolve('.runtime/caddy/caddy'+(process.platform==='win32'?'.exe':''));
const exists=existsSync(executable('pg_ctl'))&&existsSync(caddyBinary);
test('HTTPS/Caddy und echter PostgreSQL-Dump: Admin-Sessiondownload, Einmaligkeit, Audit, Ablauf und Restore in separate Datenbank',{skip:!exists?'TEST_PG_BIN oder lokale PostgreSQL-/Caddy-Testbinaries fehlen':false,timeout:180000},async t=>{
 const folder=mkdtempSync(path.join(tmpdir(),'kundenraum-backup-pg-')),data=path.join(folder,'cluster'),password=randomBytes(24).toString('hex'),pwfile=path.join(folder,'password');
 writeFileSync(pwfile,password,{mode:0o600});
 let testChild:ReturnType<typeof spawn>|undefined,testBrowser:Awaited<ReturnType<typeof chromium.launch>>|undefined,testRoot:Pool|undefined,testCaddy:ReturnType<typeof spawn>|undefined,closeDb:(()=>Promise<void>)|undefined;
 const port=await freePort(),url=(database:string)=>'postgresql://postgres:'+password+'@127.0.0.1:'+port+'/'+database;
 await execute(executable('initdb'),['-D',data,'-U','postgres','--auth=scram-sha-256','--pwfile',pwfile,'--encoding=UTF8','--locale=C'],{windowsHide:true});
 await control(executable('pg_ctl'),['-D',data,'-l',path.join(folder,'postgres.log'),'-o','-h 127.0.0.1 -p '+port,'-w','start']);
 t.after(async()=>{testChild?.kill();testCaddy?.kill();await testBrowser?.close();await closeDb?.();await testRoot?.end();await control(executable('pg_ctl'),['-D',data,'-w','-m','fast','stop']);const {rm}=await import('node:fs/promises');if(path.dirname(path.resolve(folder))!==path.resolve(tmpdir())||!path.basename(folder).startsWith('kundenraum-backup-pg-'))throw new Error('Ungültiger Testpfad.');await rm(folder,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
 const root=new Pool({connectionString:url('postgres')});testRoot=root;
 await root.query('CREATE DATABASE kundenraum_backup_source');await root.query('CREATE DATABASE kundenraum_backup_restore');
 process.env.DATABASE_URL=url('kundenraum_backup_source');process.env.PG_DUMP_PATH=executable('pg_dump');
 const {migrate,closeDatabase,all,transaction}=await import('../lib/db'),{createCustomer}=await import('../lib/customers');
 await migrate();await transaction(()=>createCustomer({name:'Backup Fiktiv',mac_address:'Backup.Account',mac_mode:'identifier',service_end:'2027-12-31',payment_status:'Bezahlt'},'fixture-admin',true));closeDb=closeDatabase;
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);Object.assign(jwk,{kid:'backup-fixture',alg:'RS256',use:'sig'});
 let issuer='',origin='',nextSubject='fixture-admin';const codes=new Map<string,{nonce:string;subject:string;challenge:string}>();let fixturePort=0;
 const fixture=createServer(async(req,res)=>{
  const u=new URL(req.url!,issuer||'http://localhost');res.setHeader('Content-Type','application/json');
  const send=(body:unknown)=>res.end(JSON.stringify(body));
  if(u.pathname.endsWith('openid-configuration'))return send({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',introspection_endpoint:issuer+'/introspect',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['client_secret_post']});
  if(u.pathname.endsWith('/jwks'))return send({keys:[jwk]});
  if(u.pathname.endsWith('/authorize')){const code=randomBytes(16).toString('hex');codes.set(code,{nonce:u.searchParams.get('nonce')!,subject:nextSubject,challenge:u.searchParams.get('code_challenge')!});const r=new URL(u.searchParams.get('redirect_uri')!);r.searchParams.set('code',code);r.searchParams.set('state',u.searchParams.get('state')!);r.searchParams.set('iss',issuer);res.writeHead(302,{Location:r.toString()});return res.end();}
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);const body=new URLSearchParams(Buffer.concat(chunks).toString());
  if(u.pathname.endsWith('/token')){const code=codes.get(body.get('code')!)!;codes.delete(body.get('code')!);const {createHash}=await import('node:crypto');if(!code||createHash('sha256').update(body.get('code_verifier')!).digest('base64url')!==code.challenge){res.statusCode=400;return send({error:'invalid_grant'});}
   const id=await new SignJWT({nonce:code.nonce,acr:'2'}).setProtectedHeader({alg:'RS256',kid:'backup-fixture'}).setIssuer(issuer).setSubject(code.subject).setAudience('fixture').setIssuedAt().setExpirationTime('15m').sign(privateKey);
   return send({access_token:code.subject,id_token:id,token_type:'Bearer',expires_in:900});}
  if(u.pathname.endsWith('/introspect')){const subject=body.get('token')||'';return send({active:subject.startsWith('fixture-'),sub:subject,preferred_username:subject,name:subject,iat:Math.floor(Date.now()/1000)-2,exp:Math.floor(Date.now()/1000)+900,iss:issuer,aud:'kundenraum-api',acr:'2',realm_access:{roles:[subject==='fixture-employee'?'mitarbeiter':'administrator']}});}
  res.statusCode=404;send({});
 });
 await new Promise<void>(r=>fixture.listen(0,'127.0.0.1',r));fixturePort=(fixture.address() as {port:number}).port;issuer='http://127.0.0.1:'+fixturePort+'/realms/fixture';t.after(()=>new Promise<void>(r=>fixture.close(()=>r())));
 const appPort=await freePort(),webPort=String(appPort),proxyPort=await freePort();origin='https://localhost:'+proxyPort;issuer=origin+'/auth/realms/fixture';
 const storage=path.join(folder,'caddy-storage'),config=path.join(folder,'Caddyfile');
 writeFileSync(config,'{\n admin off\n skip_install_trust\n auto_https disable_redirects\n storage file_system {\n root '+storage.replaceAll('\\','/')+'\n }\n}\n'+origin+' {\n bind 127.0.0.1\n tls internal\n handle /auth/* {\n reverse_proxy 127.0.0.1:'+fixturePort+'\n }\n handle {\n reverse_proxy 127.0.0.1:'+appPort+'\n }\n}\n');
 testCaddy=spawn(caddyBinary,['run','--config',config,'--adapter','caddyfile'],{stdio:'ignore',windowsHide:true});
 const caPath=path.join(storage,'pki/authorities/local/root.crt');for(let n=0;n<100&&!existsSync(caPath);n++)await new Promise(r=>setTimeout(r,50));
 const {request:httpsRequest}=await import('node:https');
 const secureFetch=(address:string,init:RequestInit={})=>new Promise<Response>((resolve,reject)=>{const request=httpsRequest(address,{method:init.method||'GET',headers:init.headers as Record<string,string>,ca:readFileSync(caPath),family:4},response=>{const chunks:Buffer[]=[];response.on('data',d=>chunks.push(d));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers as Record<string,string>})));});request.once('error',reject);if(init.body)request.write(String(init.body));request.end();});
 let serverLog='';
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',webPort],{env:{...process.env,DATABASE_URL:url('kundenraum_backup_source'),APP_URL:origin,OIDC_ISSUER:issuer,OIDC_INTERNAL_URL:'http://127.0.0.1:'+fixturePort+'/auth',OIDC_CLIENT_ID:'fixture',OIDC_CLIENT_SECRET:'only-fixture',OIDC_PROXY_ENABLED:'false',ALLOW_LOCAL_HTTP:'false',SESSION_ENCRYPTION_KEY:randomBytes(32).toString('hex')},stdio:['ignore','pipe','pipe'],windowsHide:true});testChild=child;child.stdout?.on('data',d=>serverLog+=d);child.stderr?.on('data',d=>serverLog+=d);
 for(let n=0;n<100;n++){try{if((await secureFetch(origin+'/api/v1/health')).ok)break;}catch{}if(n===99)throw new Error('Backup-Testserver nicht bereit');await new Promise(r=>setTimeout(r,100));}
 const browser=await chromium.launch({headless:true,executablePath:existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined});testBrowser=browser;
 const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage();await page.goto(origin);await page.getByRole('heading',{name:'Alles im Blick.'}).waitFor({timeout:8000}).catch(async()=>{throw new Error('Testlogin fehlgeschlagen: '+new URL(page.url()).pathname+' '+(await page.locator('body').innerText()).slice(-1500)+'\n'+serverLog);});
 const cookies=await context.cookies();assert.equal(cookies.find(c=>c.name==='kr_session')?.secure,true);assert.equal((await secureFetch(origin+'/api/v1/health')).status,200);const cookie=cookies.filter(c=>c.name==='kr_session').map(c=>c.name+'='+c.value).join(';');
 const me=await(await secureFetch(origin+'/api/v1/me',{headers:{cookie}})).json();
 const request=(resource:string,method='GET',body?:unknown)=>secureFetch(origin+'/api/v1/'+resource,{method,headers:{cookie,Origin:origin,'X-CSRF-Token':me.user.csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal((await secureFetch(origin+'/api/v1/backups')).status,401);
 assert.equal((await secureFetch(origin+'/api/v1/backups',{headers:{Authorization:'Bearer fixture-employee'}})).status,403);
 assert.equal((await secureFetch(origin+'/api/v1/backups',{headers:{Authorization:'Bearer fixture-admin'}})).status,403);
 const response=await request('backups','POST',{});assert.equal(response.status,202);const job=await response.json();assert.equal(JSON.stringify(job).includes(password),false);
 let status:any;for(let n=0;n<100;n++){status=await(await request('backups/'+job.id)).json();if(status.status!=='running')break;await new Promise(r=>setTimeout(r,100));}assert.equal(status.status,'ready',status.error+' '+JSON.stringify(await all("SELECT changes FROM audit_log WHERE action='backup.failed'")));
 nextSubject='fixture-other-admin';const otherContext=await browser.newContext({ignoreHTTPSErrors:true}),otherPage=await otherContext.newPage();await otherPage.goto(origin);await otherPage.getByRole('heading',{name:'Alles im Blick.'}).waitFor();
 assert.equal(await otherPage.evaluate(async id=>(await fetch('/api/v1/backups/'+id+'/download')).status,job.id),404);
 const download=await request('backups/'+job.id+'/download');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition')!,/kundenraum-.*\.dump/);const bytes=Buffer.from(await download.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'PGDMP');const dump=path.join(folder,'backup.dump');writeFileSync(dump,bytes);
 assert.equal((await request('backups/'+job.id+'/download')).status,404);
 await execute(executable('pg_restore'),['--dbname','kundenraum_backup_restore','--no-owner','--no-acl','--exit-on-error',dump],{env:{...process.env,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',PGPASSWORD:password},windowsHide:true});
 const restored=new Pool({connectionString:url('kundenraum_backup_restore')});try{const result=await restored.query('SELECT c.name,c.mac_address,p.payment_status FROM customers c JOIN periods p ON p.customer_id=c.id');assert.deepEqual(result.rows,[{name:'Backup Fiktiv',mac_address:'Backup.Account',payment_status:'Bezahlt'}]);}finally{await restored.end();}
 const audit=await all<{action:string}>("SELECT action FROM audit_log WHERE actor='fixture-admin' AND action LIKE 'backup.%'");assert.ok(audit.some(x=>x.action==='backup.create'));assert.ok(audit.some(x=>x.action==='backup.download'));
 await page.locator('.nav-link').filter({hasText:'Einstellungen'}).click();await page.getByRole('button',{name:'Datenbank-Backup',exact:true}).click();const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Backup erstellen und herunterladen',exact:true}).click();const uiDownload=await downloadEvent;assert.match(uiDownload.suggestedFilename(),/kundenraum-.*\.dump/);assert.equal(readFileSync((await uiDownload.path())!).subarray(0,5).toString(),'PGDMP');await page.getByText('Backup heruntergeladen. Die temporäre Serverdatei wurde entfernt.',{exact:true}).waitFor();await page.screenshot({path:'test-results/backup-admin-https.png',fullPage:true});
 const {startBackup,backupStatus,cleanupBackups}=await import('../lib/backups');const expiring=await startBackup('fixture-admin');for(let n=0;n<100;n++){if((await backupStatus(expiring.id,'fixture-admin')).status==='ready')break;await new Promise(r=>setTimeout(r,50));}await cleanupBackups(Date.now()+16*60000);await assert.rejects(()=>backupStatus(expiring.id,'fixture-admin'),/nicht gefunden/);
 process.env.PG_DUMP_PATH=path.join(folder,'missing-pg-dump');const failed=await startBackup('fixture-admin');await new Promise(r=>setTimeout(r,100));const failure=await backupStatus(failed.id,'fixture-admin');assert.equal(failure.status,'failed');assert.equal(JSON.stringify(failure).includes(password),false);await cleanupBackups(Date.now()+16*60000);
});
