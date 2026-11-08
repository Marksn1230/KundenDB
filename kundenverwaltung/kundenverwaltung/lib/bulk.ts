import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {all,audit,get,run,transaction} from './db';
import {customer,setPayment} from './customers';
import {AppError,Customer,fail} from './domain';
import {messagePreview,sendWhatsApp,whatsappEligibility} from './messages';
export const bulkPreviewInput=z.object({action:z.enum(['paid','whatsapp']),customers:z.array(z.object({id:z.number().int().positive(),version:z.number().int().positive()}).strict()).min(1).max(500)}).strict();
export const bulkCommitInput=z.object({batch_id:z.string().uuid(),confirm:z.literal(true)}).strict();
type Item={id:number;version:number;name:string;customer_number:string;period_id?:number;service_end?:string|null;eligible:boolean;reason?:string;phone?:string;preview?:ReturnType<typeof messagePreview>};
type Result={successful:number;skipped:number;failed:number;entries:{id:number;status:'successful'|'skipped'|'failed';reason?:string}[]};
export async function previewBulk(raw:unknown,actor:string,admin:boolean){
 const input=bulkPreviewInput.parse(raw);if(input.action==='whatsapp'&&!admin)fail('Administratorrechte für Produktivversand erforderlich.',403);
 if(new Set(input.customers.map(c=>c.id)).size!==input.customers.length)fail('Konten dürfen nur einmal ausgewählt werden.');
 const items:Item[]=[];
 for(const selected of input.customers){try{const c=await customer(selected.id);let reason:string|undefined;
   if(c.version!==selected.version)reason='Datensatz wurde geändert. Liste neu laden.';
   else if(input.action==='paid'&&c.payment_status==='Bezahlt')reason='Aktueller Zeitraum ist bereits bezahlt.';
   else if(input.action==='whatsapp'){const eligible=await whatsappEligibility(c);if(!eligible.eligible)reason=eligible.reason;}
   const target=input.action==='whatsapp'?await whatsappEligibility(c):undefined;
   items.push({id:c.id,version:c.version,name:c.name,customer_number:c.customer_number,period_id:c.period_id,service_end:c.service_end,eligible:!reason,reason,phone:target?.target,preview:input.action==='whatsapp'?messagePreview(c):undefined});
 }catch(e){if(!(e instanceof AppError))throw e;items.push({id:selected.id,version:selected.version,name:'Konto '+selected.id,customer_number:'—',eligible:false,reason:e.message});}}
 const id=randomUUID(),payload={action:input.action,items};
 await run('INSERT INTO bulk_batches(id,actor,action,payload,expires_at) VALUES(?,?,?,?,?)',id,actor,input.action,JSON.stringify(payload),Date.now()+1800000);
 return{id,action:input.action,items,total:items.length,eligible:items.filter(i=>i.eligible).length,excluded:items.filter(i=>!i.eligible).length,template:input.action==='whatsapp'?{name:process.env.WHATSAPP_TEMPLATE||'Nicht konfiguriert',language:process.env.WHATSAPP_LANGUAGE||'de',text:messagePreview().text}:null};
}
export async function commitBulk(raw:unknown,actor:string,admin:boolean,transport?:Parameters<typeof sendWhatsApp>[4]){
 const input=bulkCommitInput.parse(raw);
 const claim=await transaction(async()=>{
   const batch=await get<{actor:string;action:string;payload:string;expires_at:number;status:string;result:string}>('SELECT * FROM bulk_batches WHERE id=?',input.batch_id);
   if(!batch||batch.actor!==actor)fail('Freigabe nicht gefunden.',404);
   if(batch.action==='whatsapp'&&!admin)fail('Administratorrechte für Produktivversand erforderlich.',403);
   if(batch.status==='completed')return{cached:JSON.parse(batch.result) as Result};
   if(batch.status!=='preview')fail('Diese Freigabe wird verarbeitet oder hat ein unklares Ergebnis. Bitte Versandprotokoll prüfen.',409);
   if(batch.expires_at<Date.now())fail('Vorschau abgelaufen. Bitte aktualisieren.',409);
   const payload=JSON.parse(batch.payload) as {action:'paid'|'whatsapp';items:Item[]};
   if(payload.action==='whatsapp'){await run("UPDATE bulk_batches SET status='running' WHERE id=?",input.batch_id);await audit(actor,'bulk.whatsapp.approve',input.batch_id,{customers:payload.items.map(i=>i.id)});return{payload};}
   const result:Result={successful:0,skipped:0,failed:0,entries:[]};
   for(const item of payload.items){
     if(!item.eligible){result.skipped++;result.entries.push({id:item.id,status:'skipped',reason:item.reason});continue;}
     let c:Customer;try{c=await customer(item.id);}catch(e){if(!(e instanceof AppError))throw e;result.failed++;result.entries.push({id:item.id,status:'failed',reason:e.message});continue;}
     if(c.payment_status==='Bezahlt'){result.skipped++;result.entries.push({id:c.id,status:'skipped',reason:'Bereits bezahlt.'});continue;}
     if(c.version!==item.version||c.period_id!==item.period_id){result.failed++;result.entries.push({id:c.id,status:'failed',reason:'Servicezeitraum wurde seit der Vorschau geändert.'});continue;}
     await setPayment(c.id,c.period_id,'Bezahlt',c.version,actor);result.successful++;result.entries.push({id:c.id,status:'successful'});
   }
   await run("UPDATE bulk_batches SET status='completed',result=? WHERE id=?",JSON.stringify(result),input.batch_id);await audit(actor,'bulk.paid',input.batch_id,result);return{cached:result};
 });
 if(claim.cached)return claim.cached;
 const result:Result={successful:0,skipped:0,failed:0,entries:[]};
 for(const item of claim.payload!.items){
   if(!item.eligible){result.skipped++;result.entries.push({id:item.id,status:'skipped',reason:item.reason});continue;}
   try{
     const current=await customer(item.id);if(current.version!==item.version||current.period_id!==item.period_id||current.service_end!==item.service_end)fail('Datensatz wurde seit der Versandvorschau geändert.',409);
     const outcome=await sendWhatsApp(item.id,'production',0,actor,transport,{batch_id:input.batch_id,version:item.version,service_end:item.service_end!});
     if(outcome.status==='accepted'){result.successful++;result.entries.push({id:item.id,status:'successful'});}
     else if(['skipped','cancelled'].includes(outcome.status)){result.skipped++;result.entries.push({id:item.id,status:'skipped',reason:'Versand übersprungen oder Daten zwischenzeitlich geändert.'});}
     else{result.failed++;result.entries.push({id:item.id,status:'failed',reason:outcome.status==='unknown'?'Unklares Versandergebnis. Vor erneutem Versand beim Anbieter prüfen.':'Versandanbieter hat die Nachricht nicht angenommen.'});}
   }catch(e){result.failed++;result.entries.push({id:item.id,status:'failed',reason:e instanceof AppError?e.message:'Versand konnte nicht ausgeführt werden.'});}
 }
 await transaction(async()=>{await run("UPDATE bulk_batches SET status='completed',result=? WHERE id=?",JSON.stringify(result),input.batch_id);await audit(actor,'bulk.whatsapp.result',input.batch_id,result);});return result;
}
