import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';
import {domainSettings} from '../scripts/domain-config.mjs';
import {checkDNS,configureDomain,deploymentStatus,parseEnv} from '../scripts/configure-domain.mjs';
const noData=()=>Promise.reject(Object.assign(new Error('no data'),{code:'ENODATA'}));
const resolver={resolve4:async()=>['203.0.113.10'],resolve6:noData};
const initial='APP_DOMAIN=alt.example.at\nHTTPS_ENABLED=true\nACME_EMAIL=admin@example.at\nACME_ENV=staging\nSERVER_PUBLIC_IPS=203.0.113.10\nDATABASE_URL=postgresql://fiktiv:GEHEIM_TEST@db/kundenraum\n';
const root=()=>{const r=mkdtempSync(path.join(tmpdir(),'kundenraum-domain-test-'));writeFileSync(path.join(r,'.env'),initial);return r;};
test('Domain-Konfiguration validiert Host, Protokoll, E-Mail und explizite Let’s-Encrypt-Verzeichnisse',()=>{
 assert.equal(domainSettings({APP_DOMAIN:'NEU.example.at',HTTPS_ENABLED:'true',ACME_EMAIL:'admin@example.at',ACME_ENV:'staging'}).directory,'https://acme-staging-v02.api.letsencrypt.org/directory');
 assert.equal(domainSettings({APP_DOMAIN:'neu.example.at',HTTPS_ENABLED:'false'}).origin,'http://neu.example.at');
 for(const domain of ['https://example.at','example.at:443','bad name.at','-bad.example.at','ok..at'])assert.throws(()=>domainSettings({APP_DOMAIN:domain,HTTPS_ENABLED:'false'}));
 assert.throws(()=>domainSettings({APP_DOMAIN:'ok.example.at',HTTPS_ENABLED:'true',ACME_EMAIL:'falsch'}));assert.throws(()=>domainSettings({APP_DOMAIN:'ok.example.at',HTTPS_ENABLED:'true',ACME_EMAIL:'a@b.at',ACME_ENV:'andereCA'}));
});
test('DNS-Prüfung blockiert fehlende, falsche und zusätzlich falsche AAAA-Einträge',async()=>{
 assert.deepEqual((await checkDNS('ok.example.at','203.0.113.10',resolver)).resolved,['203.0.113.10']);
 await assert.rejects(()=>checkDNS('fehlt.example.at','203.0.113.10',{resolve4:noData,resolve6:noData}),/Kein öffentlicher/);
 await assert.rejects(()=>checkDNS('falsch.example.at','203.0.113.11',resolver),/andere Adresse/);
 await assert.rejects(()=>checkDNS('aaaa.example.at','203.0.113.10',{...resolver,resolve6:async()=>['2001:db8::2']}),/andere Adresse/);
 await checkDNS('ipv6.example.at','203.0.113.10,2001:0db8:0:0:0:0:0:2',{...resolver,resolve6:async()=>['2001:db8::2']});
});
test('DNS-Fehler vor Freigabe verändern weder .env noch Dienste oder Sicherungen',async()=>{
 const r=root(),answers=['neu.example.at','j','admin@example.at','203.0.113.11'];
 await assert.rejects(()=>configureDomain({root:r,ask:async()=>answers.shift()!,resolver,log:()=>{}}),/andere Adresse/);assert.equal(readFileSync(path.join(r,'.env'),'utf8'),initial);assert.deepEqual(readdirSync(r),['.env']);
});
test('Interaktiver Abbruch schreibt nichts; Bestätigung sichert .env und erhält übrige Geheimnisse ohne Ausgabe',async()=>{
 const r=root(),messages:string[]=[],answers=['neu.example.at','j','admin@example.at','203.0.113.10','n'];
 assert.equal((await configureDomain({root:r,ask:async()=>answers.shift()!,resolver,log:m=>messages.push(m)})).applied,false);assert.equal(readFileSync(path.join(r,'.env'),'utf8'),initial);
 answers.push('neu.example.at','j','admin@example.at','203.0.113.10','j');const result=await configureDomain({root:r,ask:async()=>answers.shift()!,resolver,log:m=>messages.push(m)});
 assert.equal(result.applied,true);assert.equal(readFileSync(path.join(r,result.backup!),'utf8'),initial);
 const actual=parseEnv(readFileSync(path.join(r,'.env'),'utf8'));assert.equal(actual.APP_DOMAIN,'neu.example.at');assert.equal(actual.DATABASE_URL,'postgresql://fiktiv:GEHEIM_TEST@db/kundenraum');assert.equal(messages.join('\n').includes('GEHEIM_TEST'),false);
 const back=['','j'];await configureDomain({root:r,restore:result.backup,ask:async()=>back.shift()!,resolver,log:()=>{}});assert.equal(parseEnv(readFileSync(path.join(r,'.env'),'utf8')).APP_DOMAIN,'alt.example.at');
});
test('Status zeigt Zertifikatsablauf und Login-Origin; falsche Weiterleitung und HTTPS-Fehler liefern Loghinweis',async()=>{
 const values={APP_DOMAIN:'neu.example.at',HTTPS_ENABLED:'true',ACME_EMAIL:'a@example.at',ACME_ENV:'staging'},logs:string[]=[];
 const success=await deploymentStatus(values,{attempts:1,log:m=>logs.push(m),probe:async(url:string)=>url.includes('/health')?{status:200,certificate:{valid_to:'Jan 1 00:00:00 2035 GMT',issuer:{O:"Let's Encrypt",CN:'STAGING'}}}:{status:302,location:'https://neu.example.at/auth/realms/kundenraum/login'}});
 assert.equal(success,true);assert.ok(logs.some(s=>s.includes('2035-01-01')));assert.ok(logs.some(s=>s.includes('STAGING')));
 assert.equal(await deploymentStatus(values,{attempts:1,log:m=>logs.push(m),probe:async()=>{throw new Error('DNS falsch oder Port 443 nicht erreichbar');}}),false);assert.ok(logs.some(s=>s.includes('logs --tail=100 caddy')));
 assert.equal(await deploymentStatus(values,{attempts:1,log:()=>{},probe:async(url:string)=>url.includes('/health')?{status:200,certificate:{valid_to:'Jan 1 00:00:00 2035 GMT'}}:{status:302,location:'https://alte.example.at/auth/login'}}),false);
});
