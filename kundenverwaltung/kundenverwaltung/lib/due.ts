import {everyCustomer} from './customers';
import {addDays,today,type Customer} from './domain';
export function serviceDue(customers:Customer[],group:'expired'|'upcoming',page=1,perPage=10,now=today()){
 const through=addDays(now,15),entries=customers.filter(c=>c.service_end&&(group==='expired'?c.service_end<now:c.service_end>=now&&c.service_end<=through)).sort((a,b)=>a.service_end!.localeCompare(b.service_end!)||a.customer_number.localeCompare(b.customer_number));
 return {as_of:now,through,group,total:entries.length,page,per_page:perPage,data:entries.slice((page-1)*perPage,page*perPage)};
}
export async function dueCustomers(group:'expired'|'upcoming',page=1,perPage=10,now=today()){return serviceDue(await everyCustomer(),group,page,perPage,now);}
