import {setTimeout as delay} from 'node:timers/promises';
import {syncWorkflows} from './identity-workflows.mjs';
const root=(process.env.OIDC_INTERNAL_URL||'http://keycloak:8080/auth').replace(/\/$/,'');
const deadline=Date.now()+120000;
let ready=false;
while(Date.now()<deadline){
 try{if((await fetch(root+'/realms/kundenraum/.well-known/openid-configuration',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break;}}catch{}
 await delay(1000);
}
if(!ready)throw new Error('Keycloak ist noch nicht bereit. Containerlogs prüfen und identity-policy erneut starten.');
const r=await fetch(root+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:process.env.KEYCLOAK_ADMIN_USER||'bootstrap',password:process.env.KEYCLOAK_ADMIN_PASSWORD||''}),signal:AbortSignal.timeout(15000)});
if(!r.ok)throw new Error('IdP-Wartungsanmeldung fehlgeschlagen.');
const token=await r.json();
async function admin(resource,method='GET',body){const response=await fetch(root+'/admin/realms/kundenraum'+resource,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Login-Abgleich: '+method+' '+resource+' (HTTP '+response.status+')');return response;}
await syncWorkflows(admin);
await admin('/logout-all','POST');
console.log('Bestehende Keycloak-Sitzungen widerrufen.');
