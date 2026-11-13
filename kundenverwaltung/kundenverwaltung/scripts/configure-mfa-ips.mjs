import {fileURLToPath} from 'node:url';
export {approvedIP,allowlistConfig} from '../lib/mfa-policy.mjs';
if(process.argv[1]===fileURLToPath(import.meta.url)){console.error('IP-Ausnahmen werden jetzt unter Einstellungen → Sicherheit verwaltet. Manuelle Proxydateien werden nicht mehr ausgewertet.');process.exitCode=1;}
