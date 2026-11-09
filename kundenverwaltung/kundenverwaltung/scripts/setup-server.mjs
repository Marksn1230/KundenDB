import {readFileSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const domain=arg('--domain'),email=arg('--email'),username=arg('--admin-username');
if(!domain||!/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(domain)||!email||!email.includes('@')||!username||!/^[a-zA-Z0-9][a-zA-Z0-9._@-]{2,63}$/.test(username))throw new Error('Aufruf: node scripts/setup-server.mjs --domain kunden.example.com --email admin@example.com --admin-username persoenlicher-name');
let content=readFileSync(existsSync('.env')?'.env':'deploy/.env.example','utf8');
const data={};for(const line of content.split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m)data[m[1]]=m[2];}
if(existsSync('.env')&&!Object.values(data).includes('GENERIEREN'))throw new Error('Eine bereits eingerichtete .env wird nicht überschrieben.');
for(const name of ['POSTGRES_ADMIN_PASSWORD','POSTGRES_PASSWORD','KEYCLOAK_DB_ADMIN_PASSWORD','KEYCLOAK_DB_PASSWORD','SESSION_ENCRYPTION_KEY','OIDC_CLIENT_SECRET','KEYCLOAK_ADMIN_PASSWORD','INITIAL_ADMIN_PASSWORD'])if(!data[name]||data[name]==='GENERIEREN')data[name]=randomBytes(32).toString('hex');
Object.assign(data,{APP_DOMAIN:domain,HTTPS_ENABLED:'true',ACME_EMAIL:email,ACME_ENV:'production',INITIAL_ADMIN_USERNAME:username,DATABASE_URL:'postgresql://kundenraum:'+encodeURIComponent(data.POSTGRES_PASSWORD)+'@db:5432/kundenraum'});
delete data.PUBLIC_DOMAIN;delete data.APP_URL;content=content.replace(/^(?:PUBLIC_DOMAIN|APP_URL)=.*\r?\n/gm,'');
for(const[key,value]of Object.entries(data)){const pattern=new RegExp('^'+key+'=.*$','m');content=pattern.test(content)?content.replace(pattern,key+'='+value):content+'\n'+key+'='+value;}
writeFileSync('.env',content,{mode:0o600});chmodSync('.env',0o600);
console.log('Server-.env mit individuellen Geheimnissen eingerichtet. Initialer Zugang nur in .env; kein Passwort wird ausgegeben.');
