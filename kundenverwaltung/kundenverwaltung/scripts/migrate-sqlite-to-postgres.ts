import {migrate,closeDatabase} from '../lib/db';
import {copySqliteToCurrent} from '../lib/migrate-sqlite';
const index=process.argv.indexOf('--sqlite');
if(!process.env.DATABASE_URL||index<0||!process.argv[index+1])throw new Error('DATABASE_URL und --sqlite <absoluter Pfad> sind erforderlich. Ziel muss leer sein.');
try{await migrate();console.log('Kontrollierte Übernahme:',await copySqliteToCurrent(process.argv[index+1]));}finally{await closeDatabase();}
