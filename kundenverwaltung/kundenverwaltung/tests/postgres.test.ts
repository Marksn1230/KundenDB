import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {withPostgresClient,migrate,get,all,transaction,type SqlClient} from '../lib/db';
import {createCustomer,customer,updateCustomer} from '../lib/customers';
import {makePreview,commitImport} from '../lib/imports';
import {previewBulk,commitBulk} from '../lib/bulk';
test('Frische PostgreSQL-Engine: Schema, Kalenderdaten, Import, Zahlungen und Freigabetransaktionen',{timeout:60000},async()=>{
 const engine=new PGlite();
 const client:SqlClient={query:async(sql,values)=>{if(!values?.length&&sql.split(';').filter(s=>s.trim()).length>1){const results=await engine.exec(sql);const last=results.at(-1);return{rows:(last?.rows||[]) as Record<string,unknown>[],rowCount:last?.affectedRows||0};}const result=await engine.query(sql,values);return{rows:result.rows as Record<string,unknown>[],rowCount:result.affectedRows||0};}};
 try{await withPostgresClient(client,async()=>{
   assert.equal((await migrate()).driver,'postgres');
   const c=await transaction(()=>createCustomer({name:'Postgres Fiktiv',mac_address:'Account.Case',mac_mode:'identifier',phone:'0676 1234567',provider:'Art',assignee:'Marko',package_months:1,service_start:'2026-01-31',payment_status:'Unbezahlt'},'postgres-test'));
   assert.equal(c.service_end,'2026-02-28');assert.equal(c.phone,'+436761234567');assert.equal(c.mac_address,'Account.Case');
   const p=await makePreview({rows:[{Name:c.name,MAC:c.mac_address,Ende:'31.03.2026'}],mapping:{Name:'name',MAC:'mac_address',Ende:'service_end'}},'postgres-test');assert.equal(p.counts.changed,1);
   await commitImport({preview_id:p.id,selection:[{index:0,payment:'keep'}]},'postgres-test');
   assert.equal((await all('SELECT * FROM periods WHERE customer_id=?',c.id)).length,2);
   const current=await customer(c.id),bulk=await previewBulk({action:'paid',customers:[{id:c.id,version:current.version}]},'postgres-test',false);assert.equal((await commitBulk({batch_id:bulk.id,confirm:true},'postgres-test',false)).successful,1);
   assert.equal((await customer(c.id)).payment_status,'Bezahlt');
   const before=(await customer(c.id)).version;
   await assert.rejects(()=>transaction(async()=>{await updateCustomer(c.id,{comment:'rollback'},before,'postgres-test');throw new Error('test rollback');}),/test rollback/);
   assert.equal((await customer(c.id)).version,before);assert.equal((await get<{count:number}>('SELECT COUNT(*)::int AS count FROM customers'))!.count,1);
 });}finally{await engine.close();}
});

test('Kontrollierte SQLite-v4-Übernahme nach PostgreSQL erhält Nummern, Zahlungen und Sequenzen',{timeout:60000},async()=>{
 const {mkdtempSync}=await import('node:fs'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {db}=await import('../lib/db'),{copySqliteToCurrent}=await import('../lib/migrate-sqlite');
 delete process.env.DATABASE_URL;process.env.DATABASE_PATH=path.join(mkdtempSync(path.join(tmpdir(),'kundenraum-transfer-')),'source.sqlite');
 const source=await transaction(()=>createCustomer({name:'Transfer Fiktiv',mac_address:'Preserve.Case',mac_mode:'identifier',phone:'0676 1234567',service_end:'2027-04-30',payment_status:'Bezahlt'},'transfer-test',true));
 db().exec('PRAGMA wal_checkpoint(FULL)');
 const engine=new PGlite(),client:SqlClient={query:async(sql,values)=>{if(!values?.length&&sql.split(';').filter(s=>s.trim()).length>1){const r=await engine.exec(sql);return{rows:(r.at(-1)?.rows||[]) as Record<string,unknown>[],rowCount:r.at(-1)?.affectedRows||0};}const r=await engine.query(sql,values);return{rows:r.rows as Record<string,unknown>[],rowCount:r.affectedRows||0};}};
 try{await withPostgresClient(client,async()=>{
   await migrate();const counts=await copySqliteToCurrent(process.env.DATABASE_PATH!);assert.equal(counts.customers,1);
   const copied=await customer(source.id);assert.equal(copied.customer_number,source.customer_number);assert.equal(copied.mac_address,'Preserve.Case');assert.equal(copied.payment_status,'Bezahlt');assert.equal(copied.service_end,'2027-04-30');assert.equal(copied.phone,'+436761234567');
   await assert.rejects(()=>copySqliteToCurrent(process.env.DATABASE_PATH!),/nicht leer/);
   const next=await transaction(()=>createCustomer({name:'Nach Transfer',mac_address:'After.Transfer',mac_mode:'identifier',service_end:'2027-05-31'},'transfer-test',true));assert.ok(next.id>source.id);assert.notEqual(next.customer_number,source.customer_number);
   assert.equal((await all('SELECT * FROM periods WHERE customer_id=?',source.id)).length,1);
 });}finally{await engine.close();}
});
