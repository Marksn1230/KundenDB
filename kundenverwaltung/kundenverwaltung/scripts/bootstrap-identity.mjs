import {setTimeout as delay} from 'node:timers/promises';
const root=(process.env.OIDC_INTERNAL_URL||'http://127.0.0.1:8080/auth').replace(/\/$/,'');
const adminUrl=process.env.OIDC_ADMIN_URL||root+'/admin/realms/kundenraum';
const username=process.env.INITIAL_ADMIN_USERNAME,password=process.env.INITIAL_ADMIN_PASSWORD;
if(!username||!password||password.length<15)throw new Error('INITIAL_ADMIN_USERNAME und individuelles INITIAL_ADMIN_PASSWORD (mindestens 15 Zeichen) setzen.');
let ready=false;for(let n=0;n<180;n++){try{if((await fetch(root+'/realms/kundenraum/.well-known/openid-configuration',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break;}}catch{}await delay(1000);}if(!ready)throw new Error('Keycloak wurde nicht erreichbar.');
const response=await fetch(root+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:process.env.KEYCLOAK_ADMIN_USER||'bootstrap',password:process.env.KEYCLOAK_ADMIN_PASSWORD||''})});if(!response.ok)throw new Error('Keycloak-Bootstrapanmeldung fehlgeschlagen.');
const token=await response.json();
async function admin(resource,method='GET',body){const r=await fetch(adminUrl+resource,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error('Identitätseinrichtung fehlgeschlagen: '+method+' '+resource.split('?')[0]+' (HTTP '+r.status+')');return r;}
await admin('','PUT',{loginTheme:'kundenraum',verifyEmail:false});
const profile=await(await admin('/users/profile')).json();for(const attribute of profile.attributes)if(['email','firstName','lastName'].includes(attribute.name))delete attribute.required;await admin('/users/profile','PUT',profile);
const users=await(await admin('/users?exact=true&username='+encodeURIComponent(username))).json();
if(users.length){console.log('Persönliches Administratorkonto existiert bereits; Passwort und Rollen wurden nicht verändert.');process.exit(0);}
const created=await admin('/users','POST',{username,firstName:username,enabled:true,requiredActions:['UPDATE_PASSWORD','CONFIGURE_TOTP'],credentials:[{type:'password',value:password,temporary:true}]});
const id=created.headers.get('location')?.split('/').pop();if(!id)throw new Error('Angelegtes Konto konnte nicht zugeordnet werden.');
const role=await(await admin('/roles/administrator')).json();await admin('/users/'+encodeURIComponent(id)+'/role-mappings/realm','POST',[role]);
console.log('Persönlicher Administrator eingerichtet. Bei erster Anmeldung Passwort ändern und MFA einrichten.');
