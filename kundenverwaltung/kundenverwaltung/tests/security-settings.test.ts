import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {all,run} from '../lib/db';import {securitySettings,saveSecuritySettings} from '../lib/security-settings';
delete process.env.DATABASE_URL;process.env.DATABASE_PATH=path.join(mkdtempSync(path.join(tmpdir(),'kundenraum-security-')),'test.sqlite');process.env.MFA_SETTINGS_ENABLED='true';
test('IP-Einstellungen beginnen leer, prüfen Adressen und Versionen und starten nur bei wirksamen Änderungen eine Aktivierung',async()=>{
 const initial=await securitySettings();assert.deepEqual(initial.addresses,[]);assert.deepEqual(initial.applied_addresses,[]);
 for(const ip of ['0.0.0.0','127.0.0.1','192.168.1.1','8.8.8.0/24','*','example.com','2001:db8::1','::ffff:8.8.8.8'])await assert.rejects(()=>saveSecuritySettings({version:initial.version,addresses:[ip]},'admin'));
 const unchanged=await saveSecuritySettings({version:initial.version,addresses:[]},'admin');assert.equal(unchanged.changed,false);assert.equal(unchanged.version,initial.version);
 const changed=await saveSecuritySettings({version:initial.version,addresses:['2606:4700:4700::1111','8.8.8.8','8.8.8.8']},'admin');assert.equal(changed.status,'queued');assert.equal(changed.changed,true);assert.equal(changed.addresses.length,2);assert.deepEqual(changed.applied_addresses,[]);
 await assert.rejects(()=>saveSecuritySettings({version:initial.version,addresses:[]},'admin'),/inzwischen geändert/);await assert.rejects(()=>saveSecuritySettings({version:changed.version,addresses:[]},'admin'),/noch aktiviert/);
 await run("UPDATE security_settings SET status='active',applied_addresses=addresses,applied_version=version WHERE id=1");
 const reordered=await saveSecuritySettings({version:changed.version,addresses:[...changed.addresses].reverse()},'admin');assert.equal(reordered.changed,false);assert.equal(reordered.version,changed.version);
 const revoked=await saveSecuritySettings({version:changed.version,addresses:[]},'admin');assert.equal(revoked.changed,true);assert.equal(revoked.status,'queued');assert.equal((await all("SELECT * FROM audit_log WHERE action='security.mfa.request'")).length,2);
});
