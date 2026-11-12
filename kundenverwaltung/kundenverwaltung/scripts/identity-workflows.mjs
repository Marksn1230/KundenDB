import {readFileSync} from 'node:fs';
export async function syncWorkflows(admin){
 const config=JSON.parse(readFileSync(new URL('../keycloak/kundenraum-realm.json',import.meta.url),'utf8'));
 await admin('','PUT',{ssoSessionIdleTimeout:3600,clientSessionIdleTimeout:3600,ssoSessionMaxLifespan:28800,clientSessionMaxLifespan:28800});
 const roles=await(await admin('/roles')).json();if(!roles.some(r=>r.name==='kassierer'))await admin('/roles','POST',{name:'kassierer',description:'Eigene offene Kunden kassieren'});
 const role=await(await admin('/roles/kassierer')).json();
 for(const clientId of ['kundenraum-web','kundenraum-ios']){const clients=await(await admin('/clients?clientId='+clientId)).json();if(!clients.length)continue;const c=await(await admin('/clients/'+clients[0].id)).json();await admin('/clients/'+c.id,'PUT',{...c,attributes:{...c.attributes,'client.session.idle.timeout':'3600','client.session.max.lifespan':'28800'}});if(clientId==='kundenraum-web')await admin('/clients/'+c.id+'/scope-mappings/realm','POST',[role]);}
 const desired=config.authenticatorConfig[0];
 const flow='kundenraum-mfa';let executions=await(await admin('/authentication/flows/'+flow+'/executions')).json();
 for(const e of executions.filter(e=>e.providerId==='auth-otp-form'))await admin('/authentication/executions/'+e.id,'DELETE');
 if(!executions.some(e=>e.providerId==='auth-conditional-otp-form'))await admin('/authentication/flows/'+flow+'/executions/execution','POST',{provider:'auth-conditional-otp-form'});
 executions=await(await admin('/authentication/flows/'+flow+'/executions')).json();const otp=executions.find(e=>e.providerId==='auth-conditional-otp-form');if(!otp)throw new Error('Conditional OTP fehlt.');
 await admin('/authentication/flows/'+flow+'/executions','PUT',{...otp,requirement:'REQUIRED'});
 if(!otp.authenticationConfig)await admin('/authentication/executions/'+otp.id+'/config','POST',{...desired,alias:desired.alias+'-'+Date.now()});else await admin('/authentication/config/'+otp.authenticationConfig,'PUT',{...desired,alias:desired.alias+'-'+otp.id});
 const actions=await(await admin('/authentication/required-actions')).json();const totp=actions.find(a=>a.alias==='CONFIGURE_TOTP');await admin('/authentication/required-actions/CONFIGURE_TOTP','PUT',{...totp,defaultAction:false});
 console.log('60 Minuten Inaktivität, separate 8-Stunden-Maximaldauer, Kassiererrolle und Conditional OTP abgeglichen.');
}
