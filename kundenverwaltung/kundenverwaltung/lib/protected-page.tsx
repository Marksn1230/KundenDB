import {connection} from 'next/server';
import {redirect} from 'next/navigation';
import Console from '@/components/console';
import {appUrl,authorize,configured} from './auth';
import {AppError} from './domain';
import {safeReturnTo} from './return-to';
export async function protectedPage(path:string,query:Record<string,string|string[]|undefined>={}){
 await connection();
 const search=new URLSearchParams();for(const[key,value]of Object.entries(query))if(typeof value==='string')search.set(key,value);
 const returnTo=safeReturnTo(path+(search.size?'?'+search:''));let login=false,cashier=false,issue:string|undefined;
 if(configured()&&!query.auth_error){
   try{const actor=await authorize(new Request(new URL(path,appUrl())));cashier=actor.role==='cashier';}
   catch(error){if(error instanceof AppError&&error.status===401)login=true;else if(error instanceof AppError)issue=error.message;else issue='Der Anmeldedienst ist vorübergehend nicht erreichbar.';}
 }
 if(cashier&&path!=='/meine-offenen-kunden')redirect('/meine-offenen-kunden');
 if(login)redirect('/api/auth/login?returnTo='+encodeURIComponent(returnTo));
 return <Console initialConfigured={configured()} authIssue={issue}/>;
}
