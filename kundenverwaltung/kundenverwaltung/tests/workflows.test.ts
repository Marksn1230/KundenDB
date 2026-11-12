import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {all,run,transaction} from '../lib/db';import {createCustomer,updateCustomer,renewCustomer,customer,reports} from '../lib/customers';import {cashierCustomers,cashierPayment} from '../lib/cashiers';import {sessionExpired,SESSION_IDLE_MS} from '../lib/session-policy';import {dueTelegramSlots,nextTelegramRun} from '../lib/telegram-schedule';import {settings,saveSettings,sendTelegram,telegramPreview} from '../lib/messages';import {approvedIP,allowlistConfig} from '../scripts/configure-mfa-ips.mjs';import {validateArchiveList} from '../lib/restores';
delete process.env.DATABASE_URL;process.env.DATABASE_PATH=path.join(mkdtempSync(path.join(tmpdir(),'kundenraum-workflows-')),'test.sqlite');
const a={subject:'cashier-a',name:'Kassierer A',username:'a',role:'cashier' as const},b={...a,subject:'cashier-b',username:'b',name:'Kassierer B'};
test('Zahlungsfälligkeit, historische Werte, Methoden und Zuweisung werden getrennt gespeichert',async()=>{
 await run("INSERT INTO principals(subject,username,name,role) VALUES('cashier-a','a','Kassierer A','cashier'),('cashier-b','b','Kassierer B','cashier')");
 const c=await transaction(()=>createCustomer({name:'Monatsende',mac_mode:'identifier',mac_address:'Workflow.1',provider:'Art',assignee:'Marko',package_months:12,service_start:'2026-01-31',due_date:'2026-01-01',payment_status:'Unbezahlt',payment_method:'Konto',payment_account:'Konto A',cashier_subject:a.subject},'admin'));
 assert.equal(c.due_date,'2026-02-28');assert.equal(c.service_end,'2027-01-31');
 const cash=await transaction(()=>updateCustomer(c.id,{payment_method:'Bar',payment_account:'Muss entfernt werden'},c.version,'admin'));assert.equal(cash.payment_account,'');
 await run("UPDATE periods SET due_date='2026-02-10' WHERE id=?",cash.period_id);
 const same=await transaction(()=>updateCustomer(c.id,{comment:'Historie'},cash.version,'admin'));assert.equal(same.due_date,'2026-02-10');
 const next=await transaction(()=>renewCustomer(c.id,same.version,12,'2027-01-31','unpaid','admin'));assert.equal(next.due_date,'2027-02-28');assert.equal((await all<{due_date:string}>('SELECT due_date FROM periods WHERE id=?',cash.period_id))[0].due_date,'2026-02-10');
 const imported=await transaction(()=>createCustomer({name:'Import unbekannt',mac_mode:'identifier',mac_address:'Workflow.2',due_date:'2026-01-01'},'admin',true));assert.equal(imported.due_date,null);assert.equal(imported.payment_method,null);
 const completed=await transaction(()=>updateCustomer(imported.id,{service_start:'2028-01-31'},imported.version,'admin'));assert.equal(completed.due_date,'2028-02-29');
 const report=await reports(new URLSearchParams());assert.ok(report.months.some(m=>m.month==='2027-02'&&m.unpaid===1));assert.ok(report.months.some(m=>m.month==='2028-01'&&m.expiries===1));
 await assert.rejects(()=>transaction(()=>updateCustomer(c.id,{cashier_subject:'foreign'},next.version,'admin')),/aktiven Kassierer/);
});
test('Zwei Kassierer: eigene aktuelle offene Kunden, atomare Zahlung, Replay und Fremdzugriff',async()=>{
 const rows=await cashierCustomers(a);assert.equal(rows.length,1);assert.equal((await cashierCustomers(b)).length,0);const c=rows[0];
 await assert.rejects(()=>cashierPayment(b,c.id,c.period_id,c.version),/nicht zugewiesen/);
 await assert.rejects(()=>cashierPayment(a,c.id,c.period_id-1,c.version),/aktuelle Servicezeitraum/);
 const result=await Promise.all([cashierPayment(a,c.id,c.period_id,c.version),cashierPayment(a,c.id,c.period_id,c.version)]);assert.ok(result.every(c=>c.payment_status==='Bezahlt'));assert.equal((await cashierCustomers(a)).length,0);assert.equal((await all("SELECT * FROM audit_log WHERE action='cashier.payment'")).length,1);
});
test('60 Minuten Inaktivität unabhängig von Token und Maximum; kurzer isolierter Test',()=>{
 assert.equal(SESSION_IDLE_MS,3600000);const s={last_activity_at:1000,expires_at:10000000};assert.equal(sessionExpired(s,3600999),false);assert.equal(sessionExpired(s,3601000),true);assert.equal(sessionExpired(s,1999,1000),false);assert.equal(sessionExpired(s,2000,1000),true);assert.equal(sessionExpired({...s,expires_at:1500},1500,1000),true);
});
test('Vienna: zwei Slots, Frühjahrslücke und Herbst-Doppelstunde erhalten dieselben Tagesschlüssel',()=>{
 const s={telegram_hour:2,telegram_minute:30,telegram_second_time:'18:15'};assert.equal(dueTelegramSlots(s,new Date('2026-03-29T00:59:00Z')).length,0);assert.equal(dueTelegramSlots(s,new Date('2026-03-29T01:00:00Z'))[0].key,'tg:2026-03-29:1');assert.equal(dueTelegramSlots(s,new Date('2026-10-25T00:30:00Z'))[0].key,dueTelegramSlots(s,new Date('2026-10-25T01:30:00Z'))[0].key);assert.equal(nextTelegramRun(s,new Set(['tg:2026-10-25:1']),new Date('2026-10-25T01:31:00Z'))?.time,'18:15');
});
test('Telegram: simulierte parallele Aufrufe versenden jeden Tagesslot einmal, beide Berichte enthalten denselben Kunden',async()=>{
 const {last_telegram_date,...s}=await settings();void last_telegram_date;await saveSettings({...s,telegram_enabled:true,telegram_hour:8,telegram_minute:15,telegram_second_time:'18:15'},'admin');process.env.TELEGRAM_BOT_TOKEN='fixture';process.env.TELEGRAM_CHAT_ID='123';let count=0;const messages:string[]=[];const transport=async(_u:string,init:RequestInit)=>{count++;messages.push(JSON.parse(String(init.body)).text);return Response.json({ok:true});};const now=new Date('2028-03-03T20:00:00Z');
 const first=await Promise.all([sendTelegram(false,'test',transport,'1',now),sendTelegram(false,'test',transport,'1',now)]);assert.deepEqual(first.map(r=>r.status).sort(),['accepted','skipped']);assert.equal((await sendTelegram(false,'test',transport,'2',now)).status,'accepted');assert.equal((await sendTelegram(false,'test',transport,'2',now)).status,'skipped');assert.equal(count,2);assert.ok(messages.every(t=>t.includes('Monatsende')));assert.doesNotMatch(await telegramPreview('2028-03-03'),/\(0\)/);
});
test('IP-Liste akzeptiert ausschließlich einzelne öffentliche IPv4/IPv6; Restore lehnt ausführbare Objekte ab',()=>{
 assert.equal(approvedIP('8.8.8.8'),'8.8.8.8');assert.equal(approvedIP('2606:4700:4700::1111'),'2606:4700:4700::1111');for(const ip of ['127.0.0.1','10.1.2.3','::1','2001:db8::1','2::','3fff::1','8.8.8.0/24','8.8.8.8,1.1.1.1'])assert.throws(()=>approvedIP(ip));assert.doesNotMatch(allowlistConfig([]),/remote_ip/);validateArchiveList('1; 1259 1 TABLE public customers owner');assert.throws(()=>validateArchiveList('1; 1255 1 FUNCTION public dangerous() owner'));assert.throws(()=>validateArchiveList('1; 1259 1 TABLE other customers owner'));
});
