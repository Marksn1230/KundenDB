import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
if(existsSync('.env')){console.error('.env existiert bereits. Keine vorhandenen Geheimnisse werden überschrieben.');process.exit(1);}
let text=readFileSync('.env.example','utf8');
for(const name of ['SESSION_ENCRYPTION_KEY','OIDC_CLIENT_SECRET','KEYCLOAK_ADMIN_PASSWORD','KEYCLOAK_DB_PASSWORD'])text=text.replace(new RegExp('^'+name+'=.*$','m'),name+'='+randomBytes(32).toString('hex'));
writeFileSync('.env',text,{mode:0o600});
console.log('.env mit individuellen Zufallsschlüsseln angelegt. Bootstrap-Zugang nur in dieser lokalen Datei.');
