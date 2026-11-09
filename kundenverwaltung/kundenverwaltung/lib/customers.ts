import {randomInt} from 'node:crypto';
import {all,audit,get,run,transaction} from './db';
import {storedPhone} from './phone';
import {addDays,addMonths,Customer,customerSchema,CustomerInput,fail,fullMonths,normalizeName,normalizeIdentifier,Payment,renewalPreview,today} from './domain';
const select='SELECT c.*,p.id AS period_id,p.service_start,p.service_end,p.package_months,p.payment_status,p.due_date,p.end_source FROM customers c JOIN periods p ON p.customer_id=c.id AND p.is_current=1';
function mapped(row:Customer):Customer{const {name_key,...publicRow}=row as Customer & {name_key?:string};void name_key;return {...publicRow,consent:Boolean(row.consent),needs_completion:!row.provider||!row.assignee||!row.package_months||!row.service_start||!row.service_end||!row.mac_address};}
export async function customer(id:number){const row=await get<Customer>(select+' WHERE c.id=?',id);if(!row)fail('Konto nicht gefunden.',404);return mapped(row);}
export async function everyCustomer(){return (await all<Customer>(select+' ORDER BY c.id DESC')).map(mapped);}
export async function customerNumber(generate=()=>Array.from({length:6},()=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[randomInt(36)]).join('')){for(let i=0;i<100;i++){const number=generate();if(!/^[A-Z0-9]{6}$/.test(number))fail('Ungültiger Nummerngenerator.',500);if(!await get('SELECT id FROM customers WHERE customer_number=?',number))return number;}return fail('Keine freie Kundennummer gefunden.',503);}
export function checkVersion(c:Customer,version:number){if(c.version!==version)fail('Der Datensatz wurde inzwischen geändert. Bitte neu laden.',409);}
async function input(raw:unknown){const data=customerSchema.parse(raw);data.mac_address=normalizeIdentifier(data.mac_address,data.mac_mode);const cfg=await get<{default_country:string}>('SELECT default_country FROM integration_settings WHERE id=1');data.phone=storedPhone(data.phone,cfg?.default_country||'AT');if(data.consent&&(!data.phone||!data.consent_note))fail('Eine Einwilligung benötigt Telefonnummer und Nachweis.');return data;}
async function identity(data:CustomerInput,except?:number){const matches=await all<{id:number}>('SELECT id FROM customers WHERE name_key=? AND mac_address=? AND mac_mode=?',normalizeName(data.name),data.mac_address,data.mac_mode);if(matches.some(c=>c.id!==except))fail('Name und MAC-Adresse bzw. Kennung sind bereits vorhanden.',409);}
async function period(id:number,data:CustomerInput,end:string|null,due:string|null,source:string){return Number((await run('INSERT INTO periods(customer_id,service_start,service_end,package_months,payment_status,due_date,end_source) VALUES(?,?,?,?,?,?,?)',id,data.service_start,end,data.package_months,data.payment_status,due,source)).lastInsertRowid);}
export async function createCustomer(raw:unknown,actor:string,incomplete=false){
 const data=await input(raw);if(!incomplete&&(!data.service_start||!data.package_months||!data.provider||!data.assignee))fail('Servicebeginn, Paket, Anbieter und Benutzerzuordnung sind erforderlich.');
 await identity(data);const end=incomplete&&Object.hasOwn(data,'service_end')?data.service_end??null:data.service_end??(data.service_start&&data.package_months?addMonths(data.service_start,data.package_months):null);
 if(end&&data.service_start&&end<=data.service_start)fail('Serviceende muss nach dem Servicebeginn liegen.');
 let id=0;for(let i=0;i<100;i++){const inserted=await run('INSERT INTO customers(customer_number,name,name_key,mac_address,mac_mode,phone,postal_code,address,provider,assignee,points,comment,consent,consent_note,consent_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(customer_number) DO NOTHING',await customerNumber(),data.name,normalizeName(data.name),data.mac_address,data.mac_mode,data.phone,data.postal_code,data.address,data.provider,data.assignee,data.points,data.comment,data.consent?1:0,data.consent_note,data.consent?new Date().toISOString():null);if(inserted.changes){id=Number(inserted.lastInsertRowid);break;}}
 if(!id)fail('Kundennummer konnte nicht erzeugt werden.',503);
 await period(id,data,end,data.due_date===undefined?data.service_start:data.due_date,data.service_end?'imported':'calculated');
 const result=await customer(id);await audit(actor,'customer.create',String(id),result);return result;
}
export async function updateCustomer(id:number,patch:Record<string,unknown>,version:number,actor:string,imported=false,paymentChoice:'keep'|'unpaid'='keep'){
 const old=await customer(id);checkVersion(old,version);
 const base=Object.fromEntries(Object.keys(customerSchema.shape).map(k=>[k,old[k as keyof Customer]]));const data=await input({...base,...patch});if(imported)data.payment_status=paymentChoice==='unpaid'?'Unbezahlt':old.payment_status;await identity(data,id);
 let end=data.service_end??null,source=old.end_source;
 if(imported&&!Object.hasOwn(patch,'service_end')){end=old.service_end;source=old.end_source;}
 else if(Object.hasOwn(patch,'service_end')&&data.service_end!==old.service_end)source='imported';
 else if((source==='calculated'||!old.service_end)&&(data.service_start!==old.service_start||data.package_months!==old.package_months)){end=data.service_start&&data.package_months?addMonths(data.service_start,data.package_months):null;source='calculated';}
 if(end&&data.service_start&&end<=data.service_start)fail('Serviceende muss nach dem Servicebeginn liegen.');
 if(imported&&end&&old.service_end&&end>old.service_end){
   await run('UPDATE periods SET is_current=0 WHERE id=?',old.period_id);
   await period(id,{...data,service_start:old.service_end,payment_status:paymentChoice==='unpaid'?'Unbezahlt':old.payment_status},end,old.service_end,'imported');
 }else{
   const payment=imported&&end!==old.service_end?(paymentChoice==='unpaid'?'Unbezahlt':old.payment_status):data.payment_status;
   await run('UPDATE periods SET service_start=?,service_end=?,package_months=?,payment_status=?,due_date=?,end_source=? WHERE id=?',data.service_start,end,data.package_months,payment,data.due_date??null,source,old.period_id);
 }
 await run('UPDATE customers SET name=?,name_key=?,mac_address=?,mac_mode=?,phone=?,postal_code=?,address=?,provider=?,assignee=?,points=?,comment=?,consent=?,consent_note=?,consent_at=?,version=version+1 WHERE id=?',data.name,normalizeName(data.name),data.mac_address,data.mac_mode,data.phone,data.postal_code,data.address,data.provider,data.assignee,data.points,data.comment,data.consent?1:0,data.consent_note,data.consent?old.consent_at||new Date().toISOString():null,id);
 const result=await customer(id);await audit(actor,imported?'customer.import':'customer.update',String(id),{before:old,after:result});return result;
}
export async function renewCustomer(id:number,version:number,months:number,start:string|undefined,payment:'keep'|'unpaid',actor:string){
 const old=await customer(id);checkVersion(old,version);const next=renewalPreview(old,start,months);
 await run('UPDATE periods SET is_current=0 WHERE id=?',old.period_id);
 await period(id,{...old,...next,package_months:months as Customer['package_months'],payment_status:payment==='unpaid'?'Unbezahlt':old.payment_status},next.service_end,next.due_date,'calculated');
 await run('UPDATE customers SET version=version+1 WHERE id=?',id);const result=await customer(id);await audit(actor,'customer.renew',String(id),{previous_period:old.period_id,next:result});return result;
}
export async function setPayment(id:number,periodId:number,status:Payment,version:number,actor:string){
 checkVersion(await customer(id),version);const p=await get('SELECT * FROM periods WHERE id=? AND customer_id=?',periodId,id);if(!p)fail('Zeitraum nicht gefunden.',404);
 if(p.payment_status!==status){await run('UPDATE periods SET payment_status=? WHERE id=?',status,periodId);await run('UPDATE customers SET version=version+1 WHERE id=?',id);await audit(actor,'payment.update',String(id),{period_id:periodId,before:p.payment_status,after:status});}return customer(id);
}
export async function filteredCustomers(params:URLSearchParams){const query=(params.get('q')||'').trim().toLocaleLowerCase('de-DE');return (await everyCustomer()).filter(c=>{
 if(query&&![c.customer_number,c.name,c.phone,c.mac_address,c.mac_mode==='mac'?c.mac_address.replace(/:/g,''):''].some(v=>v.toLocaleLowerCase('de-DE').includes(query)))return false;
 for(const key of ['provider','assignee','payment_status','package_months'] as const)if(params.get(key)&&String(c[key])!==params.get(key))return false;
 if(params.get('year')&&c.service_end?.slice(0,4)!==params.get('year'))return false;
 if(params.get('month')&&Number(c.service_end?.slice(5,7))!==Number(params.get('month')))return false;
 if(params.get('service_status')==='expired'&&(!c.service_end||c.service_end>=today()))return false;
 if(params.get('service_status')==='active'&&(!c.service_end||c.service_end<today()))return false;return true;
 });}
export async function reports(params:URLSearchParams,now=today()){
 const customers=(await everyCustomer()).filter(c=>(!params.get('provider')||c.provider===params.get('provider'))&&(!params.get('assignee')||c.assignee===params.get('assignee'))),ids=new Set(customers.map(c=>c.id));
 const periods=(await all<{id:number;customer_id:number;service_end:string|null;due_date:string|null;payment_status:Payment}>('SELECT * FROM periods')).filter(p=>ids.has(p.customer_id));
 const months=new Map<string,{month:string;paid:number;unpaid:number;unknown:number;expiries:number;customer_ids:number[]}>();
 const bucket=(month:string)=>{if(!months.has(month))months.set(month,{month,paid:0,unpaid:0,unknown:0,expiries:0,customer_ids:[]});return months.get(month)!;};
 for(const p of periods){if(p.due_date){const b=bucket(p.due_date.slice(0,7));b[p.payment_status==='Bezahlt'?'paid':p.payment_status==='Unbezahlt'?'unpaid':'unknown']++;b.customer_ids.push(p.customer_id);}if(p.service_end)bucket(p.service_end.slice(0,7)).expiries++;}
 const unpaid=periods.filter(p=>p.payment_status==='Unbezahlt').map(p=>({...p,customer:customers.find(c=>c.id===p.customer_id)!,due_month:p.due_date?.slice(0,7)||null,full_months_overdue:p.due_date?fullMonths(p.due_date,now):null,overdue_label:!p.due_date?'Ohne Fälligkeitsdatum':p.due_date>now?'Noch nicht fällig':fullMonths(p.due_date,now)===0?'Unter einem Monat':fullMonths(p.due_date,now)+' volle Monate'}));
 return {as_of:now,customers:customers.length,active:customers.filter(c=>c.service_end&&c.service_end>=now).length,upcoming:customers.filter(c=>c.service_end&&c.service_end>=now&&c.service_end<=addDays(now,15)).length,unpaid,undated:unpaid.filter(p=>!p.due_date),periods:periods.map(p=>({...p,customer:customers.find(c=>c.id===p.customer_id)!})),months:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month))};
}
export const atomic=transaction;
