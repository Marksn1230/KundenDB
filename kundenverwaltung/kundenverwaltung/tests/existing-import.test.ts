delete process.env.DATABASE_URL;
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';
import {all,transaction} from '../lib/db';
import {createCustomer,customer,updateCustomer} from '../lib/customers';
import {makePreview,commitImport} from '../lib/imports';
process.env.DATABASE_PATH=path.join(mkdtempSync(path.join(tmpdir(),'kundenraum-existing-')),'test.sqlite');
const actor='update-admin',mapping={Name:'name','MAC-Adresse':'mac_address',Serviceende:'service_end'};
const input=(rows:Record<string,string>[])=>({mode:'existing_only',rows,mapping});
const row=(name:string,mac:string,end='31.12.2027')=>({Name:name,'MAC-Adresse':mac,Serviceende:end});
const create=(name:string,mac:string)=>transaction(()=>createCustomer({name,mac_address:mac,mac_mode:mac.includes(':')?'mac':'identifier',service_end:'2027-01-31',payment_status:'Bezahlt',postal_code:'00123'},actor,true));

test('Bestehende aktualisieren: gemeinsamer MAC-/Namensabgleich, Enddatum, Freigabe und Replay',async()=>{
 const c=await create('Bestehend.Eins','02:00:00:00:01:01');
 const data=input([row('  bestehend.eins  ','020000000101')]),p=await makePreview(data,actor);
 assert.equal(p.counts.changed,1);assert.equal(p.rows[0].requires_mac_approval,false);assert.equal(p.rows[0].previous_end,'2027-01-31');assert.equal((await customer(c.id)).service_end,'2027-01-31');
 await commitImport({preview_id:p.id,selection:[{index:0,payment:'keep'}]},actor);
 assert.equal((await customer(c.id)).payment_status,'Bezahlt');assert.equal((await customer(c.id)).postal_code,'00123');
 const again=await makePreview(data,actor);assert.equal(again.counts.existing,1);await commitImport({preview_id:again.id,selection:[{index:0,payment:'unpaid'}]},actor);
 assert.equal((await all('SELECT id FROM periods WHERE customer_id=?',c.id)).length,2);assert.equal((await customer(c.id)).payment_status,'Bezahlt');
});
test('Abweichende Kennung verlangt eigene Freigabe; Kennung und Ende werden gemeinsam geändert',async()=>{
 const c=await create('Bestehend.Zwei','Account.Old'),p=await makePreview(input([row(c.name,'Account.New')]),actor);
 assert.equal(p.rows[0].previous_mac,'Account.Old');assert.equal(p.rows[0].requires_mac_approval,true);
 assert.equal((await customer(c.id)).mac_address,'Account.Old');assert.equal((await customer(c.id)).service_end,'2027-01-31');
 await commitImport({preview_id:p.id,selection:[{index:0,approve_mac:true,payment:'unpaid'}]},actor);
 const after=await customer(c.id);assert.equal(after.mac_address,'Account.New');assert.equal(after.mac_mode,'identifier');assert.equal(after.service_end,'2027-12-31');assert.equal(after.payment_status,'Unbezahlt');
 const periods=await all<any>('SELECT * FROM periods WHERE customer_id=? ORDER BY id',c.id);assert.equal(periods.length,2);assert.equal(periods[0].payment_status,'Bezahlt');
 const again=await makePreview(input([row(c.name,'Account.New')]),actor);assert.equal(again.counts.existing,1);
});
test('Reiner Kennungswechsel erhält Zahlungsstatus und erzeugt keinen zusätzlichen Zeitraum',async()=>{
 const c=await create('Bestehend.Drei','Only.Old'),p=await makePreview(input([row(c.name,'Only.New','31.01.2027')]),actor);
 await commitImport({preview_id:p.id,selection:[{index:0,approve_mac:true,payment:'unpaid'}]},actor);
 assert.equal((await customer(c.id)).payment_status,'Bezahlt');assert.equal((await all('SELECT id FROM periods WHERE customer_id=?',c.id)).length,1);
});
test('Mehrdeutige Namen, belegte Kennungen und widersprüchliche Datei bleiben gesperrt; kein Treffer legt nichts an',async()=>{
 const a=await create('Mehrfach','Conflict.One');await create('Mehrfach','Conflict.Two');const other=await create('Anderer','Occupied.ID');
 assert.equal((await makePreview(input([row(a.name,'Unused.ID')]),actor)).counts.review,1);
 assert.equal((await makePreview(input([row('Bestehend.Drei',other.mac_address)]),actor)).counts.review,1);
 const conflicting=await makePreview(input([row('Bestehend.Drei','Dup.A'),row('Bestehend.Drei','Dup.B')]),actor);assert.equal(conflicting.counts.review,2);
 const duplicateId=await makePreview(input([row('Bestehend.Eins','Shared.ID'),row('Bestehend.Zwei','Shared.ID')]),actor);assert.equal(duplicateId.counts.review,2);
 const count=(await all('SELECT id FROM customers')).length,p=await makePreview(input([row('Unbekannter','Unmatched.ID')]),actor);assert.equal(p.counts.unmatched,1);assert.equal(p.counts.new,0);
 await assert.rejects(()=>commitImport({preview_id:p.id,selection:[{index:0,approve_mac:true}]},actor),/Ungeklärte/);assert.equal((await all('SELECT id FROM customers')).length,count);
});
test('Geänderte oder neu belegte Datensätze nach Vorschau blockieren die gesamte Aktualisierung',async()=>{
 const c=await create('Bestehend.Stale','Stale.Old'),p=await makePreview(input([row(c.name,'Stale.New')]),actor);
 await create('Zwischenzeitlich','Stale.New');
 await assert.rejects(()=>commitImport({preview_id:p.id,selection:[{index:0,approve_mac:true}]},actor),/seit der Vorschau/);assert.equal((await customer(c.id)).mac_address,'Stale.Old');
});
