export function safeReturnTo(value:string|null|undefined){
 if(!value||value.length>2048||!value.startsWith('/')||value.startsWith('//')||value.includes('\\'))return '/';
 try{const url=new URL(value,'https://internal.invalid');if(url.origin!=='https://internal.invalid'||!/^\/(?:kunden(?:\/[1-9]\d*)?|import|reports|einstellungen)?$/.test(url.pathname))return '/';return url.pathname+url.search;}catch{return '/';}
}
