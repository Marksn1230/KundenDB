import {createHash,randomUUID} from 'node:crypto';
import {parse} from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import {z} from 'zod';
import {audit,get,run,transaction} from './db';
import {createCustomer,everyCustomer,updateCustomer} from './customers';
import {calendarDate,Customer,customerPatchSchema,fail,normalizeIdentifier,detectIdentifierMode,normalizeName} from './domain';
import {storedPhone} from './phone';
export {importColumns} from './import-format';
export const importFields=['name','mac_address','service_end','phone','postal_code','address','provider','assignee','points','package_months','service_start','due_date','payment_status','comment','mac_mode'] as const;
export type ImportField=typeof importFields[number];
export type RawRow=Record<string,string>;
export type ImportProfile='unified'|'mgmt'|'customers';
export type PreviewRow={index:number;category:'existing'|'changed'|'new'|'review'|'unmatched';requires_mac_approval?:boolean;requires_name_approval?:boolean;previous_name?:string;end_change?:'initial'|'update';previous_mac?:string;previous_mac_mode?:string;reason?:string;data:Record<string,unknown>;customer_id?:number;customer_number?:string;previous_end?:string|null;version?:number;fingerprint:string};
export type Preview={id:string;profile:ImportProfile;mode:'all'|'existing_only';rows:PreviewRow[];counts:Record<PreviewRow['category'],number>};
export const previewInput=z.object({profile:z.enum(['unified','mgmt','customers']).default('unified'),mode:z.enum(['all','existing_only']).default('all'),rows:z.array(z.record(z.string().max(160),z.string().max(10000))).min(1).max(5000),mapping:z.record(z.string(),z.enum(importFields)),resolutions:z.record(z.string(),z.number().int().positive()).optional(),modes:z.record(z.string(),z.enum(['mac','identifier'])).optional()}).strict();
type PreviewInput=z.infer<typeof previewInput>;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function importDate(raw: string) {
    let value = raw.trim();
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(value))
        value = value.split('.').reverse().join('-');
    if (!calendarDate(value))
        fail('Ungültiges Datum: ' + raw);
    return value;
}
function zipBudget(buffer: Buffer) {
    // Inspect the central directory BEFORE ExcelJS decompresses XML.
    let total = 0, entries = 0;
    for (let i = 0; i <= buffer.length - 46; i++)
        if (buffer.readUInt32LE(i) === 0x02014b50) {
            const size = buffer.readUInt32LE(i + 24);
            total += size;
            entries++;
            if (size === 0xffffffff || total > 30 * 1024 * 1024 || entries > 500)
                fail('Die entpackte XLSX-Datei ist zu groß.', 413);
            i += 45 + buffer.readUInt16LE(i + 28) + buffer.readUInt16LE(i + 30) + buffer.readUInt16LE(i + 32);
        }
    if (!entries)
        fail('Ungültige XLSX-Datei.');
}
export async function readImport(file: File) {
    if (file.size > 5 * 1024 * 1024 || !file.size)
        fail('Dateien müssen zwischen 1 Byte und 5 MB groß sein.', 413);
    const buffer = Buffer.from(await file.arrayBuffer());
    let matrix: string[][];
    if (/\.csv$/i.test(file.name)) {
        let content: string;
        try {
            content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        }
        catch {
            return fail('CSV bitte als UTF-8 exportieren.');
        }
        const first = content.split(/\r?\n/)[0];
        const delimiter = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
        matrix = parse(content, { bom: true, delimiter, skip_empty_lines: true, max_record_size: 65536, relax_column_count: false, to: 5002 }) as string[][];
    }
    else if (/\.xlsx$/i.test(file.name)) {
        zipBudget(buffer);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
        const sheet = workbook.worksheets[0];
        if (!sheet || sheet.rowCount > 5001 || sheet.columnCount > 40)
            fail('Maximal 5.000 Zeilen und 40 Spalten.');
        matrix = [];
        sheet.eachRow(row => {
            const values: string[] = [];
            for (let i = 1; i <= sheet.columnCount; i++) {
                const cell = row.getCell(i);
                if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Hyperlink || cell.type === ExcelJS.ValueType.Error)
                    fail('Formeln, Links und Fehlerzellen sind im Import nicht erlaubt.');
                values.push(cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : typeof cell.value === 'number' && Number.isInteger(cell.value) && /^0+$/.test(cell.numFmt) ? String(cell.value).padStart(cell.numFmt.length, '0') : cell.text);
            }
            matrix.push(values);
        });
    }
    else
        return fail('Bitte eine CSV- oder XLSX-Datei wählen.');
    if (matrix.length < 2 || matrix.length > 5001 || matrix[0].length > 40)
        fail('Die Datei muss eine Kopfzeile und 1–5.000 Datenzeilen enthalten.');
    const headers = matrix.shift()!.map(s => s.trim());
    if (headers.some(s => !s || s.length > 160) || new Set(headers).size !== headers.length)
        fail('Spaltenüberschriften müssen eindeutig und ausgefüllt sein.');
    const rows = matrix.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] || ''])));
    if (rows.some(row => Object.values(row).some(v => v.length > 10000)))
        fail('Ein Feld enthält mehr als 10.000 Zeichen.');
    return { headers, rows };
}
function mapRow(raw:RawRow,mapping:PreviewInput['mapping'],country:string,forcedMode?:'mac'|'identifier'){
 const data:Record<string,unknown>={};
 for(const[column,field]of Object.entries(mapping)){const value=(raw[column]||'').trim();if(!value&&!['name','mac_address'].includes(field))continue;
   if(['service_start','service_end','due_date'].includes(field))data[field]=importDate(value);
   else if(['points','package_months'].includes(field))data[field]=Number(value.replace(',','.'));
   else if(field==='mac_mode'){const mode=value.toLocaleLowerCase('de-DE');if(!['mac','kennung','identifier'].includes(mode))fail('MAC-Format muss MAC oder Kennung sein.');data[field]=mode==='mac'?'mac':'identifier';}
   else data[field]=value;
 }
 if(!data.name||!data.mac_address)fail('Pflichtspalten Name und MAC-Adresse müssen zugeordnet und ausgefüllt sein.');
 const mode=forcedMode||data.mac_mode as 'mac'|'identifier'|undefined||detectIdentifierMode(String(data.mac_address));
 data.mac_mode=mode;data.mac_address=normalizeIdentifier(String(data.mac_address),mode);data.name=String(data.name).trim();
 if(data.phone)data.phone=storedPhone(String(data.phone),country);
 customerPatchSchema.parse(data);return data;
}
const identifier=(c:{mac_address:string;mac_mode?:string})=>(c.mac_mode||'mac')+':'+c.mac_address.trim();
export async function classify(raw:Omit<PreviewInput,'mode'> & {mode?:PreviewInput['mode']}):Promise<PreviewRow[]>{
 const input=previewInput.parse(raw);
 const country=(await get<{default_country:string}>('SELECT default_country FROM integration_settings WHERE id=1'))?.default_country||'AT';
 const mapped=input.rows.map((raw,index)=>{try{return{data:mapRow(raw,input.mode==='existing_only'?Object.fromEntries(Object.entries(input.mapping).filter(([,field])=>['name','mac_address','mac_mode','service_end'].includes(field))):input.mapping,country,input.modes?.[String(index)])};}catch(e){return{data:{} as Record<string,unknown>,error:e instanceof Error?e.message:'Ungültige Zeile'};}});
 const customers=await everyCustomer(),duplicates=new Map<string,number>(),names=new Map<string,number>(),identifiers=new Map<string,number>();
 for(const row of mapped)if(!row.error){const key=normalizeName(String(row.data.name))+'|'+identifier(row.data as {mac_address:string;mac_mode:string});duplicates.set(key,(duplicates.get(key)||0)+1);const name=normalizeName(String(row.data.name)),id=identifier(row.data as {mac_address:string;mac_mode:string});names.set(name,(names.get(name)||0)+1);identifiers.set(id,(identifiers.get(id)||0)+1);}
 return Promise.all(mapped.map(async(row,index)=>{
   const result:PreviewRow={index,category:'review',data:row.data,fingerprint:''};if(row.error)return{...result,reason:row.error};
   const name=normalizeName(String(row.data.name)),key=identifier(row.data as {mac_address:string;mac_mode:string});
   if((duplicates.get(name+'|'+key)||0)>1)return{...result,reason:'Doppelte Zeile: Name und MAC-Adresse bzw. Kennung kommen mehrfach vor.'};
   if(input.mode==='existing_only')return classifyExisting(row.data,index,customers,input,names,identifiers);
   const candidates=customers.filter(c=>normalizeName(c.name)===name||identifier(c)===key),exact=candidates.filter(c=>normalizeName(c.name)===name&&identifier(c)===key);
   result.fingerprint=hash(candidates.map(c=>[c.id,c.version,c.name,c.mac_address,c.mac_mode]));
   const resolved=input.resolutions?.[String(index)];let target:Customer|undefined;
   if(resolved){target=customers.find(c=>c.id===resolved);if(!target||exact.some(c=>c.id!==target!.id))return{...result,reason:'Manuelle Zuordnung ist nicht eindeutig.'};result.fingerprint=hash([result.fingerprint,target.id,target.version]);}
   else if(exact.length===1&&candidates.length===1)target=exact[0];
   else if(candidates.length)return{...result,reason:'Nur eines der Abgleichsfelder oder mehrere Konten passen. Bitte korrigieren oder eindeutig zuordnen.'};
   if(!target)return{...result,category:'new'};
   const receipt=await get<{applied_version:number}>('SELECT applied_version FROM import_receipts WHERE profile=? AND row_hash=? AND customer_id=?','unified',hash(row.data),target.id);
   const changed=receipt?.applied_version!==target.version&&Object.entries(row.data).some(([field,value])=>field==='name'?normalizeName(target!.name)!==normalizeName(String(value)):field==='payment_status'?false:target![field as keyof Customer]!==value);
   return{...result,category:changed?'changed':'existing',customer_id:target.id,customer_number:target.customer_number,version:target.version,previous_end:target.service_end,...(Object.hasOwn(row.data,'service_end')&&target.service_end!==row.data.service_end?{end_change:target.service_end?'update' as const:'initial' as const}:{}),...(changed&&!target.service_end&&row.data.service_end?{reason:'Serviceende erstmals setzen'}:{}),...(changed&&target.service_end===row.data.service_end?{reason:'Stammdaten geändert; Serviceende bleibt gleich.'}:{})};
 }));
}
function classifyExisting(data:Record<string,unknown>,index:number,customers:Customer[],input:PreviewInput,names:Map<string,number>,identifiers:Map<string,number>):PreviewRow{
 const name=normalizeName(String(data.name)),key=identifier(data as {mac_address:string;mac_mode:string});
 const result:PreviewRow={index,category:'review',data,fingerprint:''};
 if((names.get(name)||0)>1||(identifiers.get(key)||0)>1)return{...result,reason:'Konflikt: Benutzername oder Kennung kommt mehrfach in der Datei vor.'};
 const byName=customers.filter(c=>normalizeName(c.name)===name),byId=customers.filter(c=>identifier(c)===key),candidates=customers.filter(c=>byName.includes(c)||byId.includes(c));
 result.fingerprint=hash(candidates.map(c=>[c.id,c.version,c.name,c.mac_address,c.mac_mode,c.service_end]));
 if(!candidates.length)return{...result,category:'unmatched',reason:'Kein bestehender Kunde gefunden. In diesem Modus werden keine Kunden angelegt.'};
 if(byName.length===1&&byId.length===1&&byName[0].id!==byId[0].id)return{...result,reason:'Konflikt: Name und MAC-Adresse gehören zu unterschiedlichen Kunden. Datei oder Stammdaten manuell klären.'};
 const resolved=input.resolutions?.[String(index)];
 if((byName.length>1||byId.length>1)&&!resolved)return{...result,reason:'Konflikt: Zuordnung ist mehrdeutig. Eindeutige manuelle Zuordnung oder Korrektur erforderlich.'};
 const target=resolved?candidates.find(c=>c.id===resolved):candidates[0];
 if(!target)return{...result,reason:'Konflikt: Die manuelle Zuordnung muss zu Name oder Kennung passen.'};
 if(byName.length&&byId.length&&(!byName.includes(target)||!byId.includes(target)))return{...result,reason:'Konflikt: Die gewählten Abgleichsfelder gehören nicht gemeinsam zum zugeordneten Kunden.'};
 const macChanged=identifier(target)!==key,nameChanged=normalizeName(target.name)!==name,endChanged=Object.hasOwn(data,'service_end')&&target.service_end!==data.service_end;
 const reasons=[endChanged&&!target.service_end?'Serviceende erstmals setzen':null,macChanged?'MAC-Adresse separat bestätigen oder nur das Serviceende übernehmen.':null,nameChanged?'Name separat bestätigen oder nur das Serviceende übernehmen.':null].filter(Boolean);
 return{...result,category:macChanged||nameChanged||endChanged?'changed':'existing',customer_id:target.id,customer_number:target.customer_number,version:target.version,previous_end:target.service_end,previous_mac:target.mac_address,previous_mac_mode:target.mac_mode,previous_name:target.name,requires_mac_approval:macChanged,requires_name_approval:nameChanged,...(endChanged?{end_change:target.service_end?'update' as const:'initial' as const}:{}),...(reasons.length?{reason:reasons.join(' ')}:{})};
}
export async function makePreview(raw:unknown,actor:string):Promise<Preview>{
 const input=previewInput.parse(raw),fields=Object.values(input.mapping);if(new Set(fields).size!==fields.length)fail('Ein Zielfeld darf nur einmal zugeordnet werden.');
 for(const required of ['name','mac_address'])if(!fields.includes(required as ImportField))fail('Pflichtspalten: Name und MAC-Adresse. Serviceende ist optional.');
 const rows=await classify(input),id=randomUUID();
 await run('DELETE FROM import_previews WHERE expires_at<?',Date.now()-86400000);
 await run('INSERT INTO import_previews(id,actor,payload,expires_at) VALUES(?,?,?,?)',id,actor,JSON.stringify({input,rows}),Date.now()+1800000);
 return{id,profile:'unified',mode:input.mode,rows,counts:{existing:rows.filter(r=>r.category==='existing').length,changed:rows.filter(r=>r.category==='changed').length,new:rows.filter(r=>r.category==='new').length,review:rows.filter(r=>r.category==='review').length,unmatched:rows.filter(r=>r.category==='unmatched').length}};
}
export const commitInput=z.object({preview_id:z.string().uuid(),selection:z.array(z.object({index:z.number().int().min(0),payment:z.enum(['keep','unpaid']).default('keep'),approve_mac:z.literal(true).optional(),approve_name:z.literal(true).optional(),approve_end:z.boolean().default(true)}).strict()).max(5000)}).strict();
export async function commitImport(raw:unknown,actor:string){
 const input=commitInput.parse(raw);if(new Set(input.selection.map(s=>s.index)).size!==input.selection.length)fail('Doppelte Auswahl.');
 return transaction(async()=>{
   const saved=await get<{payload:string;expires_at:number;consumed:number;result:string}>('SELECT * FROM import_previews WHERE id=? AND actor=?',input.preview_id,actor);if(!saved)fail('Vorschau nicht gefunden.',404);if(saved.consumed)return JSON.parse(saved.result);if(saved.expires_at<Date.now())fail('Vorschau abgelaufen. Bitte neu einlesen.',409);
   const payload=JSON.parse(saved.payload) as {input:PreviewInput;rows:PreviewRow[]},current=await classify(previewInput.parse(payload.input));let created=0,updated=0;
   for(const selected of input.selection){const old=payload.rows[selected.index],fresh=current[selected.index];if(!old||!fresh||!['new','changed','existing'].includes(old.category))fail('Ungeklärte Zeile darf nicht freigegeben werden.');if(JSON.stringify(old)!==JSON.stringify(fresh))fail('Daten seit der Vorschau verändert. Bitte eine neue Vorschau erstellen.',409);
     if(payload.input.mode==='existing_only'&&fresh.category==='new')fail('Dieser Import darf keine neuen Kunden anlegen.');
     let applied:Customer|undefined;
     if(fresh.category==='new'){applied=await createCustomer({...fresh.data,service_end:fresh.data.service_end??null},actor,true);created++;}
     else if(fresh.category==='changed'){
       const patch={...fresh.data};let payment=selected.payment;
       if(payload.input.mode==='existing_only'){
         for(const key of Object.keys(patch))if(!['name','mac_address','mac_mode','service_end'].includes(key))delete patch[key];
         if(!selected.approve_name||!fresh.requires_name_approval)delete patch.name;
         if(!selected.approve_mac||!fresh.requires_mac_approval){delete patch.mac_address;delete patch.mac_mode;}
         if(!selected.approve_end||!fresh.end_change)delete patch.service_end;
         if(!Object.hasOwn(patch,'service_end'))payment='keep';
       }else if(!Object.hasOwn(patch,'service_end')||fresh.previous_end===patch.service_end)payment='keep';
       if(Object.keys(patch).length){applied=await updateCustomer(fresh.customer_id!,patch,fresh.version!,actor,true,payment);updated++;}
     }
     if(applied)await run('INSERT INTO import_receipts(profile,row_hash,customer_id,applied_version) VALUES(?,?,?,?) ON CONFLICT(profile,row_hash,customer_id) DO UPDATE SET applied_version=excluded.applied_version','unified',hash(fresh.data),applied.id,applied.version);
   }
   const result={created,updated,skipped:payload.rows.length-created-updated};await audit(actor,'import.approve',input.preview_id,{selection:input.selection,result});await run('UPDATE import_previews SET consumed=1,result=? WHERE id=?',JSON.stringify(result),input.preview_id);return result;
 });
}
