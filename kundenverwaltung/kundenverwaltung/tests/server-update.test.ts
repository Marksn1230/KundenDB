import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';
import {execFile,execFileSync} from 'node:child_process';import {promisify} from 'node:util';
const execute=promisify(execFile),bash=process.env.TEST_BASH_BINARY||(process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash');
const script=path.resolve('scripts/update-server.sh');
const posix=(p:string)=>process.platform==='win32'?p.split(path.sep).join('/').replace(/^([A-Za-z]):/,(_,d)=>'/'+d.toLowerCase()):p;
function fixture(){
 const root=mkdtempSync(path.join(tmpdir(),'kundenraum-updater-')),app=path.join(root,'app'),tools=path.join(root,'tools');mkdirSync(app);mkdirSync(tools);
 const git=(...args:string[])=>execFileSync('git',args,{cwd:app,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
 git('init','--initial-branch=master');git('config','core.autocrlf','false');git('config','user.name','Update Test');git('config','user.email','update@example.invalid');
 writeFileSync(path.join(app,'.gitignore'),'.runtime/\nbackups/\n.env\n');writeFileSync(path.join(app,'compose.server.yml'),'{}\n');writeFileSync(path.join(app,'version.txt'),'old\n');writeFileSync(path.join(app,'.env'),'FIXTURE_SECRET=must-stay\n');git('add','.');git('commit','-m','old');const before=git('rev-parse','HEAD');
 git('switch','-c','candidate');writeFileSync(path.join(app,'version.txt'),'new\n');git('add','.');git('commit','-m','new');const target=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/master',target);git('remote','add','origin','https://example.invalid/fixture');git('switch','master');
 mkdirSync(path.join(app,'.runtime'));writeFileSync(path.join(app,'.runtime','server.override.yml'),'{}\n');
 const dockerFile=path.join(tools,'docker.mjs');
 writeFileSync(dockerFile,`import fs from 'node:fs';
const app=Buffer.from(process.env.MOCK_APP_BASE64,'base64').toString();const a=process.argv.slice(2),dir=process.env.MOCK_DIR;fs.appendFileSync(dir+'/calls.jsonl',JSON.stringify(a)+'\\n');
const out=s=>process.stdout.write(s+'\\n');
if(a[0]==='info')process.exit(0);
if(a[0]==='ps'){out('existing-web');process.exit(0);}
if(a[0]==='inspect'){const f=a[a.indexOf('--format')+1];if(f.includes('State.Running'))out('true');else if(f.includes('project.working_dir'))out(app);else if(f.includes('project.config_files'))out(app+'/compose.server.yml,'+app+'/.runtime/server.override.yml');else if(f.includes('project'))out('existing_custom_project');else if(f.includes('Config.Image'))out('kundenraum:old');else out('sha256:old-image');process.exit(0);}
if(a[0]==='image'){if(a[1]==='save')out('retained-image-content');process.exit(0);}
if(a[0]!=='compose')throw new Error('Unexpected docker operation');
const op=a.find((s,i)=>i>0&&['version','config','build','stop','exec','up','run','ps'].includes(s));
if(op==='version'){out('Docker Compose fixture');process.exit(0);}
if(op==='build'&&process.env.MOCK_BUILD_DELAY)await new Promise(r=>setTimeout(r,Number(process.env.MOCK_BUILD_DELAY)));
if(op==='up'&&a.includes('keycloak')&&fs.existsSync(dir+'/fail-infra')){fs.unlinkSync(dir+'/fail-infra');console.error('simulated infrastructure failure');process.exit(42);}
if(op==='run'&&a.includes('migrate')&&fs.existsSync(dir+'/fail-migration')){fs.unlinkSync(dir+'/fail-migration');console.error('simulated migration failure');process.exit(44);}
if(op==='run'&&a.includes('identity-policy')&&fs.existsSync(dir+'/fail-policy')){fs.unlinkSync(dir+'/fail-policy');console.error('simulated identity failure');process.exit(43);}
if(op==='exec'){
 if(a.includes('printenv'))out(a.includes('identity-db')?'identity_existing':'customers_existing');
 else if(a.includes('pg_dump'))out('PGDMP fixture backup');
 else if(a.includes('pg_restore'))out('; fixture archive readable');
 else if(a.includes('psql'))out('17\\n28');
 else if(a.includes('node'))out('200 {"status":"ok"}');
 else throw new Error('Unexpected exec');
}
`);
 writeFileSync(path.join(tools,'docker'),'#!/usr/bin/env bash\nexec "$MOCK_NODE" "$MOCK_DOCKER_JS" "$@"\n');
 writeFileSync(path.join(tools,'df'),'#!/usr/bin/env bash\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 999999999 0 %s 0%% /\\n" "${MOCK_FREE_KB:-99999999}"\n');
 chmodSync(path.join(tools,'docker'),0o755);chmodSync(path.join(tools,'df'),0o755);
 const env={...process.env,SUDO_USER:'',MOCK_DIR:root,MOCK_APP_BASE64:Buffer.from(execFileSync(bash,['-c','pwd -P'],{cwd:app,encoding:'utf8',windowsHide:true}).trim()).toString('base64'),MOCK_TOOLS:posix(tools),MOCK_NODE:process.execPath.split(path.sep).join('/'),MOCK_DOCKER_JS:dockerFile.split(path.sep).join('/'),MOCK_SCRIPT:posix(script)};
 async function shell(code:string,extra:Record<string,string>={}){try{return{code:0,...await execute(bash,['-c','export PATH="$MOCK_TOOLS:$PATH"; '+code],{cwd:app,env:{...env,...extra},windowsHide:true,timeout:40000,maxBuffer:2*1024*1024})};}catch(e:any){if(e.killed)throw e;return{code:e.code,stdout:String(e.stdout||''),stderr:String(e.stderr||'')};}}
 const state=()=>readFileSync(path.join(app,'.runtime','server-update','current'),'utf8').trim();
 const nativeState=()=>path.join(app,'backups',path.posix.basename(state()));
 const calls=()=>existsSync(path.join(root,'calls.jsonl'))?readFileSync(path.join(root,'calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s) as string[]):[];
 return{root,app,before,target,shell,state:nativeState,calls,git};
}
const options={skip:!existsSync(bash)?'Bash fehlt':false,timeout:90000};
test('Update-Skript: Shell bleibt bei Fehler offen; vorhandenes Projekt, Datenbanksicherungen und Fortschritt überstehen zwei neue Sitzungen',options,async()=>{
 const f=fixture();writeFileSync(path.join(f.root,'fail-infra'),'1');writeFileSync(path.join(f.root,'fail-policy'),'1');
 const first=await f.shell('bash "$MOCK_SCRIPT" run; result=$?; printf "PARENT_ALIVE:%s\\n" "$result"; exit 0');assert.equal(first.code,0,first.stderr);assert.match(first.stdout,/PARENT_ALIVE:42/);
 const state=f.state();assert.equal(readFileSync(path.join(state,'status'),'utf8').trim(),'failed');assert.equal(readFileSync(path.join(state,'phase'),'utf8').trim(),'06-databases');assert.equal(f.git('rev-parse','HEAD'),f.target);assert.equal(readFileSync(path.join(f.app,'.env'),'utf8'),'FIXTURE_SECRET=must-stay\n');const dump=readFileSync(path.join(state,'db.dump'));
 const status=await f.shell('bash "$MOCK_SCRIPT" status');assert.equal(status.code,0,status.stderr);assert.match(status.stdout,/06-databases/);
 const second=await f.shell('bash "$MOCK_SCRIPT" resume; result=$?; printf "SECOND_SHELL_ALIVE:%s\\n" "$result"; exit 0');assert.equal(second.code,0,second.stderr);assert.match(second.stdout,/SECOND_SHELL_ALIVE:43/);assert.equal(readFileSync(path.join(state,'phase'),'utf8').trim(),'08-keycloak');
 const third=await f.shell('bash "$MOCK_SCRIPT" resume');assert.equal(third.code,0,third.stdout+'\n'+third.stderr);assert.equal(readFileSync(path.join(state,'status'),'utf8').trim(),'complete');assert.deepEqual(readFileSync(path.join(state,'db.dump')),dump);assert.equal(readFileSync(path.join(state,'before'),'utf8').trim(),f.before);
 const calls=f.calls();assert.equal(calls.filter(a=>a.includes('pg_dump')).length,2);assert.equal(calls.filter(a=>a.includes('run')&&a.includes('migrate')).length,1);assert.equal(calls.filter(a=>a.includes('run')&&a.includes('identity-policy')).length,2);assert.ok(calls.filter(a=>a[0]==='compose'&&!a.includes('version')).every(a=>a.includes('existing_custom_project')&&a.some(s=>s.includes('server.override.yml'))));
 assert.ok(calls.every(a=>!a.some(s=>['down','prune','dropdb','systemctl'].includes(s))));
});
test('Update-Skript: Vorprüfung stoppt bei Platzmangel vor Docker-/Dienständerungen und source verändert keine SSH-Shelloptionen',options,async()=>{
 const f=fixture();const low=await f.shell('bash "$MOCK_SCRIPT" check; printf "SSH_OPEN\\n"',{MOCK_FREE_KB:'100'});assert.match(low.stdout,/SSH_OPEN/);assert.match(low.stdout,/freier Speicher/);assert.equal(f.calls().length,0);
 const sourced=await f.shell('before=$-; source "$MOCK_SCRIPT"; test "$before" = "$-"; printf "OPTIONS_UNCHANGED\\n"');assert.equal(sourced.code,0);assert.match(sourced.stdout,/OPTIONS_UNCHANGED/);assert.match(sourced.stderr,/nicht mit source/);
});
test('Update-Skript: nohup-Lauf setzt nach HUP der ursprünglichen Shell selbstständig fort',options,async()=>{
 const f=fixture();await f.shell('nohup bash "$MOCK_SCRIPT" run > .runtime/launch.log 2>&1 < /dev/null & sleep 0.2; kill -HUP "$$"',{MOCK_BUILD_DELAY:'1200'});
 let complete=false;for(let n=0;n<240;n++){try{if(readFileSync(path.join(f.state(),'status'),'utf8').trim()==='complete'){complete=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal(complete,true,readFileSync(path.join(f.app,'.runtime','launch.log'),'utf8'));const status=await f.shell('bash "$MOCK_SCRIPT" status');assert.equal(status.code,0);assert.match(status.stdout,/Status: complete/);
});

test('Update-Skript: Fehler genau bei run --rm migrate schließt die Eltern-Shell nicht; resume bewahrt die ursprünglichen Backups',options,async()=>{
 const f=fixture();writeFileSync(path.join(f.root,'fail-migration'),'1');
 const first=await f.shell('bash "$MOCK_SCRIPT" run; result=$?; printf "MIGRATION_PARENT_ALIVE:%s\\n" "$result"; exit 0');assert.equal(first.code,0,first.stderr);assert.match(first.stdout,/MIGRATION_PARENT_ALIVE:44/);
 const state=f.state();assert.equal(readFileSync(path.join(state,'phase'),'utf8').trim(),'07-migration');const dump=readFileSync(path.join(state,'db.dump'));
 const resumed=await f.shell('bash "$MOCK_SCRIPT" resume');assert.equal(resumed.code,0,resumed.stdout+resumed.stderr);assert.equal(readFileSync(path.join(state,'status'),'utf8').trim(),'complete');assert.deepEqual(readFileSync(path.join(state,'db.dump')),dump);
 assert.equal(f.calls().filter(a=>a.includes('pg_dump')).length,2);assert.equal(f.calls().filter(a=>a.includes('run')&&a.includes('migrate')).length,2);
});
