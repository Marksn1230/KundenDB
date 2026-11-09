delete process.env.DATABASE_URL;
import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {all,transaction} from '../lib/db';import {createCustomer,customer,everyCustomer,renewCustomer,updateCustomer} from '../lib/customers';
import {makePreview,commitImport} from '../lib/imports';import {serviceDue} from '../lib/due';import {addDays,today,type Customer} from '../lib/domain';
process.env.DATABASE_PATH=path.join(mkdtempSync(path.join(tmpdir(),'kundenraum-due-import-')),'test.sqlite');
const actor='due-import-admin',mapping={Name:'name',MAC:'mac_address',Ende:'service_end'};
const make=(name:string,mac:string,end:string|null)=>transaction(()=>createCustomer({name,mac_address:mac,mac_mode:'identifier',service_end:end,payment_status:'Bezahlt'},actor,true));
const preview=(name:string,mac:string,end?:string)=>makePreview({mode:'existing_only',mapping,rows:[{Name:name,MAC:mac,...(end===undefined?{}:{Ende:end})}]},actor);
test('Europe/Vienna und Fälligkeit: heute, exakt Tag 15, Tag 16, abgelaufen, ohne Datum und Pagination',()=>{
 assert.equal(today(new Date('2026-11-08T23:30:00Z')),'2026-11-09');
 const now='2026-11-09',customers=[{id:1,customer_number:'TEST01',service_end:now},{id:2,customer_number:'TEST02',service_end:addDays(now,15)},{id:3,customer_number:'TEST03',service_end:addDays(now,16)},{id:4,customer_number:'TEST04',service_end:addDays(now,-1)},{id:5,customer_number:'TEST05',service_end:null}] as Customer[];
 const due=serviceDue(customers,'upcoming',1,1,now);assert.equal(due.total,2);assert.deepEqual(due.data.map(c=>c.id),[1]);assert.deepEqual(serviceDue(customers,'upcoming',2,1,now).data.map(c=>c.id),[2]);assert.deepEqual(serviceDue(customers,'expired',1,10,now).data.map(c=>c.id),[4]);
});
test('Nach Verlängerung zählt ausschließlich der aktuelle Zeitraum und der Kunde verlässt beide Gruppen',async()=>{
 const now=today(),c=await make('Abgelaufenes Konto','Due.Expired',addDays(now,-1));assert.ok(serviceDue(await everyCustomer(),'expired',1,100,now).data.some(x=>x.id===c.id));
 await transaction(()=>renewCustomer(c.id,c.version,1,undefined,'keep',actor));const list=await everyCustomer();assert.equal(serviceDue(list,'expired',1,100,now).data.some(x=>x.id===c.id),false);assert.equal(serviceDue(list,'upcoming',1,100,now).data.some(x=>x.id===c.id),false);assert.equal((await all('SELECT id FROM periods WHERE customer_id=?',c.id)).length,2);
});
test('Import ohne Datum: neue Konten bleiben leer, auch bei vorhandenem Beginn/Paket; kein Datum wird erfunden',async()=>{
 const p=await makePreview({rows:[{Name:'Ohne Datum',MAC:'No.Date',Beginn:'31.01.2027',Paket:'1'}],mapping:{Name:'name',MAC:'mac_address',Beginn:'service_start',Paket:'package_months'}},actor);assert.equal(p.counts.new,1);
 await commitImport({preview_id:p.id,selection:[{index:0}]},actor);const c=(await everyCustomer()).find(c=>c.name==='Ohne Datum')!;assert.match(c.customer_number,/^[A-Z0-9]{6}$/);assert.equal(c.service_end,null);
 await transaction(()=>updateCustomer(c.id,{comment:'Nur Notiz'},c.version,actor));assert.equal((await customer(c.id)).service_end,null);
 const again=await makePreview({rows:[{Name:c.name,MAC:c.mac_address,Ende:''}],mapping},actor);assert.equal(again.counts.existing,1);
});
test('Fehlendes/leeres Importende erhält bestehendes Datum; ausgefülltes ungültiges Datum bleibt Zeilenfehler',async()=>{
 const c=await make('Ende erhalten','Keep.Date','2027-12-31');
 for(const end of [undefined,'']){const p=await preview(c.name,c.mac_address,end);assert.equal(p.counts.existing,1);await commitImport({preview_id:p.id,selection:[{index:0}]},actor);assert.equal((await customer(c.id)).service_end,'2027-12-31');}
 const wrong=await preview(c.name,c.mac_address,'31.02.2027');assert.equal(wrong.counts.review,1);assert.match(wrong.rows[0].reason!,/Ungültiges Datum/);
});
test('Serviceende erstmals setzen ist eine Korrektur desselben Zeitraums; Zahlung bleibt erhalten',async()=>{
 const c=await make('Erstmals Datum','First.Date',null),p=await preview(c.name,c.mac_address,'30.04.2027');assert.equal(p.rows[0].end_change,'initial');assert.match(p.rows[0].reason!,/Serviceende erstmals setzen/);
 await commitImport({preview_id:p.id,selection:[{index:0,approve_end:true}]},actor);assert.equal((await customer(c.id)).service_end,'2027-04-30');assert.equal((await customer(c.id)).payment_status,'Bezahlt');assert.equal((await all('SELECT id FROM periods WHERE customer_id=?',c.id)).length,1);
 assert.equal((await preview(c.name,c.mac_address,'30.04.2027')).counts.existing,1);
});
test('Nur Name: Datum separat freigeben, MAC behalten; spätere MAC-Freigabe ohne weitere Verlängerung',async()=>{
 const c=await make('Nur Name Treffer','Name.Old','2027-01-31'),p=await preview(c.name,'Name.New','31.12.2027');assert.equal(p.rows[0].requires_mac_approval,true);
 await commitImport({preview_id:p.id,selection:[{index:0,approve_end:true,payment:'unpaid'}]},actor);let current=await customer(c.id);assert.equal(current.mac_address,'Name.Old');assert.equal(current.service_end,'2027-12-31');assert.equal(current.payment_status,'Unbezahlt');
 const repeated=await preview(c.name,'Name.New','31.12.2027');const noChange=await commitImport({preview_id:repeated.id,selection:[{index:0,approve_end:true}]},actor);assert.equal(noChange.updated,0);assert.equal((await all('SELECT id FROM periods WHERE customer_id=?',c.id)).length,2);
 const macOnly=await preview(c.name,'Name.New','31.12.2028');await commitImport({preview_id:macOnly.id,selection:[{index:0,approve_end:false,approve_mac:true}]},actor);current=await customer(c.id);assert.equal(current.mac_address,'Name.New');assert.equal(current.service_end,'2027-12-31');assert.equal((await all('SELECT id FROM periods WHERE customer_id=?',c.id)).length,2);
});
test('Nur MAC: Datum erstmalig unabhängig übernehmen; Name nur nach eigener ausdrücklicher Zustimmung',async()=>{
 const c=await make('Bisheriger Name','Only.MAC',null),p=await preview('Importierter Name',c.mac_address,'31.05.2027');assert.equal(p.rows[0].requires_name_approval,true);assert.equal(p.rows[0].previous_name,c.name);
 await commitImport({preview_id:p.id,selection:[{index:0,approve_end:true}]},actor);assert.equal((await customer(c.id)).name,c.name);assert.equal((await customer(c.id)).service_end,'2027-05-31');
 const rename=await preview('Importierter Name',c.mac_address,'31.12.2027');await commitImport({preview_id:rename.id,selection:[{index:0,approve_end:false,approve_name:true,payment:'unpaid'}]},actor);
 assert.equal((await customer(c.id)).name,'Importierter Name');assert.equal((await customer(c.id)).service_end,'2027-05-31');assert.equal((await customer(c.id)).payment_status,'Bezahlt');assert.equal((await all('SELECT id FROM periods WHERE customer_id=?',c.id)).length,1);
});
test('Getrennte Treffer sind Konflikt, kein Treffer bleibt ohne Neuanlage und Freigabe wird neu geprüft',async()=>{
 const a=await make('Geteilter Name','Split.A','2027-01-31'),b=await make('Anderer Name','Split.B','2027-01-31');
 const split=await preview(a.name,b.mac_address,'31.12.2027');assert.equal(split.counts.review,1);assert.match(split.rows[0].reason!,/Konflikt/);
 const noMatch=await preview('Niemand','Nobody.ID');assert.equal(noMatch.counts.unmatched,1);assert.match(noMatch.rows[0].reason!,/Kein bestehender Kunde gefunden/);
 const stale=await preview(a.name,a.mac_address,'31.12.2027');await transaction(()=>updateCustomer(a.id,{comment:'Zwischenzeitliche Änderung'},a.version,actor));await assert.rejects(()=>commitImport({preview_id:stale.id,selection:[{index:0,approve_end:true}]},actor),/seit der Vorschau/);
});

test('Ausdrückliches Enddatum hat auch bei regulärer Neuanlage Vorrang vor der Paketberechnung',async()=>{
 const c=await transaction(()=>createCustomer({name:'Explizites reguläres Ende',mac_address:'Explicit.Regular',mac_mode:'identifier',provider:'Art',assignee:'Marko',package_months:12,service_start:'2026-01-31',service_end:'2026-03-15'},actor));
 assert.equal(c.service_end,'2026-03-15');
});
