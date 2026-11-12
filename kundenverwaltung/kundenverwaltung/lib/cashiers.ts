import type {Actor} from './auth';
import {all,audit,businessTransaction as transaction} from './db';
import {customer,everyCustomer,setPayment} from './customers';
import {fail} from './domain';
export const cashierAccounts=()=>all<{subject:string;name:string;username:string}>("SELECT subject,name,username FROM principals WHERE role='cashier' AND active=1 ORDER BY name");
export async function cashierCustomers(actor:Actor){return (await everyCustomer()).filter(c=>c.cashier_subject===actor.subject&&c.payment_status!=='Bezahlt');}
export async function cashierPayment(actor:Actor,id:number,periodId:number,version:number){return transaction(async()=>{
 const c=await customer(id);
 if(c.cashier_subject!==actor.subject)fail('Kunde ist diesem Kassierer nicht zugewiesen.',403);
 if(c.period_id!==periodId)fail('Der aktuelle Servicezeitraum hat sich ge?ndert.',409);
 if(c.payment_status==='Bezahlt')return c;
 const result=await setPayment(id,periodId,'Bezahlt',version,actor.subject);
 await audit(actor.subject,'cashier.payment',String(id),{period_id:periodId});return result;
});}
