import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {SignJWT,generateKeyPair,exportJWK} from 'jose';
import {chromium} from 'playwright';
import SwaggerParser from '@apidevtools/swagger-parser';
import {DatabaseSync} from 'node:sqlite';
import {addDays,today} from '../lib/domain';

async function listen(server:Server){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return (server.address() as {port:number}).port;}
test('REST, OIDC/PKCE, Rollen, CSRF, widerrufbare Sitzungen und responsive Browserabläufe', {timeout:120000},async t=>{
  if(!existsSync(path.join(process.env.NEXT_DIST_DIR||'.next','BUILD_ID')))throw new Error('Vor dem HTTP-Test npm run build ausführen.');
  const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);Object.assign(jwk,{kid:'fixture-key',alg:'RS256',use:'sig'});
  let issuer='',origin='',tokenDiagnostic='';const codes=new Map<string,{nonce:string;challenge:string;redirect:string}>();
  let discoveryUnavailable=true;
  const identityUsers=new Map<string,any>();const identityOperations:any[]=[];
  const iat=Math.floor(Date.now()/1000);
  const fixture=createServer(async(req,res)=>{
    const url=new URL(req.url!,issuer||'http://localhost');res.setHeader('Content-Type','application/json');
    const send=(body:unknown,status=200)=>{res.statusCode=status;res.end(JSON.stringify(body));};
    if(url.pathname.endsWith('/.well-known/openid-configuration')&&discoveryUnavailable)return send({error:'temporarily_unavailable'},503);
    if(url.pathname.endsWith('/.well-known/openid-configuration'))return send({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',introspection_endpoint:issuer+'/introspect',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['client_secret_post']});
    if(url.pathname.endsWith('/jwks'))return send({keys:[jwk]});
    if(url.pathname.endsWith('/authorize')){
      assert.equal(url.searchParams.get('code_challenge_method'),'S256');
      const code=randomBytes(16).toString('hex');codes.set(code,{nonce:url.searchParams.get('nonce')!,challenge:url.searchParams.get('code_challenge')!,redirect:url.searchParams.get('redirect_uri')!});
      const redirect=new URL(url.searchParams.get('redirect_uri')!);redirect.searchParams.set('state',url.searchParams.get('state')!);redirect.searchParams.set('code',code);redirect.searchParams.set('iss',issuer);res.writeHead(302,{Location:redirect.toString()});res.end();return;
    }
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const rawBody=Buffer.concat(chunks).toString();const body=new URLSearchParams(rawBody);
    if(url.pathname.startsWith('/admin/realms/kundenraum')){
      if(req.headers.authorization!=='Bearer fixture-management')return send({error:'unauthorized'},401);
      const resource=url.pathname.slice('/admin/realms/kundenraum'.length),data=rawBody?JSON.parse(rawBody):undefined;
      if(resource.startsWith('/roles/')&&req.method==='GET')return send({id:resource.split('/').pop(),name:resource.split('/').pop()});
      if(resource==='/users'&&req.method==='POST'){
        if([...identityUsers.values()].some(u=>u.username===data.username))return send({error:'conflict'},409);
        const id='managed-'+randomBytes(8).toString('hex');identityUsers.set(id,{...data,id});identityOperations.push({action:'create',subject:id,temporary:data.credentials[0].temporary,required_actions:data.requiredActions});
        res.setHeader('Location',issuer.split('/realms/')[0]+'/admin/realms/kundenraum/users/'+id);return send({},201);
      }
      const match=resource.match(/^\/users\/([^/]+)(.*)$/);
      if(match){const id=match[1],suffix=match[2],user=identityUsers.get(id);if(!user)return send({error:'not_found'},404);
        if(suffix==='/reset-password'&&req.method==='PUT'){identityOperations.push({action:'reset',subject:id,temporary:data.temporary});user.credentials=[data];return send({},204);}
        if(suffix==='/logout'){identityOperations.push({action:'logout',subject:id});return send({},204);}
        if(suffix==='/role-mappings/realm'){identityOperations.push({action:'role',subject:id});return send({},204);}
        if(suffix===''&&req.method==='PUT'){Object.assign(user,data);return send({},204);}
      }
      return send({error:'not_found'},404);
    }

    if(url.pathname.endsWith('/token')&&body.get('grant_type')==='client_credentials')return send({access_token:'fixture-management',token_type:'Bearer',expires_in:300});
    if(url.pathname.endsWith('/token')){
      const code=codes.get(body.get('code')||'');codes.delete(body.get('code')||'');
      if(!code||body.get('client_secret')!=='fixture-client-secret'||createHash('sha256').update(body.get('code_verifier')||'').digest('base64url')!==code.challenge||body.get('redirect_uri')!==code.redirect){tokenDiagnostic=JSON.stringify({code_found:!!code,secret_match:body.get('client_secret')==='fixture-client-secret',pkce_match:!!code&&createHash('sha256').update(body.get('code_verifier')||'').digest('base64url')===code.challenge,redirect_match:body.get('redirect_uri')===code?.redirect});return send({error:'invalid_grant'},400);}
      const idToken=await new SignJWT({nonce:code.nonce,acr:'2'}).setProtectedHeader({alg:'RS256',kid:'fixture-key'}).setIssuer(issuer).setSubject('fixture-admin').setAudience('fixture-client').setIssuedAt().setExpirationTime('15m').sign(privateKey);
      return send({access_token:'fixture-admin',token_type:'Bearer',expires_in:900,id_token:idToken});
    }
    if(url.pathname.endsWith('/introspect')){
      const token=body.get('token')||'';if(!['fixture-admin','fixture-employee','fixture-no-mfa','fixture-wrong-aud'].includes(token))return send({active:false});
      return send({active:true,sub:token==='fixture-employee'?'fixture-employee':'fixture-admin',preferred_username:token==='fixture-employee'?'mitarbeiter@example.invalid':'admin@example.invalid',name:token==='fixture-employee'?'Demo Mitarbeiter':'Demo Administrator',iat,exp:iat+3600,iss:issuer,aud:token==='fixture-wrong-aud'?'other-api':'kundenraum-api',acr:token==='fixture-no-mfa'?'1':'2',realm_access:{roles:[token==='fixture-employee'?'mitarbeiter':'administrator']}});
    }
    return send({error:'not_found'},404);
  });
  issuer='http://127.0.0.1:'+await listen(fixture)+'/realms/fixture';
  const portServer=createServer();const port=await listen(portServer);await new Promise<void>(resolve=>portServer.close(()=>resolve()));origin='http://127.0.0.1:'+port;
  const dir=mkdtempSync(path.join(tmpdir(),'kundenraum-api-')),database=path.join(dir,'test.sqlite');
  let serverLog='';
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,APP_URL:origin,DATABASE_PATH:database,OIDC_ISSUER:issuer,OIDC_CLIENT_ID:'fixture-client',OIDC_CLIENT_SECRET:'fixture-client-secret',SESSION_ENCRYPTION_KEY:randomBytes(32).toString('hex'),ALLOW_LOCAL_HTTP:'true',OIDC_INTERNAL_URL:'',DATABASE_URL:'',OIDC_PROXY_ENABLED:'false',OIDC_ADMIN_URL:issuer.split('/realms/')[0]+'/admin/realms/kundenraum'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',d=>serverLog+=d);child.stderr.on('data',d=>serverLog+=d);
  t.after(async()=>{child.kill();await new Promise<void>(resolve=>fixture.close(()=>resolve()));});
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/v1/me')).ok)break;}catch{}if(i===99)throw new Error('Server nicht bereit: '+serverLog);await new Promise(r=>setTimeout(r,100));}
  const call=(endpoint:string,token?:string,method='GET',body?:unknown)=>fetch(origin+'/api/v1/'+endpoint,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  await t.test('Nicht erreichbarer Anmeldedienst zeigt HTML-Loginhinweis und erholt sich ohne Serverneustart',async()=>{
    const unavailable=await fetch(origin+'/api/auth/login',{redirect:'manual'});assert.equal(unavailable.status,302);assert.match(unavailable.headers.get('location')||'',/auth_error=provider_unavailable/);
    discoveryUnavailable=false;
    const recovered=await fetch(origin+'/api/auth/login',{redirect:'manual'});assert.equal(recovered.status,302);assert.ok((recovered.headers.get('location')||'').startsWith(issuer+'/authorize'));
  });
  await t.test('Jeder geschützte API-Bereich verweigert anonymen Zugriff und unpassende Rollen',async()=>{
    for(const endpoint of ['customers','customers/1','reports','settings','users','audit','deliveries','messages/preview'])assert.equal((await call(endpoint)).status,401,endpoint);
    assert.equal((await call('customers',undefined,'POST',{})).status,401);
    assert.equal((await call('imports/commit',undefined,'POST',{})).status,401);
    assert.equal((await call('customers','invalid')).status,401);
    assert.equal((await call('settings','fixture-employee')).status,403);
    assert.equal((await call('audit','fixture-employee')).status,403);
    assert.equal((await call('users','fixture-employee')).status,403);
    assert.equal((await call('settings','fixture-no-mfa')).status,403);
    assert.equal((await call('customers','fixture-wrong-aud')).status,401);
  });
  await t.test('REST-CRUD nutzt dieselben Regeln, Versionen und getrennten Rechte',async()=>{
    const data={name:'Fiktives API-Konto',mac_address:'02-11-22-33-44-01',provider:'Art',assignee:'Marko',package_months:1,service_start:'2026-01-31',payment_status:'Unbezahlt',postal_code:'00123'};
    const response=await call('customers','fixture-employee','POST',data);assert.equal(response.status,201);const c=await response.json();assert.equal(c.service_end,'2026-02-28');assert.match(c.customer_number,/^[A-Z0-9]{6}$/);assert.equal(c.postal_code,'00123');
    const list=await(await call('customers?q='+c.customer_number,'fixture-employee')).json();assert.equal(list.total,1);
    assert.equal((await call('customers/'+c.id,'fixture-employee','DELETE',{version:c.version,confirm:true})).status,403);
    assert.equal((await call('customers/'+c.id,'fixture-admin','PATCH',{version:c.version,data:{customer_number:'HACKED'}})).status,400);
    const changed=await call('customers/'+c.id,'fixture-employee','PATCH',{version:c.version,data:{comment:'Fiktive Änderung'}});assert.equal(changed.status,200);
    const updated=await changed.json();for(const field of ['provider','assignee','service_start','service_end','package_months','payment_status','due_date','postal_code','customer_number','period_id'])assert.equal(updated[field],c[field],'PATCH muss '+field+' erhalten');
    assert.equal((await call('customers/'+c.id,'fixture-employee','PATCH',{version:c.version,data:{comment:'Veraltet'}})).status,409);
    assert.equal((await call('customers?per_page=1000','fixture-employee')).status,400);
    assert.equal((await call('settings','fixture-admin')).status,200);
    for(let i=0;i<8;i++)assert.equal((await call('customers','fixture-admin','POST',{name:'demo.konto.'+(i+1),mac_address:'02:22:00:00:00:'+String(i+1).padStart(2,'0'),provider:i%2?'Art':'2GO',assignee:['Marko','Mirko','Satem'][i%3],package_months:12,service_start:addDays(today(),-60),service_end:addDays(today(),i*7-8),payment_status:['Bezahlt','Unbezahlt','Unbekannt'][i%3]})).status,201);
  });
  await t.test('Administrator legt Benutzer mit temporärem Passwort an und setzt Passwörter ohne E-Mail zurück',async()=>{
    const secret='Nur-fuer-den-Test-123456!';
    assert.equal((await call('users','fixture-employee','POST',{action:'create',username:'neuer.mitarbeiter',role:'employee',password:secret})).status,403);
    const creation=await call('users','fixture-admin','POST',{action:'create',username:'neuer.mitarbeiter',role:'employee',password:secret});assert.equal(creation.status,200);
    const text=await creation.text();assert.equal(text.includes(secret),false);const created=JSON.parse(text);
    assert.deepEqual(identityOperations.find(x=>x.action==='create')?.required_actions,['UPDATE_PASSWORD','CONFIGURE_TOTP']);
    assert.equal(identityOperations.find(x=>x.action==='create')?.temporary,true);
    const accounts=await(await call('users','fixture-admin')).json();assert.ok(accounts.data.some((u:any)=>u.subject===created.subject&&u.username==='neuer.mitarbeiter'));assert.equal(JSON.stringify(accounts).includes(secret),false);
    const connection=new DatabaseSync(database);connection.prepare('INSERT INTO web_sessions(token_hash,subject,access_token,expires_at,csrf) VALUES(?,?,?,?,?)').run('fixture-old-session',created.subject,'opaque-test-only',Date.now()+60000,'test-only');connection.close();
    assert.equal((await call('users','fixture-employee','POST',{action:'reset',subject:created.subject,password:'Neues-Testpasswort-123!'})).status,403);
    const reset=await call('users','fixture-admin','POST',{action:'reset',subject:created.subject,password:'Neues-Testpasswort-123!'});assert.equal(reset.status,200);
    assert.equal(identityOperations.find(x=>x.action==='reset')?.temporary,true);
    const after=new DatabaseSync(database);assert.equal(after.prepare('SELECT COUNT(*) AS n FROM web_sessions WHERE subject=?').get(created.subject)!.n,0);assert.ok(Number(after.prepare('SELECT not_before FROM principals WHERE subject=?').get(created.subject)!.not_before)>0);
    assert.equal(after.prepare("SELECT changes FROM audit_log WHERE action='identity.password.reset'").all().some(x=>String(x.changes).includes('Neues-Testpasswort')),false);after.close();
  });
  await t.test('Massenaktionen prüfen HTTP-Berechtigung und aktuelle Zahlungszeiträume',async()=>{
    assert.equal((await call('bulk/preview',undefined,'POST',{action:'paid',customers:[{id:1,version:1}]})).status,401);
    const details=await(await call('customers/1','fixture-employee')).json(),c=details.data;
    assert.equal((await call('bulk/preview','fixture-employee','POST',{action:'whatsapp',customers:[{id:c.id,version:c.version}]})).status,403);
    const preview=await(await call('bulk/preview','fixture-employee','POST',{action:'paid',customers:[{id:c.id,version:c.version}]})).json();
    const result=await(await call('bulk/commit','fixture-employee','POST',{batch_id:preview.id,confirm:true})).json();assert.equal(result.successful,1);
    const repeated=await(await call('bulk/commit','fixture-employee','POST',{batch_id:preview.id,confirm:true})).json();assert.deepEqual(repeated,result);
  });
  await t.test('OpenAPI-Dokument ist strukturell gültig',async()=>{const spec=await(await call('openapi.json')).json();await SwaggerParser.validate(spec);});
  const browser=await chromium.launch({headless:true,executablePath:existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined});t.after(()=>browser.close());
  await t.test('Geschützter interner Link kehrt nach Login zurück und lädt vorher keine Kunden',async()=>{
    const redirect=await fetch(origin+'/kunden?provider=Art&q=Fiktives',{redirect:'manual'});assert.equal(redirect.status,307);assert.ok(redirect.headers.get('location')?.includes('returnTo='));
    const isolated=await browser.newContext(),protectedPage=await isolated.newPage();let premature=false;
    protectedPage.on('request',r=>{if(r.url().includes('/api/v1/customers')&&!r.headers().cookie?.includes('kr_session='))premature=true;});
    await protectedPage.goto(origin+'/kunden?provider=Art&q=Fiktives');await protectedPage.getByRole('heading',{name:'Deine Kunden.'}).waitFor();assert.equal(new URL(protectedPage.url()).pathname,'/kunden');assert.equal(new URL(protectedPage.url()).search,'?provider=Art&q=Fiktives');assert.equal(await protectedPage.getByRole('textbox',{name:'Kunden suchen'}).inputValue(),'Fiktives');assert.equal(premature,false);await isolated.close();
  });
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();const pageErrors:string[]=[];page.on('pageerror',e=>pageErrors.push(e.message));
  mkdirSync('test-results',{recursive:true});
  await t.test('Browser: OIDC-Rücksprung, Kundensuche, Formularvorschau, Importfreigabe und mobile Navigation',async()=>{
    await page.goto(origin+'/?auth_error=1');await page.getByRole('link',{name:/Sicher anmelden/}).waitFor();await page.screenshot({path:'test-results/login-desktop.png',fullPage:true,animations:'disabled'});
    await page.getByRole('link',{name:/Sicher anmelden/}).click();await page.getByRole('heading',{name:'Alles im Blick.'}).waitFor({timeout:8000}).catch(()=>{throw new Error('OIDC-Test fehlgeschlagen: '+page.url()+'; Diagnose: '+tokenDiagnostic+'; Server: '+serverLog);});await page.locator('.stat-card strong').first().filter({hasText:'9'}).waitFor();await page.screenshot({path:'test-results/dashboard-desktop.png',fullPage:true,animations:'disabled'});
    await page.locator('.nav-link').filter({hasText:'Kunden'}).click();await page.getByRole('textbox',{name:'Kunden suchen'}).fill('Fiktives API-Konto');await page.getByRole('button',{name:/Fiktives API-Konto/}).first().waitFor();
    await page.getByRole('button',{name:'Kunde anlegen',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Servicebeginn *',{exact:true}).fill('2026-01-31');await dialog.getByLabel('Paket *').selectOption('1');
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('input')).some(e=>e.readOnly&&e.value==='28.02.2026'));await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();
    await page.locator('.nav-link').filter({hasText:'Import'}).click();await page.locator('input[type=file]').setInputFiles({name:'mgmt.csv',mimeType:'text/csv',buffer:Buffer.from('Name;MAC-Adresse;Serviceende\nDemo Import;02:33:00:00:00:01;31.12.2027')});await page.getByRole('button',{name:'Vorschau erstellen'}).click();await page.getByRole('button',{name:'Auswahl importieren'}).waitFor();assert.equal(await page.getByRole('button',{name:'Auswahl importieren'}).isDisabled(),true);
    await page.getByRole('checkbox',{name:'Zeile 2 freigeben'}).check();await page.getByRole('button',{name:'Auswahl importieren'}).click();await page.getByRole('button',{name:'Jetzt importieren'}).click();await page.getByText('Import abgeschlossen',{exact:true}).waitFor();
    await page.locator('.nav-link').filter({hasText:'Reports'}).click();await page.getByRole('heading',{name:'Zahlungen nach Fälligkeit'}).waitFor();await page.screenshot({path:'test-results/reports-desktop.png',fullPage:true,animations:'disabled'});
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Menü öffnen'}).click();await page.locator('.nav-link').filter({hasText:'Übersicht'}).click();await page.getByRole('heading',{name:'Alles im Blick.'}).waitFor();await page.screenshot({path:'test-results/dashboard-mobile.png',fullPage:true,animations:'disabled'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).map(e=>({tag:e.tagName,cls:e.className,right:Math.round(e.getBoundingClientRect().right)})).filter(e=>e.right>window.innerWidth+2).slice(0,20))));
    await page.getByRole('button',{name:'Menü öffnen'}).click();await page.locator('.nav-link').filter({hasText:'Kunden'}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.screenshot({path:'test-results/customers-mobile.png',fullPage:true,animations:'disabled'});
    assert.deepEqual(pageErrors,[]);
  });
  await t.test('Sitzungscookies sind HttpOnly/Strict, CSRF ist verpflichtend, Logout widerruft serverseitig',async()=>{
    const cookies=await context.cookies(),session=cookies.find(c=>c.name==='kr_session')!;assert.equal(session.httpOnly,true);assert.equal(session.sameSite,'Strict');
    const cookie=session.name+'='+session.value;const me=await(await fetch(origin+'/api/v1/me',{headers:{cookie}})).json();assert.equal(me.user.role,'admin');
    const body=JSON.stringify({service_start:'2026-01-31',package_months:1});
    assert.equal((await fetch(origin+'/api/v1/service-preview',{method:'POST',headers:{cookie,Origin:origin,'Content-Type':'application/json'},body})).status,403);
    assert.equal((await fetch(origin+'/api/v1/service-preview',{method:'POST',headers:{cookie,Origin:'https://untrusted.invalid','X-CSRF-Token':me.user.csrf,'Content-Type':'application/json'},body})).status,403);
    assert.equal((await fetch(origin+'/api/v1/service-preview',{method:'POST',headers:{cookie,Origin:origin,'X-CSRF-Token':me.user.csrf,'Content-Type':'application/json'},body})).status,200);
    assert.equal((await fetch(origin+'/api/v1/logout',{method:'POST',headers:{cookie,Origin:origin,'X-CSRF-Token':me.user.csrf,'Content-Type':'application/json'},body:'{}'})).status,200);
    assert.equal((await fetch(origin+'/api/v1/customers',{headers:{cookie}})).status,401);
    const databaseConnection=new DatabaseSync(database);databaseConnection.prepare("UPDATE principals SET active=0 WHERE subject='fixture-employee'").run();databaseConnection.close();assert.equal((await call('customers','fixture-employee')).status,401);
  });
});
