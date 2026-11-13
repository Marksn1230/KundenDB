import {allowlistConfig} from '../lib/mfa-policy.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const shell=process.env.TEST_BASH||(process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash');
test('Gemeinsamer Shell-Start berechnet HTTP-/HTTPS-Origin und ausschließlich Let’s-Encrypt-CA',{skip:!existsSync(shell)?'Bash-Testbinary fehlt':false},()=>{
 for(const flag of ['true','false'])for(const environment of ['production','staging']){
  const output=execFileSync(shell,['-c','. ./deploy/domain-env.sh; printf "%s|%s" "$APP_URL" "$ACME_DIRECTORY"'],{encoding:'utf8',env:{...process.env,APP_DOMAIN:'kunden.example.at',HTTPS_ENABLED:flag,ACME_EMAIL:'admin@example.at',ACME_ENV:environment}});
  assert.equal(output,(flag==='true'?'https':'http')+'://kunden.example.at|https://'+(environment==='staging'?'acme-staging-v02':'acme-v02')+'.api.letsencrypt.org/directory');
 }
 execFileSync(shell,['-n','scripts/configure-domain.sh']);
});
const caddy=process.env.TEST_CADDY_BINARY||path.resolve('.runtime/caddy/caddy'+(process.platform==='win32'?'.exe':''));
test('Echte Caddy-Konfiguration: genau ein LE-Issuer, Staging-Verzeichnis und reiner HTTP-Modus',{skip:!existsSync(caddy)?'Caddy-Testbinary fehlt':false},()=>{
 for(const environment of ['production','staging']){
  const output=execFileSync(caddy,['adapt','--config',path.resolve('deploy/Caddyfile'),'--adapter','caddyfile'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,APP_DOMAIN:'kunden.example.at',ACME_EMAIL:'admin@example.at',ACME_DIRECTORY:'https://'+(environment==='staging'?'acme-staging-v02':'acme-v02')+'.api.letsencrypt.org/directory'}});
  const config=JSON.parse(output),issuers=config.apps.tls.automation.policies[0].issuers;assert.equal(issuers.length,1);assert.equal(issuers[0].module,'acme');assert.equal(issuers[0].ca,'https://'+(environment==='staging'?'acme-staging-v02':'acme-v02')+'.api.letsencrypt.org/directory');
 }
 const plain=JSON.parse(execFileSync(caddy,['adapt','--config',path.resolve('deploy/Caddyfile.http'),'--adapter','caddyfile'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,APP_DOMAIN:'kunden.example.at'}}));assert.equal(plain.apps.tls,undefined);assert.ok(Object.values(plain.apps.http.servers).some((s:any)=>s.listen.includes(':80')));
});

test('Einrichtungsablauf beendet sich bei DNS-/Abbruchfehler vor Containeränderungen und aktualisiert nur betroffene Dienste',{skip:!existsSync(shell)?'Bash-Testbinary fehlt':false},async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const asShell=(value:string)=>process.platform==='win32'?'/'+value[0].toLowerCase()+value.slice(2).replaceAll('\\','/'):value;
 for(const code of [1,2,0]){
  const folder=mkdtempSync(path.join(tmpdir(),'kundenraum-config-shell-')),bin=path.join(folder,'bin'),scripts=path.join(folder,'scripts'),log=path.join(folder,'docker.log');mkdirSync(bin);mkdirSync(scripts);copyFileSync('scripts/configure-domain.sh',path.join(scripts,'configure-domain.sh'));
  writeFileSync(path.join(bin,'docker'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_DOCKER_LOG"\nexit 0\n',{mode:0o755});
  writeFileSync(path.join(bin,'node'),'#!/bin/sh\nif [ "$1" = "-e" ] || [ "$2" = "--status" ] || [ "$2" = "--rollback-hint" ]; then exit 0; fi\nexit "$TEST_CONFIG_RESULT"\n',{mode:0o755});
  const {spawnSync}=await import('node:child_process');const result=spawnSync(shell,['-c','export PATH="$TEST_BIN:$PATH"; bash "$TEST_SCRIPT"'],{encoding:'utf8',windowsHide:true,env:{...process.env,TEST_BIN:asShell(bin),TEST_SCRIPT:asShell(path.join(scripts,'configure-domain.sh')),TEST_DOCKER_LOG:asShell(log),TEST_CONFIG_RESULT:String(code)}});
  assert.equal(result.status,code===1?1:0,result.stderr);
  const commands=readFileSync(log,'utf8');if(code!==0)assert.equal(commands.includes('force-recreate'),false);else{assert.ok(commands.includes('force-recreate keycloak'));assert.ok(commands.includes('force-recreate web caddy'));assert.equal(commands.includes('build'),false);assert.equal(commands.includes('migrate'),false);assert.equal(commands.includes('worker'),false);assert.equal(commands.includes(' up -d db'),false);}
 }
});

// Exercise the real Caddy router: syntax/adaptation checks alone do not detect
// a private-path response being reordered behind a terminal reverse proxy.
test('Caddy sperrt private Keycloak-Pfade vor dem Proxy und lässt Anmeldung sowie Anwendung durch',{skip:!existsSync(caddy)?'Caddy-Testbinary fehlt':false,timeout:30000},async t=>{
 const {createServer}=await import('node:http');
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {spawn}=await import('node:child_process');
 const folder=mkdtempSync(path.join(tmpdir(),'kundenraum-caddy-routing-'));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const upstream=createServer((req,res)=>{res.end('upstream:'+req.url);});
 await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise<void>(resolve=>upstream.close(()=>resolve())));
 const upstreamPort=(upstream.address() as {port:number}).port;
 const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 const routes=readFileSync('deploy/routes.caddy','utf8').replaceAll('172.30.93.3:8080','127.0.0.1:'+upstreamPort).replaceAll('web:3000','127.0.0.1:'+upstreamPort);
 mkdirSync(path.join(folder,'mfa'));writeFileSync(path.join(folder,'mfa/policy.caddy'),allowlistConfig([],'127.0.0.1:'+upstreamPort));writeFileSync(path.join(folder,'routes.caddy'),routes);writeFileSync(path.join(folder,'mfa-allowlist.caddy'),'# empty allowlist\n');
 writeFileSync(path.join(folder,'Caddyfile'),'{\n admin off\n auto_https off\n}\nhttp://127.0.0.1:'+port+' {\n import routes.caddy\n}\n');
 const child=spawn(caddy,['run','--config',path.join(folder,'Caddyfile'),'--adapter','caddyfile'],{windowsHide:true,stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}});
 const origin='http://127.0.0.1:'+port;
 for(let n=0;;n++){try{if((await fetch(origin,{signal:AbortSignal.timeout(500)})).ok)break;}catch{}if(n===100)throw new Error('Caddy-Testserver nicht bereit');await new Promise(r=>setTimeout(r,50));}
 for(const resource of ['/auth/admin','/auth/admin/','/auth/admin/realms/kundenraum','/auth/realms/master','/auth/realms/master/protocol/openid-connect/token']){
  const response=await fetch(origin+resource,{redirect:'manual'});assert.equal(response.status,404,resource);assert.doesNotMatch(await response.text(),/upstream:/);
 }
 for(const resource of ['/auth/realms/kundenraum/.well-known/openid-configuration','/auth/resources/login.css','/api/v1/health','/kunden']){
  const response=await fetch(origin+resource);assert.equal(response.status,200,resource);assert.equal(await response.text(),'upstream:'+resource);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 }
});
