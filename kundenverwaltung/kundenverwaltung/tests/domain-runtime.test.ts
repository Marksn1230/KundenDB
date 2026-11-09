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
