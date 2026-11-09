import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createServer} from 'node:http';import {spawn} from 'node:child_process';
test('APP_DOMAIN bestimmt Proxy, HTTPS-App-URL und Issuer zur Laufzeit',()=>{
 const compose=JSON.parse(readFileSync('compose.server.yml','utf8'));
 for(const domain of ['alt.example.at','neu.example.at']){
  const resolve=(s:string)=>s.replace(/\$\{APP_DOMAIN:[^}]+\}/g,domain);
  assert.equal(resolve(compose.services.web.environment.APP_URL),'https://'+domain);assert.equal(resolve(compose.services.web.environment.OIDC_ISSUER),'https://'+domain+'/auth/realms/kundenraum');assert.equal(resolve(compose.services.keycloak.environment.KC_HOSTNAME),'https://'+domain+'/auth');assert.equal(resolve(compose.services.caddy.environment.APP_DOMAIN),domain);
 }
 assert.deepEqual(compose.services.caddy.ports,['80:80','443:443']);assert.ok(compose.services.caddy.volumes.includes('caddy-data:/data'));assert.equal(compose.services.db.ports,undefined);assert.equal(compose.services['identity-config'].command[1],'scripts/sync-domain.mjs');
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
 for(const domain of ['neu.example.at','noch-neuer.example.at']){
  const child=spawn(process.execPath,['scripts/sync-domain.mjs'],{env:{...process.env,APP_DOMAIN:domain,OIDC_INTERNAL_URL:root,KEYCLOAK_ADMIN_USER:'maintenance',KEYCLOAK_ADMIN_PASSWORD:'fixture-only'},stdio:'ignore',windowsHide:true});
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,0);
  assert.deepEqual(client.redirectUris,['https://'+domain+'/api/auth/callback']);assert.deepEqual(client.webOrigins,['https://'+domain]);assert.equal(client.attributes.preserve,'yes');assert.equal(realm.attributes.frontendUrl,'https://'+domain+'/auth');assert.equal(realm.attributes.preserve,'yes');
 }
 assert.equal(logout,2);
});
