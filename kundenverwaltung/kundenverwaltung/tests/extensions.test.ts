delete process.env.DATABASE_URL;
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {all,get,run,transaction} from '../lib/db';
import {createCustomer,customer,setPayment} from '../lib/customers';
import {normalizeIdentifier,detectIdentifierMode,today,addDays} from '../lib/domain';
import {phoneForWhatsApp} from '../lib/phone';
import {makePreview,commitImport} from '../lib/imports';
import {previewBulk,commitBulk} from '../lib/bulk';
import {settings,saveSettings} from '../lib/messages';
import {safeReturnTo} from '../lib/return-to';
process.env.DATABASE_PATH=path.join(mkdtempSync(path.join(tmpdir(),'kundenraum-extensions-')),'test.sqlite');
const actor='extensions-admin';
test('Lokale Telefonnummern und ausdrückliche Länderkennung bleiben eindeutig',()=>{
 assert.equal(phoneForWhatsApp('0676 1234567','AT'),'+436761234567');
 assert.equal(phoneForWhatsApp('+43 676 1234567','DE'),'+436761234567');
 assert.equal(phoneForWhatsApp('+49 1512 3456789','AT'),'+4915123456789');
 assert.throws(()=>phoneForWhatsApp('12345','AT'),/nicht eindeutig/);
});
test('Freie Kennungen bleiben in Schreibweise erhalten; MAC-Modus validiert getrennt',()=>{
 assert.equal(normalizeIdentifier(' Service.Alpha ','identifier'),'Service.Alpha');
 assert.equal(normalizeIdentifier('aabbccddeeff','mac'),'AA:BB:CC:DD:EE:FF');
 assert.throws(()=>normalizeIdentifier('Service.Alpha','mac'),/MAC/);
 assert.equal(detectIdentifierMode('Service.Alpha'),'identifier');
});
test('Gemeinsamer Drei-Spalten-Import erkennt Modus und schreibt erst nach Freigabe',async()=>{
 const input={rows:[{Name:'Fiktiv.A',Kennung:'Case.User',Ende:'28.02.2027'}],mapping:{Name:'name',Kennung:'mac_address',Ende:'service_end'}};
 const preview=await makePreview(input,actor);assert.equal(preview.profile,'unified');assert.equal(preview.rows[0].data.mac_mode,'identifier');assert.equal((await all('SELECT id FROM customers')).length,0);
 await commitImport({preview_id:preview.id,selection:[{index:0,payment:'keep'}]},actor);
 const c=(await all<any>('SELECT * FROM customers'))[0];assert.equal(c.mac_address,'Case.User');assert.equal(c.mac_mode,'identifier');assert.match(c.customer_number,/^[A-Z0-9]{6}$/);
 const repeated=await makePreview(input,actor);assert.equal(repeated.counts.existing,1);await commitImport({preview_id:repeated.id,selection:[{index:0,payment:'unpaid'}]},actor);assert.equal((await all('SELECT * FROM periods WHERE customer_id=?',c.id)).length,1);
 const conflict=await makePreview({...input,rows:[{Name:'Fiktiv.A',Kennung:'case.user',Ende:'28.02.2027'}]},actor);assert.equal(conflict.counts.review,1);
 await assert.rejects(()=>makePreview({...input,mapping:{Name:'name',Ende:'service_end'}},actor),/Pflichtspalten/);
});
test('Einheitlicher Import überschreibt leere optionale Felder nicht und bewahrt Zahlungswahl',async()=>{
 const c=await transaction(()=>createCustomer({name:'Liste.B',mac_address:'02:AA:00:00:00:02',phone:'0676 1234567',postal_code:'00123',service_end:'2027-02-28',payment_status:'Bezahlt'},actor,true));
 const p=await makePreview({rows:[{Name:c.name,MAC:c.mac_address,Ende:'31.03.2027',Telefon:'',PLZ:''}],mapping:{Name:'name',MAC:'mac_address',Ende:'service_end',Telefon:'phone',PLZ:'postal_code'}},actor);
 await commitImport({preview_id:p.id,selection:[{index:0,payment:'keep'}]},actor);const updated=await customer(c.id);assert.equal(updated.phone,'+436761234567');assert.equal(updated.postal_code,'00123');assert.equal(updated.payment_status,'Bezahlt');
});
test('Massenzahlung ist berechtigt, versioniert, pro aktuellem Zeitraum und idempotent',async()=>{
 const a=await transaction(()=>createCustomer({name:'Bulk.A',mac_address:'02:AA:00:00:00:03',service_end:'2027-02-28',payment_status:'Unbezahlt'},actor,true));
 const b=await transaction(()=>createCustomer({name:'Bulk.B',mac_address:'02:AA:00:00:00:04',service_end:'2027-02-28',payment_status:'Bezahlt'},actor,true));
 const preview=await previewBulk({action:'paid',customers:[{id:a.id,version:a.version},{id:b.id,version:b.version}]},actor,false);assert.equal(preview.eligible,1);assert.equal(preview.excluded,1);
 const result=await commitBulk({batch_id:preview.id,confirm:true},actor,false);assert.equal(result.successful,1);assert.equal(result.skipped,1);assert.equal((await customer(a.id)).payment_status,'Bezahlt');
 const version=(await customer(a.id)).version;assert.deepEqual(await commitBulk({batch_id:preview.id,confirm:true},actor,false),result);assert.equal((await customer(a.id)).version,version);
 await assert.rejects(()=>commitBulk({batch_id:preview.id,confirm:true},'anderer-login',false),/nicht gefunden/);
});
test('WhatsApp-Massenversand prüft Rechte, Standardland, Vorschau und Wiederholungen',async()=>{
 const c=await transaction(()=>createCustomer({name:'Bulk.WA',mac_address:'02:AA:00:00:00:05',service_end:addDays(today(),30),phone:'0676 1234567',consent:true,consent_note:'Fiktive Einwilligung'},actor,true));
 await assert.rejects(()=>previewBulk({action:'whatsapp',customers:[{id:c.id,version:c.version}]},actor,false),/Administratorrechte/);
 const off=await previewBulk({action:'whatsapp',customers:[{id:c.id,version:c.version}]},actor,true);assert.equal(off.eligible,0);assert.match(off.items[0].reason!,/ausgeschaltet/);
 process.env.WHATSAPP_TOKEN='test-only';process.env.WHATSAPP_PHONE_ID='123';process.env.WHATSAPP_TEMPLATE='approved_template';process.env.WHATSAPP_API_VERSION='vTEST';
 const{last_telegram_date,...s}=await settings();void last_telegram_date;await saveSettings({...s,whatsapp_enabled:true,default_country:'AT'},actor);
 const p=await previewBulk({action:'whatsapp',customers:[{id:c.id,version:c.version}]},actor,true);assert.equal(p.eligible,1);assert.equal(p.items[0].phone,'+436761234567');assert.match(p.items[0].preview!.text,/Bulk.WA/);
 let calls=0;const transport=async(_url:string,init:RequestInit)=>{calls++;assert.equal(JSON.parse(String(init.body)).to,'436761234567');return Response.json({messages:[{id:'simulated'}]});};
 const result=await commitBulk({batch_id:p.id,confirm:true},actor,true,transport);assert.equal(result.successful,1);assert.equal(calls,1);
 assert.deepEqual(await commitBulk({batch_id:p.id,confirm:true},actor,true,transport),result);assert.equal(calls,1);
 await assert.rejects(()=>commitBulk({batch_id:p.id,confirm:true},actor,false,transport),/Administratorrechte/);
});
test('Rücksprung erlaubt nur interne Seiten und keine offenen Weiterleitungen',()=>{
 assert.equal(safeReturnTo('/kunden/42?q=alpen'),'/kunden/42?q=alpen');assert.equal(safeReturnTo('/reports'),'/reports');
 for(const unsafe of ['https://fremd.invalid','//fremd.invalid','/\\fremd.invalid','/api/auth/logout','/%2f%2ffremd.invalid'])assert.equal(safeReturnTo(unsafe),'/');
});

test('SQLite-Snapshot übernimmt auch offene WAL-Daten konsistent und überschreibt kein Ziel',async()=>{
 const {spawnSync}=await import('node:child_process'),{DatabaseSync}=await import('node:sqlite'),{mkdtempSync}=await import('node:fs');
 const folder=mkdtempSync(path.join(tmpdir(),'kundenraum-snapshot-')),source=path.join(folder,'source.sqlite'),target=path.join(folder,'snapshot.sqlite'),db=new DatabaseSync(source);
 try{db.exec("PRAGMA journal_mode=WAL;CREATE TABLE sample(value TEXT);INSERT INTO sample VALUES('fiktiv');");
 const execute=()=>spawnSync(process.execPath,['--import','tsx','scripts/snapshot-sqlite.ts','--output',target],{env:{...process.env,DATABASE_PATH:source},encoding:'utf8',windowsHide:true});
 const result=execute();assert.equal(result.status,0,result.stderr);const copy=new DatabaseSync(target,{readOnly:true});assert.equal(copy.prepare('SELECT value FROM sample').get()!.value,'fiktiv');copy.close();const repeated=execute();assert.notEqual(repeated.status,0);assert.match(repeated.stderr,/existiert bereits/);
 }finally{db.close();}
});
