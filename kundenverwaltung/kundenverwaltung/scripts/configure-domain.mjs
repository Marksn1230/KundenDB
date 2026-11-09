import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import * as dns from 'node:dns/promises';
import http from 'node:http';import https from 'node:https';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {domainSettings} from './domain-config.mjs';
export function parseEnv(text){const values=/** @type {Record<string,string>} */ ({});for(const line of text.split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m){let value=m[2].trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);values[m[1]]=value;}}return values;}
export function renderEnv(text,updates){const remaining={...updates},lines=[];for(const line of text.split(/\r?\n/)){const key=line.match(/^([A-Z_]+)=/)?.[1];if(key&&Object.hasOwn(updates,key)){if(Object.hasOwn(remaining,key)){lines.push(key+'='+remaining[key]);delete remaining[key];}}else if(!['APP_URL','PUBLIC_DOMAIN','TLS_EMAIL'].includes(key))lines.push(line);}for(const[key,value]of Object.entries(remaining))lines.push(key+'='+value);return lines.join('\n').replace(/\n*$/,'\n');}
function normalizedIP(value){const input=value.trim();if(!isIP(input))throw new Error('Öffentliche Server-IP(s) als IPv4 oder IPv6, durch Komma getrennt, eingeben.');return isIP(input)===6?new URL('http://['+input+']').hostname.slice(1,-1):input;}
const networkDNS={resolve4:(hostname)=>dns.resolve4(hostname),resolve6:(hostname)=>dns.resolve6(hostname)};
export async function checkDNS(domain,addresses,resolver=networkDNS){
 const expected=addresses.split(',').filter(s=>s.trim()).map(normalizedIP);if(!expected.length)throw new Error('Öffentliche Server-IP für den DNS-Vergleich angeben.');
 const results=await Promise.allSettled([resolver.resolve4(domain),resolver.resolve6(domain)]);
 for(const result of results)if(result.status==='rejected'&&!['ENODATA','ENOTFOUND','NXDOMAIN'].includes(result.reason?.code))throw new Error('DNS-Abfrage fehlgeschlagen. Resolver/Netzwerk prüfen; Konfiguration bleibt unverändert.');
 const resolved=[...new Set(results.flatMap(r=>r.status==='fulfilled'?r.value:[]).map(normalizedIP))];
 if(!resolved.length)throw new Error('Kein öffentlicher A-/AAAA-DNS-Eintrag gefunden. Zuerst beim DNS-Anbieter auf diesen Server zeigen lassen.');
 const wrong=resolved.filter(ip=>!expected.includes(ip));if(wrong.length)throw new Error('DNS zeigt auf eine andere Adresse: '+wrong.join(', ')+'. A-/AAAA-Einträge einschließlich alter IPv6-Einträge korrigieren.');
 return {expected,resolved};
}
function atomicWrite(filename,content){const temporary=filename+'.tmp-'+randomBytes(5).toString('hex'),previous=fs.existsSync(filename)?fs.statSync(filename):null;try{fs.writeFileSync(temporary,content,{mode:0o600});if(previous&&process.platform!=='win32')fs.chownSync(temporary,previous.uid,previous.gid);fs.chmodSync(temporary,0o600);fs.renameSync(temporary,filename);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}
export async function configureDomain({root=process.cwd(),ask,resolver=networkDNS,restore=/** @type {string|undefined} */ (undefined),acmeEnv=/** @type {string|undefined} */ (undefined),log=console.log}){
 const filename=path.join(root,'.env');if(!fs.existsSync(filename))throw new Error('Zuerst .env aus deploy/.env.example einrichten; siehe docs/DOMAIN.md.');
 const original=fs.readFileSync(filename,'utf8'),current=parseEnv(original);let defaults=current;
 if(restore){const source=path.resolve(root,restore);if(path.dirname(source)!==path.resolve(root)||!/^\.env\.domain-[a-zA-Z0-9.-]+\.bak$/.test(path.basename(source))||!fs.lstatSync(source).isFile()||fs.lstatSync(source).isSymbolicLink())throw new Error('Nur eine .env.domain-…bak im Projektverzeichnis kann wiederhergestellt werden.');defaults=parseEnv(fs.readFileSync(source,'utf8'));}
 const request=async(prompt,fallback='')=>(await ask(prompt+(fallback?' ['+fallback+']':'')+': ')).trim()||fallback;
 const domain=restore?defaults.APP_DOMAIN:await request('Öffentlicher Hostname',defaults.APP_DOMAIN);
 const answer=restore?defaults.HTTPS_ENABLED??'true':(await request('HTTPS mit Let’s Encrypt aktivieren? j/n',defaults.HTTPS_ENABLED==='false'?'n':'j')).toLowerCase();
 if(!['j','ja','y','yes','true','n','nein','no','false'].includes(answer))throw new Error('HTTPS-Auswahl muss j oder n sein.');
 const enabled=['j','ja','y','yes','true'].includes(answer);
 const email=enabled?(restore?defaults.ACME_EMAIL||defaults.TLS_EMAIL:await request('ACME-Kontaktadresse',defaults.ACME_EMAIL||defaults.TLS_EMAIL)):defaults.ACME_EMAIL||defaults.TLS_EMAIL||'';
 const settings=domainSettings({APP_DOMAIN:domain,HTTPS_ENABLED:String(enabled),ACME_EMAIL:email,ACME_ENV:acmeEnv||defaults.ACME_ENV||'production'});
 const addresses=await request('Öffentliche Server-IP(s) für A/AAAA-Prüfung, durch Komma getrennt',defaults.SERVER_PUBLIC_IPS||current.SERVER_PUBLIC_IPS||'');
 const checked=await checkDNS(settings.domain,addresses,resolver);
 log('\nGeplante Änderung: '+(current.APP_DOMAIN?((current.HTTPS_ENABLED==='false'?'http://':'https://')+current.APP_DOMAIN):'nicht eingerichtet')+' → '+settings.origin);
 log('HTTPS: '+(settings.https?'an, ausschließlich Let’s Encrypt ('+settings.environment+')':'aus; Login und Datenverkehr sind unverschlüsselt.'));
 if(settings.https)log('ACME-Kontakt: '+settings.email);
 log('DNS bestätigt: '+checked.resolved.join(', '));log('Betroffene Dienste: keycloak, identity-config, web, caddy. Kein Build, keine Datenbankmigration; alte IdP-Sitzungen werden beendet.');
 if(current.HTTPS_ENABLED!=='false'&&!settings.https)log('Hinweis: Ein bereits im Browser gespeichertes HSTS kann HTTP weiterhin auf HTTPS umleiten.');
 const confirm=(await ask('Änderung jetzt anwenden? [j/N]: ')).trim().toLowerCase();if(!['j','ja','y','yes'].includes(confirm)){log('Abgebrochen. Keine Dateien oder Dienste geändert.');return {applied:false};}
 const updates={APP_DOMAIN:settings.domain,HTTPS_ENABLED:String(settings.https),ACME_EMAIL:settings.email,ACME_ENV:settings.environment,SERVER_PUBLIC_IPS:checked.expected.join(',')};
 const backup='.env.domain-'+new Date().toISOString().replace(/[:]/g,'-')+'-'+randomBytes(3).toString('hex')+'.bak';
 fs.writeFileSync(path.join(root,backup),original,{mode:0o600,flag:'wx'});fs.chmodSync(path.join(root,backup),0o600);
 fs.mkdirSync(path.join(root,'.runtime'),{recursive:true,mode:0o700});
 atomicWrite(path.join(root,'.runtime/domain-last-change.json'),JSON.stringify({backup,origin:settings.origin})+'\n');
 atomicWrite(filename,renderEnv(original,updates));
 log('Bisherige Konfiguration gesichert: '+backup);log('Rückkehr: sudo ./scripts/configure-domain.sh --restore '+backup);
 return {applied:true,backup,settings};
}
export function probeURL(address,{staging=false}={}){
 return new Promise((resolve,reject)=>{const url=new URL(address),transport=url.protocol==='https:'?https:http;
 const request=transport.get(url,{agent:false,...(url.protocol==='https:'?{rejectUnauthorized:!staging}:{})},response=>{const certificate=url.protocol==='https:'?response.socket.getPeerCertificate():null;response.resume();response.on('end',()=>resolve({status:response.statusCode,location:response.headers.location,certificate}));});request.setTimeout(8000,()=>request.destroy(new Error('Zeitüberschreitung')));request.on('error',reject);});
}
export async function deploymentStatus(values,{probe=probeURL,attempts=24,delay=ms=>new Promise(r=>setTimeout(r,ms)),log=console.log}={}){
 const settings=domainSettings(values);let last;
 for(let n=0;n<attempts;n++){try{
  const result=await probe(settings.origin+'/api/v1/health',{staging:settings.environment==='staging'});
  if(result.status!==200)throw new Error('Health-Endpunkt antwortet mit HTTP '+result.status);
  if(settings.https){if(!result.certificate?.valid_to)throw new Error('Zertifikatsablaufdatum fehlt.');log('HTTPS erreichbar: '+settings.origin);log('Zertifikat gültig bis: '+new Date(result.certificate.valid_to).toISOString());log('Aussteller: '+(result.certificate.issuer?.O||'')+' '+(result.certificate.issuer?.CN||''));if(settings.environment==='staging')log('STAGING: Dieses Testzertifikat ist in normalen Browsern nicht vertrauenswürdig.');}
  else log('HTTP erreichbar: '+settings.origin+' (HTTPS deaktiviert).');
  const login=await probe(settings.origin+'/api/auth/login?returnTo=%2Fkunden',{staging:settings.environment==='staging'});
  if(![302,303,307].includes(login.status)||!login.location||new URL(login.location,settings.origin).origin!==settings.origin||!new URL(login.location,settings.origin).pathname.startsWith('/auth/'))throw new Error('Login-Weiterleitung passt noch nicht zur konfigurierten Origin.');
  log('Login-Weiterleitung unter derselben Origin geprüft. Persönliche Passwort-/MFA-Anmeldung anschließend im Browser prüfen.');return true;
 }catch(error){last=error;log('Warte auf Anwendung/Zertifikat ('+(n+1)+'/'+attempts+'): '+error.message);if(n+1<attempts)await delay(5000);}}
 log('Einrichtung noch nicht erreichbar: '+last?.message);log('Proxy-Logs: sudo docker compose -f compose.server.yml logs --tail=100 caddy');return false;
}
async function main(){
 const root=process.cwd(),args=process.argv.slice(2),envfile=path.join(root,'.env');
 if(args[0]==='--rollback-hint'){const data=JSON.parse(fs.readFileSync(path.join(root,'.runtime/domain-last-change.json'),'utf8'));console.log('Rückkehr: sudo ./scripts/configure-domain.sh --restore '+data.backup);return;}
 if(args[0]==='--status'){if(!await deploymentStatus(parseEnv(fs.readFileSync(envfile,'utf8'))))process.exitCode=1;return;}
 if(args.length&&!(['--restore','--acme-env'].includes(args[0])&&args.length===2))throw new Error('Aufruf: ./scripts/configure-domain.sh [--restore .env.domain-…bak | --acme-env production|staging | --status]');
 const terminal=createInterface({input:process.stdin,output:process.stdout});
 try{const result=await configureDomain({root,ask:q=>terminal.question(q),restore:args[0]==='--restore'?args[1]:undefined,acmeEnv:args[0]==='--acme-env'?args[1]:undefined});if(!result.applied)process.exitCode=2;}finally{terminal.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error('Domain-Einrichtung: '+error.message);process.exitCode=1;});
