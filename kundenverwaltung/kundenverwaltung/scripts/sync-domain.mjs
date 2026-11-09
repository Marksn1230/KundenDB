import {setTimeout as delay} from 'node:timers/promises';
import {domainSettings} from './domain-config.mjs';
const settings=domainSettings(process.env),app=settings.origin,root=(process.env.OIDC_INTERNAL_URL||'http://keycloak:8080/auth').replace(/\/$/,'');
const username=process.env.KEYCLOAK_ADMIN_USER,password=process.env.KEYCLOAK_ADMIN_PASSWORD;
if(!username||!password)throw new Error('Gültigen IdP-Wartungszugang in KEYCLOAK_ADMIN_USER/PASSWORD setzen.');
let ready=false;for(let n=0;n<120;n++){try{if((await fetch(root+'/realms/kundenraum/.well-known/openid-configuration',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break;}}catch{}await delay(1000);}if(!ready)throw new Error('Keycloak ist nicht bereit. Containerlogs prüfen.');
let response=await fetch(root+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username,password}),signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error('IdP-Wartungsanmeldung fehlgeschlagen. Gültigen internen Verwaltungszugang verwenden.');
const token=await response.json(),base=root+'/admin/realms/kundenraum';
async function admin(resource,method='GET',body){const r=await fetch(base+resource,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Login-Domain konnte nicht aktualisiert werden (HTTP '+r.status+').');return r;}
const clients=await(await admin('/clients?clientId=kundenraum-web')).json();
if(clients.length!==1)throw new Error('Web-Login-Client nicht eindeutig gefunden.');
const client=await(await admin('/clients/'+clients[0].id)).json();
await admin('/clients/'+client.id,'PUT',{...client,rootUrl:app,baseUrl:app,redirectUris:[app+'/api/auth/callback'],webOrigins:[app],attributes:{...client.attributes,'post.logout.redirect.uris':app+'/*'}});
const realm=await(await admin('')).json();
await admin('','PUT',{attributes:{...realm.attributes,frontendUrl:app+'/auth'},sslRequired:settings.https?'external':'none'});
await admin('/logout-all','POST');
console.log('Web-Callback, erlaubte Origin und IdP-Frontend auf '+app+' aktualisiert; bestehende IdP-Sitzungen beendet. iOS-/Fremdclients separat prüfen.');
