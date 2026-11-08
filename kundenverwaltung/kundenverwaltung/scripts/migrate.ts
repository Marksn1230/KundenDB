import {migrate,closeDatabase} from '../lib/db';
console.log('Datenbankschema bereit:',await migrate());await closeDatabase();
