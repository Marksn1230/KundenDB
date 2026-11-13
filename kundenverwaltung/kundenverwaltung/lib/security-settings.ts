import {z} from 'zod';
import {get,run,audit,businessTransaction as transaction} from './db';
import {fail} from './domain';
import {normalizeIPs} from './mfa-policy.mjs';
type SecurityRow={version:number;addresses:string;applied_addresses:string;applied_version:number;status:'active'|'queued'|'applying'|'failed';error:string;updated_by:string;updated_at:string};
export async function securitySettings(){const row=(await get<SecurityRow>('SELECT * FROM security_settings WHERE id=1'))!;return {...row,addresses:JSON.parse(row.addresses) as string[],applied_addresses:JSON.parse(row.applied_addresses) as string[],available:process.env.MFA_SETTINGS_ENABLED==='true'};}
export async function saveSecuritySettings(raw:unknown,actor:string){const input=z.object({version:z.number().int().positive(),addresses:z.array(z.string().max(64)).max(64)}).strict().parse(raw);let addresses:string[];try{addresses=normalizeIPs(input.addresses);}catch(e){fail((e as Error).message);}
 return transaction(async()=>{const old=await securitySettings();if(input.version!==old.version)fail('Die IP-Liste wurde inzwischen geändert. Bitte neu laden.',409);if(['queued','applying'].includes(old.status))fail('Die vorherige Änderung wird noch aktiviert.',409);
 if(JSON.stringify(addresses)===JSON.stringify(old.addresses)&&old.status!=='failed')return {...old,changed:false};
 if(!old.available)fail('Die automatische Aktivierung ist in dieser Umgebung nicht eingerichtet.',503);
 const changed=JSON.stringify(addresses)!==JSON.stringify(old.applied_addresses);const now=new Date().toISOString();
 await run('UPDATE security_settings SET addresses=?,version=version+1,status=?,error=?,updated_by=?,updated_at=? WHERE id=1',JSON.stringify(addresses),changed?'queued':'active','',actor,now);if(!changed)await run('UPDATE security_settings SET applied_version=version WHERE id=1');
 await audit(actor,'security.mfa.request','ip-allowlist',{before:old.addresses,after:addresses,restart:changed});return {...await securitySettings(),changed};});}
