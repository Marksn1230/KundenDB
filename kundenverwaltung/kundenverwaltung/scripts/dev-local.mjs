import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync,openSync,closeSync,createReadStream,createWriteStream,cpSync} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const root=process.cwd(),runtime=path.join(root,'.runtime');
if(process.platform!=='win32')throw new Error('Dieser portable Starter ist für Windows. Unter Linux bitte Docker Compose verwenden.');
mkdirSync(runtime,{recursive:true});
if(!existsSync('.env'))throw new Error('Bitte zuerst npm run setup ausführen.');
const config={};for(const line of readFileSync('.env','utf8').split(/\r?\n/)){const match=line.match(/^([A-Z_]+)=(.*)$/);if(match)config[match[1]]=match[2].trim();}
if(config.APP_URL!=='http://localhost:3000')throw new Error('dev:full ist ausschließlich für http://localhost:3000 vorgesehen.');
const publicIdentityChanged=config.OIDC_ISSUER!=='http://localhost:3000/auth/realms/kundenraum';
if(publicIdentityChanged&&!existsSync('.env.before-integrated-login'))writeFileSync('.env.before-integrated-login',readFileSync('.env'),{mode:0o600});
Object.assign(config,{OIDC_ISSUER:'http://localhost:3000/auth/realms/kundenraum',OIDC_INTERNAL_URL:'http://127.0.0.1:8080/auth',OIDC_ADMIN_URL:'http://127.0.0.1:8080/auth/admin/realms/kundenraum',OIDC_PROXY_ENABLED:'true'});
let envText=readFileSync('.env','utf8');for(const key of ['OIDC_ISSUER','OIDC_INTERNAL_URL','OIDC_ADMIN_URL','OIDC_PROXY_ENABLED']){const expression=new RegExp('^'+key+'=.*$','m');envText=expression.test(envText)?envText.replace(expression,key+'='+config[key]):envText+'\n'+key+'='+config[key];}writeFileSync('.env',envText,{mode:0o600});
const identityRoot=config.OIDC_INTERNAL_URL,internalDiscovery=identityRoot+'/realms/kundenraum/.well-known/openid-configuration';
const env={...process.env,...config,NODE_ENV:'development'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function request(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('HTTP '+r.status+' bei '+new URL(url).pathname);return r;}
async function json(url,options){return (await request(url,options)).json();}
async function healthy(url){try{return (await fetch(url,{signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}}
async function ready(url,seconds){for(let i=0;i<seconds;i++){if(await healthy(url))return;await delay(1000);}throw new Error('Dienst startet nicht: '+url+'. Logs in .runtime prüfen.');}
const hash=async(file,algorithm='sha256')=>{const h=createHash(algorithm);for await(const part of createReadStream(file))h.update(part);return h.digest('hex');};
async function download(url,file,checksum){if(!url.startsWith('https://github.com/'))throw new Error('Unerwartete Downloadquelle.');
  if(existsSync(file)&&await hash(file)===checksum)return;
  console.log('Lade '+path.basename(file)+' …');const response=await request(url);
  let bytes=0,last=Date.now();const total=Number(response.headers.get('content-length'))||0;
  const source=Readable.fromWeb(response.body);source.on('data',chunk=>{bytes+=chunk.length;if(Date.now()-last>10000){console.log('Download: '+Math.round(bytes/1048576)+' MB'+(total?' / '+Math.round(total/1048576)+' MB':''));last=Date.now();}});
  await pipeline(source,createWriteStream(file));if(await hash(file)!==checksum)throw new Error('SHA-256-Prüfung fehlgeschlagen: '+path.basename(file));
}
async function extract(archive,destination){mkdirSync(destination,{recursive:true});console.log('Entpacke '+path.basename(archive)+' …');await new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/expand-local-runtime.ps1'),'-Archive',archive,'-Destination',destination],{windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Entpacken fehlgeschlagen.')));});}
const installationFile=path.join(runtime,'installations.json');
let installation=existsSync(installationFile)?JSON.parse(readFileSync(installationFile,'utf8')):{};
if(!installation.javaHome||!existsSync(path.join(installation.javaHome,'bin/java.exe'))){
  const releases=await json('https://api.adoptium.net/v3/assets/latest/25/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse');
  const pkg=releases[0]?.binary?.package;if(!pkg?.checksum||!pkg?.link?.startsWith('https://github.com/adoptium/'))throw new Error('Keine verifizierbare Java-Distribution gefunden.');
  const archive=path.join(runtime,pkg.name),destination=path.join(runtime,'java');await download(pkg.link,archive,pkg.checksum);await extract(archive,destination);
  installation.javaHome=path.join(destination,readdirSync(destination).find(name=>existsSync(path.join(destination,name,'bin/java.exe'))));
}
if(!installation.keycloakHome||!existsSync(path.join(installation.keycloakHome,'bin/kc.bat'))){
  const release=await json('https://api.github.com/repos/keycloak/keycloak/releases/latest',{headers:{Accept:'application/vnd.github+json','User-Agent':'kundenraum-local-dev'}});
  if(!/^26\.\d+\.\d+$/.test(release.tag_name))throw new Error('Neue Keycloak-Hauptversion bitte vor Installation prüfen.');
  const asset=release.assets.find(a=>a.name==='keycloak-'+release.tag_name+'.zip');
  if(!asset?.digest?.startsWith('sha256:')||!asset.browser_download_url.startsWith('https://github.com/keycloak/keycloak/'))throw new Error('Keine verifizierbare Keycloak-Distribution gefunden.');
  const archive=path.join(runtime,asset.name),destination=path.join(runtime,'identity');await download(asset.browser_download_url,archive,asset.digest.slice(7));await extract(archive,destination);
  installation.keycloakHome=path.join(destination,'keycloak-'+release.tag_name);installation.keycloakVersion=release.tag_name;
}
writeFileSync(installationFile,JSON.stringify(installation,null,2));
const processFile=path.join(runtime,'processes.json');const processes=existsSync(processFile)?JSON.parse(readFileSync(processFile,'utf8')):{};
function launch(name,command,args,extraEnv={},cwd=root){const log=openSync(path.join(runtime,name+'.log'),'a');const child=spawn(command,args,{cwd,env:{...env,...extraEnv},detached:true,windowsHide:true,stdio:['ignore',log,log]});child.on('error',e=>console.error(name+': '+e.name));child.unref();closeSync(log);processes[name]={pid:child.pid,started_at:new Date().toISOString()};writeFileSync(processFile,JSON.stringify(processes,null,2));console.log(name+' gestartet (PID '+child.pid+').');return child;}
if(publicIdentityChanged&&processes.keycloak?.pid){await new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/stop-local-identity.ps1'),'-ProcessIdToStop',String(processes.keycloak.pid),'-ExpectedRoot',installation.keycloakHome],{windowsHide:true,stdio:'inherit'});child.on('exit',code=>code===0?resolve():reject(new Error('Alte lokale Identitätslaufzeit konnte nicht angehalten werden.')));});}
if(!await healthy(internalDiscovery)){
  const realm=JSON.parse(readFileSync('keycloak/kundenraum-realm.json','utf8'));
  // Only the isolated local H2 development realm omits email delivery; password and OTP stay mandatory.
  realm.verifyEmail=false;realm.requiredActions=realm.requiredActions.map(a=>a.alias==='VERIFY_EMAIL'?{...a,defaultAction:false}:a);
  cpSync(path.join(root,'keycloak/theme/kundenraum'),path.join(installation.keycloakHome,'themes/kundenraum'),{recursive:true});
  const importDir=path.join(installation.keycloakHome,'data/import');mkdirSync(importDir,{recursive:true});writeFileSync(path.join(importDir,'kundenraum-realm.json'),JSON.stringify(realm,null,2));
  const kc=path.join(installation.keycloakHome,'bin/kc.bat');
  const java=path.join(installation.javaHome,'bin/java.exe');
  const javaArgs=['-Xms64m','-Xmx512m','-XX:MaxMetaspaceSize=256m','-Dfile.encoding=UTF-8','-Dsun.stdout.encoding=UTF-8','-Dsun.err.encoding=UTF-8','-Duser.language=en','-Duser.country=US',
    '--add-opens=java.base/java.util=ALL-UNNAMED','--add-opens=java.base/java.util.concurrent=ALL-UNNAMED','--add-opens=java.base/java.security=ALL-UNNAMED','--add-opens=java.base/java.lang=ALL-UNNAMED','--enable-native-access=ALL-UNNAMED',
    '-Djava.util.concurrent.ForkJoinPool.common.threadFactory=io.quarkus.bootstrap.forkjoin.QuarkusForkJoinWorkerThreadFactory','-Djava.util.logging.manager=org.jboss.logmanager.LogManager','-Dquarkus-log-max-startup-records=10000','-Dpicocli.disable.closures=true',
    '-Dkc.home.dir='+installation.keycloakHome.replaceAll('\\','/'),'-Djboss.server.config.dir='+path.join(installation.keycloakHome,'conf'),'-Dkeycloak.theme.dir='+path.join(installation.keycloakHome,'themes'),
    '-cp',path.join(installation.keycloakHome,'lib/quarkus-run.jar'),'io.quarkus.bootstrap.runner.QuarkusEntryPoint','start-dev','--http-host=127.0.0.1','--http-port=8080','--hostname=http://localhost:3000/auth','--http-relative-path=/auth','--import-realm'];
  const javaEnv={JAVA_HOME:installation.javaHome,KC_BOOTSTRAP_ADMIN_USERNAME:config.KEYCLOAK_ADMIN_USER,KC_BOOTSTRAP_ADMIN_PASSWORD:config.KEYCLOAK_ADMIN_PASSWORD};
  const child=launch('keycloak',java,javaArgs,javaEnv,installation.keycloakHome);
  child.on('exit',code=>{if(code===10)launch('keycloak',java,['-Dkc.config.built=true',...javaArgs],javaEnv,installation.keycloakHome);});
  console.log('Warte auf den echten lokalen Anmeldedienst …');await ready(internalDiscovery,180);
}
const token=await json(identityRoot+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:config.KEYCLOAK_ADMIN_USER,password:config.KEYCLOAK_ADMIN_PASSWORD})});
const admin=async(resource,method='GET',body)=>request(config.OIDC_ADMIN_URL+resource,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
// Keep API and introspecting-client audiences as separate mappers (Keycloak chooses one target per mapper).
for(const clientId of ['kundenraum-web','kundenraum-ios']){
  const clients=await(await admin('/clients?clientId='+encodeURIComponent(clientId))).json();if(!clients.length)continue;
  const client=clients[0],mappers=await(await admin('/clients/'+client.id+'/protocol-mappers/models')).json();
  const api=mappers.find(m=>m.name==='api-audience');
  if(api?.config['included.client.audience']){delete api.config['included.client.audience'];await admin('/clients/'+client.id+'/protocol-mappers/models/'+api.id,'PUT',api);}
  if(!mappers.some(m=>m.name==='introspection-audience'))await admin('/clients/'+client.id+'/protocol-mappers/models','POST',{name:'introspection-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.client.audience':'kundenraum-web','access.token.claim':'true','id.token.claim':'false','introspection.token.claim':'true'}});
}
const availableScopes=await(await admin('/client-scopes')).json();
const basicScope=availableScopes.find(scope=>scope.name==='basic');
if(!basicScope)throw new Error('Keycloak basic-Clientscope mit sub-Claim fehlt.');
for(const clientId of ['kundenraum-web','kundenraum-ios']){
  const client=(await(await admin('/clients?clientId='+encodeURIComponent(clientId))).json())[0];if(!client)continue;
  const scopes=await(await admin('/clients/'+client.id+'/default-client-scopes')).json();
  if(!scopes.some(scope=>scope.id===basicScope.id))await admin('/clients/'+client.id+'/default-client-scopes/'+basicScope.id,'PUT');
}
const webClient=(await(await admin('/clients?clientId=kundenraum-web')).json())[0];
const webMappers=await(await admin('/clients/'+webClient.id+'/protocol-mappers/models')).json();
if(!webMappers.some(mapper=>mapper.name==='management-audience'))await admin('/clients/'+webClient.id+'/protocol-mappers/models','POST',{name:'management-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-resolve-mapper',config:{'access.token.claim':'true','introspection.token.claim':'true'}});
const managementScope=(await(await admin('/client-scopes')).json()).find(scope=>scope.name==='kc-admin-api');
if(!managementScope)throw new Error('Keycloak kc-admin-api-Clientscope fehlt; Keycloak 26.8.2 oder neuer verwenden.');
const optionalScopes=await(await admin('/clients/'+webClient.id+'/optional-client-scopes')).json();
if(!optionalScopes.some(scope=>scope.id===managementScope.id))await admin('/clients/'+webClient.id+'/optional-client-scopes/'+managementScope.id,'PUT');
await admin('','PUT',{loginTheme:'kundenraum',verifyEmail:false});
const userProfile=await(await admin('/users/profile')).json();
for(const attribute of userProfile.attributes)if(['email','firstName','lastName'].includes(attribute.name))delete attribute.required;
await admin('/users/profile','PUT',userProfile);
const username=config.LOCAL_DEV_USERNAME||'maki';
const users=await (await admin('/users?exact=true&username='+encodeURIComponent(username))).json();
if(!users.length){const password=randomBytes(24).toString('base64url');await admin('/users','POST',{username,firstName:'Maki',lastName:'Lokaler Test',email:username+'@localhost.invalid',emailVerified:false,enabled:true,requiredActions:['UPDATE_PASSWORD','CONFIGURE_TOTP'],credentials:[{type:'password',value:password,temporary:true}]});
  const created=(await (await admin('/users?exact=true&username='+encodeURIComponent(username))).json())[0];const role=await (await admin('/roles/administrator')).json();await admin('/users/'+created.id+'/role-mappings/realm','POST',[role]);
  writeFileSync(path.join(runtime,'dev-access.txt'),'Kundenraum – persönlicher lokaler Erstzugang\n\nURL: http://localhost:3000\nBenutzername: '+username+'\nTemporäres Passwort: '+password+'\n\nBeim ersten Login eigenes Passwort wählen und Authenticator einrichten.\nNur für diese lokale Entwicklungsumgebung. Nicht weitergeben oder committen.\n',{mode:0o600});
  console.log('Persönlicher Erstzugang angelegt. Temporäres Passwort: .runtime/dev-access.txt (wird nicht protokolliert).');
}else console.log('Vorhandenes persönliches Login-Konto unverändert beibehalten: '+username);
if(!await healthy(config.APP_URL+'/api/v1/me')){launch('web',process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3000'],{NEXT_DIST_DIR:'.next-dev'});await ready(config.APP_URL+'/api/v1/me',90);}
let workerAlive=false;try{if(processes.worker?.pid){process.kill(processes.worker.pid,0);workerAlive=true;}}catch{}
if(!workerAlive)launch('worker',process.execPath,['--import','tsx','scripts/worker.ts']);
console.log('BEREIT: http://localhost:3000 · Anmeldung: http://localhost:3000/auth · Worker gestartet.');
