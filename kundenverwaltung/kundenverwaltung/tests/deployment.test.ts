import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createServer} from 'node:http';import {spawn} from 'node:child_process';
test('APP_DOMAIN und HTTPS_ENABLED bestimmen gemeinsame Laufzeitwerte; Zertifikate bleiben persistent',async()=>{
 const {domainSettings}=await import('../scripts/domain-config.mjs'),compose=JSON.parse(readFileSync('compose.server.yml','utf8'));
 for(const domain of ['alt.example.at','neu.example.at'])for(const flag of ['true','false']){
  const settings=domainSettings({APP_DOMAIN:domain,HTTPS_ENABLED:flag,ACME_EMAIL:'admin@example.at'});
  assert.equal(settings.origin,(flag==='true'?'https://':'http://')+domain);assert.equal(compose.services.web.environment.HTTPS_ENABLED,'$'+'{HTTPS_ENABLED:-true}');assert.equal(compose.services.web.environment.APP_URL,undefined);assert.equal(compose.services.web.command[1],'deploy/start-web.sh');
 }
 assert.deepEqual(compose.services.caddy.ports,['80:80','443:443']);assert.ok(compose.services.caddy.volumes.includes('caddy-data:/data'));assert.equal(compose.services.db.ports,undefined);assert.equal(compose.services['identity-config'].command[1],'scripts/sync-domain.mjs');
 assert.match(readFileSync('deploy/Caddyfile','utf8'),/issuer acme/);assert.doesNotMatch(readFileSync('deploy/Caddyfile','utf8'),/zerossl|internal/);
});
test('Domain-Abgleich aktualisiert gespeicherten Keycloak-Callback, Origin und Frontend ohne Benutzer-/Schemaänderung',async t=>{
 let client:any={id:'web-id',clientId:'kundenraum-web',secret:'fixture-only',redirectUris:['https://alt.example.at/api/auth/callback'],webOrigins:['https://alt.example.at'],attributes:{preserve:'yes'}},realm:any={attributes:{preserve:'yes'}},logout=0;
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');const u=new URL(req.url!,'http://localhost'),parts:Buffer[]=[];for await(const c of req)parts.push(c);const raw=Buffer.concat(parts).toString();
  const send=(value:unknown)=>res.end(JSON.stringify(value));
  if(u.pathname.endsWith('openid-configuration'))return send({issuer:'test'});
  if(u.pathname.endsWith('/token'))return send({access_token:'maintenance-test'});
  if(req.headers.authorization!=='Bearer maintenance-test'){res.statusCode=401;return send({});}
  if(u.pathname.endsWith('/clients'))return send([{id:'web-id'}]);
  if(u.pathname.endsWith('/clients/web-id')){if(req.method==='PUT')client=JSON.parse(raw);return send(client);}
  if(u.pathname.endsWith('/logout-all')){logout++;return send({});}
  if(u.pathname.endsWith('/admin/realms/kundenraum')){if(req.method==='PUT')realm={...realm,...JSON.parse(raw)};return send(realm);}
  res.statusCode=404;send({});
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const root='http://127.0.0.1:'+(server.address() as {port:number}).port+'/auth';
 for(const [domain,flag] of [['neu.example.at','true'],['noch-neuer.example.at','true'],['plain.example.at','false']]){const expected=(flag==='true'?'https://':'http://')+domain;
  const child=spawn(process.execPath,['scripts/sync-domain.mjs'],{env:{...process.env,APP_DOMAIN:domain,HTTPS_ENABLED:flag,ACME_EMAIL:'admin@example.at',OIDC_INTERNAL_URL:root,KEYCLOAK_ADMIN_USER:'maintenance',KEYCLOAK_ADMIN_PASSWORD:'fixture-only'},stdio:'ignore',windowsHide:true});
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,0);
  assert.deepEqual(client.redirectUris,[expected+'/api/auth/callback']);assert.deepEqual(client.webOrigins,[expected]);assert.equal(client.attributes.preserve,'yes');assert.equal(realm.attributes.frontendUrl,expected+'/auth');assert.equal(realm.attributes.preserve,'yes');assert.equal(realm.sslRequired,flag==='true'?'external':'none');
 }
 assert.equal(logout,3);
});

test('Update eines laufenden Realms wartet auf Keycloak und bleibt bei Wiederholung ohne Benutzeränderungen sicher',{timeout:30000},async t=>{
 let attempts=0,logout=0,createdRoles=0,otpCreated=0,configCreated=0,configUpdated=0;
 const roles:any[]=[{name:'administrator'},{name:'mitarbeiter'}],clients:Record<string,any>={web:{id:'web',clientId:'kundenraum-web',attributes:{keep:'yes','client.session.idle.timeout':'120'}},ios:{id:'ios',clientId:'kundenraum-ios',attributes:{keep:'yes'}}};
 let realm:any={},required:any={alias:'CONFIGURE_TOTP',defaultAction:true,enabled:true};
 let executions:any[]=[{id:'password',providerId:'auth-username-password-form',requirement:'REQUIRED'},{id:'old-otp',providerId:'auth-otp-form',requirement:'REQUIRED'}];
 const configs:any[]=[];
 const server=createServer(async(req,res)=>{
  const u=new URL(req.url!,'http://localhost'),parts:Buffer[]=[];for await(const c of req)parts.push(c);const raw=Buffer.concat(parts).toString();res.setHeader('Content-Type','application/json');const send=(value:unknown,status=200)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  if(u.pathname.endsWith('/.well-known/openid-configuration')){attempts++;return send({},attempts<=2?503:200);}
  if(u.pathname.endsWith('/token')){const form=new URLSearchParams(raw);assert.equal(form.get('username'),'fixture-maint');assert.equal(form.get('password'),'fixture-maint-secret');return send({access_token:'fixture-policy'});}
  if(req.headers.authorization!=='Bearer fixture-policy')return send({},401);
  const r=u.pathname.slice('/auth/admin/realms/kundenraum'.length),data=raw?JSON.parse(raw):undefined;
  if(r===''&&req.method==='PUT'){realm={...realm,...data};return send({});}
  if(r==='/roles'){if(req.method==='POST'){createdRoles++;roles.push({id:'cashier',...data});}return send(roles);}
  if(r==='/roles/kassierer')return send(roles.find(x=>x.name==='kassierer'));
  if(r==='/clients')return send([{id:u.searchParams.get('clientId')==='kundenraum-web'?'web':'ios'}]);
  if(r==='/clients/web'||r==='/clients/ios'){const key=r.split('/').at(-1)!;if(req.method==='PUT')clients[key]=data;return send(clients[key]);}
  if(r==='/clients/web/scope-mappings/realm')return send({});
  if(r==='/authentication/flows/kundenraum-mfa/executions/execution'){otpCreated++;executions.push({id:'new-otp',providerId:data.provider,requirement:'DISABLED'});return send({});}
  if(r==='/authentication/flows/kundenraum-mfa/executions'){if(req.method==='PUT')executions=executions.map(e=>e.id===data.id?{...e,...data}:e);return send(executions);}
  if(r==='/authentication/executions/old-otp'&&req.method==='DELETE'){executions=executions.filter(e=>e.id!=='old-otp');return send({});}
  if(r==='/authentication/executions/new-otp/config'){configCreated++;configs.push(data);executions.find(e=>e.id==='new-otp').authenticationConfig='otp-config';return send({});}
  if(r==='/authentication/config/otp-config'){configUpdated++;configs.push(data);return send({});}
  if(r==='/authentication/required-actions')return send([required]);
  if(r==='/authentication/required-actions/CONFIGURE_TOTP'){required=data;return send({});}
  if(r==='/logout-all'){logout++;return send({});}
  return send({unexpected:r},404);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const root='http://127.0.0.1:'+(server.address() as {port:number}).port+'/auth/';
 for(let n=0;n<2;n++){
  let output='';const child=spawn(process.execPath,['scripts/sync-login-policy.mjs'],{env:{...process.env,OIDC_INTERNAL_URL:root,KEYCLOAK_ADMIN_USER:'fixture-maint',KEYCLOAK_ADMIN_PASSWORD:'fixture-maint-secret'},windowsHide:true,stdio:['ignore','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill();});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,0,output);assert.equal(output.includes('fixture-maint-secret'),false);
 }
 assert.ok(attempts>=4);assert.equal(createdRoles,1);assert.equal(otpCreated,1);assert.equal(configCreated,1);assert.equal(configUpdated,1);assert.equal(logout,2);
 assert.equal(realm.ssoSessionIdleTimeout,3600);assert.equal(realm.ssoSessionMaxLifespan,28800);assert.equal(realm.clientSessionIdleTimeout,3600);
 assert.ok(Object.values(clients).every(c=>c.attributes.keep==='yes'&&c.attributes['client.session.idle.timeout']==='3600'&&c.attributes['client.session.max.lifespan']==='28800'));
 assert.equal(executions.find(e=>e.id==='password').requirement,'REQUIRED');assert.equal(executions.find(e=>e.id==='new-otp').requirement,'REQUIRED');assert.equal(required.defaultAction,false);assert.ok(configs.every(c=>c.config.skipOtpRole==='kassierer'&&c.config.defaultOtpOutcome==='force'));
});
