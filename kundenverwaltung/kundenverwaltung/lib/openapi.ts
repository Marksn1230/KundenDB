const ref=(name:string)=>({$ref:'#/components/schemas/'+name});
const str={type:'string'}, date={type:['string','null'],format:'date'}, integer={type:'integer'};
const status={type:'string',enum:['Bezahlt','Unbezahlt','Unbekannt']};
const customerProperties={name:{type:'string',minLength:1,maxLength:160},mac_address:{type:'string',example:'AA:BB:CC:DD:EE:FF'},phone:{type:'string',pattern:'^$|^\\+[1-9]\\d{6,14}$'},postal_code:str,address:str,
  provider:{type:['string','null'],enum:['Art','2GO',null]},assignee:{type:['string','null'],enum:['Marko','Mirko','Satem',null]},points:{type:['number','null']},package_months:{type:['integer','null'],enum:[1,6,7,12,14,null]},
  service_start:date,service_end:date,due_date:date,payment_status:status,comment:str,consent:{type:'boolean'},consent_note:str};
const errors=Object.fromEntries([400,401,403,404,409,413,415,429,500,502,503].map(code=>[code,{description:({400:'Validierungsfehler',401:'Anmeldung erforderlich oder Token widerrufen',403:'Berechtigung, MFA oder CSRF fehlt',404:'Nicht gefunden',409:'Versionskonflikt: neu laden / Vorschau aktualisieren',413:'Datei oder Anfrage zu groß',415:'Inhaltstyp nicht unterstützt',429:'Rate Limit',500:'Interner Fehler',502:'Integrationsfehler',503:'Konfiguration fehlt'} as Record<number,string>)[code],content:{'application/json':{schema:ref('Error')}}}]));
const body=(schema:unknown)=>({required:true,content:{'application/json':{schema}}});
const object=(properties:Record<string,unknown>,required:string[]=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const array=(items:unknown)=>({type:'array',items});
const response=(schema:unknown,description='Erfolgreich')=>({description,content:{'application/json':{schema}}});
function op(summary:string,schema:unknown,request?:unknown,admin=false){return {summary,description:admin?'Nur Administrator.':'Administrator oder Mitarbeiter. Mitarbeiter dürfen keine Konten löschen.',security:[{sessionCookie:[]},{oidc:['openid']}],...(request?{requestBody:body(request)}:{}),responses:{200:response(schema),...errors}};}
const idParam={name:'id',in:'path',required:true,schema:{type:'integer',minimum:1}};
const filterParams=[['q',str,'Suche in Kundennummer, Name, Telefon und MAC'],['provider',customerProperties.provider,'Anbieter'],['assignee',customerProperties.assignee,'Servicezuordnung, keine Rolle'],['payment_status',status,'Status des aktuellen Zeitraums'],['package_months',customerProperties.package_months,'Paket'],['year',{type:'string',pattern:'^\\d{4}$'},'Jahr des Serviceendes'],['month',{type:'integer',minimum:1,maximum:12},'Monat des Serviceendes'],['service_status',{type:'string',enum:['active','expired']},'Servicestatus'],['page',{type:'integer',minimum:1,default:1},'Seite'],['per_page',{type:'integer',minimum:1,maximum:100,default:25},'Seitengröße']].map(([name,schema,description])=>({name,in:'query',schema,description}));
const version={type:'integer',minimum:1}, selection=object({index:{type:'integer',minimum:0},payment:{type:'string',enum:['keep','unpaid'],default:'keep'}});
export const openapi={openapi:'3.1.0',info:{title:'Kundenraum API',version:'1.0.0',description:'Versionierte REST-API. Kalenderdaten sind JJJJ-MM-TT ohne Uhrzeit; Darstellung in der Weboberfläche TT.MM.JJJJ. Schreibende Cookie-Anfragen benötigen Origin=APP_URL und X-CSRF-Token aus /me. Bearer-Tokens verwenden OIDC Authorization Code + PKCE S256. Kundennummern werden nur serverseitig erzeugt. Optimistische Sperre über version. Alle Importfreigaben sind atomar. Rollen werden beim Identity Provider geprüft; Servicezuordnungen verleihen keine Rechte.'},servers:[{url:'/api/v1'}],
  components:{securitySchemes:{sessionCookie:{type:'apiKey',in:'cookie',name:'kr_session'},oidc:{type:'openIdConnect',openIdConnectUrl:'http://localhost:8080/realms/kundenraum/.well-known/openid-configuration',description:'Für Produktivsysteme durch OIDC_ISSUER + /.well-known/openid-configuration ersetzen. Native Clients: Authorization Code + PKCE S256, Zielgruppe kundenraum-api.'}},schemas:{
    CustomerInput:object(customerProperties,['name','mac_address','provider','assignee','package_months','service_start']),
    Customer:object({...customerProperties,id:integer,customer_number:{type:'string',readOnly:true,description:'Neue Konten: sechs Zeichen A–Z/0–9. Bestehende Nummern unverändert.',example:'A7K2M9'},version,period_id:integer,end_source:{type:'string',enum:['calculated','imported']},needs_completion:{type:'boolean'},consent_at:{type:['string','null'],format:'date-time'}}),
    Period:object({id:integer,customer_id:integer,service_start:date,service_end:date,package_months:customerProperties.package_months,payment_status:status,due_date:date,end_source:str,is_current:integer}),
    Error:object({error:object({message:str,details:{}},['message'])}),
    Renewal:object({version,package_months:{type:'integer',enum:[1,6,7,12,14]},service_start:{type:'string',format:'date'},payment:{type:'string',enum:['keep','unpaid']}},['version','package_months','payment']),
    RenewalPreview:object({service_start:date,service_end:date,due_date:date,package_months:customerProperties.package_months}),
    ImportRow:object({index:integer,category:{type:'string',enum:['existing','changed','new','review']},reason:str,data:object(customerProperties,[]),customer_id:integer,customer_number:str,previous_end:date,version,fingerprint:str},['index','category','data','fingerprint']),
    ImportPreview:object({id:{type:'string',format:'uuid'},profile:{type:'string',enum:['mgmt','customers']},counts:object({existing:integer,changed:integer,new:integer,review:integer}),rows:array(ref('ImportRow'))}),
    ImportRequest:object({profile:{type:'string',enum:['mgmt','customers']},rows:{type:'array',maxItems:5000,items:{type:'object',additionalProperties:str}},mapping:{type:'object',description:'Dateispalte → Zielfeld. MGMT: nur name, mac_address, service_end.',additionalProperties:{type:'string',enum:Object.keys(customerProperties).filter(k=>!k.startsWith('consent'))}},resolutions:{type:'object',description:'Optional Zeilenindex → ausdrücklich manuell gewählte interne Kunden-ID. Erzeugt eine neue Vorschau.',additionalProperties:integer}},['profile','rows','mapping']),
    Report:object({as_of:date,customers:integer,active:integer,upcoming:integer,unpaid:array(ref('UnpaidItem')),undated:array(ref('UnpaidItem')),months:array(object({month:{type:'string',example:'2026-11'},paid:integer,unpaid:integer,unknown:integer,expiries:integer,customer_ids:array(integer)}))}),
    UnpaidItem:object({id:integer,customer_id:integer,service_end:date,due_date:date,payment_status:status,customer:ref('Customer'),due_month:{type:['string','null']},full_months_overdue:{type:['integer','null']},overdue_label:str}),
    Settings:object({version,whatsapp_enabled:{type:'boolean',default:false},telegram_enabled:{type:'boolean',default:false},offsets:{type:'array',items:{type:'integer',minimum:-365,maximum:365},example:[-7,0,3]},upcoming_days:{type:'integer',minimum:1,maximum:90},telegram_hour:{type:'integer',minimum:0,maximum:23}}),
  }},paths:{
    '/me':{get:{...op('Aktueller Benutzer, CSRF-Token und Konfigurationsstatus',object({user:{type:['object','null']},configured:{type:'boolean'},today:date})),security:[]}},
    '/logout':{post:op('Websitzung beenden',object({ok:{type:'boolean'}}),object({}))},
    '/customers':{get:{...op('Kunden suchen und filtern',object({data:array(ref('Customer')),total:integer,page:integer,per_page:integer})),parameters:filterParams},post:{...op('Konto anlegen',ref('Customer'),ref('CustomerInput')),responses:{201:response(ref('Customer')),...errors}}},
    '/customers/{id}':{parameters:[idParam],get:op('Kundendetails und gesamte Servicehistorie',object({data:ref('Customer'),periods:array(ref('Period'))})),patch:op('Konto ändern; importiertes Serviceende bleibt ohne ausdrückliche Änderung erhalten',ref('Customer'),object({version,data:object(customerProperties,[])})),delete:op('Konto nach Bestätigung löschen',object({ok:{type:'boolean'}}),object({version,confirm:{const:true}}),true)},
    '/customers/{id}/renew-preview':{parameters:[idParam],post:op('Verlängerung serverseitig berechnen',ref('RenewalPreview'),ref('Renewal'))},
    '/customers/{id}/renew':{parameters:[idParam],post:op('Verlängern und bisherigen Zeitraum archivieren',ref('Customer'),ref('Renewal'))},
    '/customers/{id}/payment':{parameters:[idParam],patch:op('Zahlungsstatus eines aktuellen oder historischen Zeitraums ändern',ref('Customer'),object({version,period_id:integer,payment_status:status}))},
    '/service-preview':{post:op('Kalendermonate mit Monatsende-Kappung berechnen',ref('RenewalPreview'),object({service_start:{type:'string',format:'date'},package_months:{type:'integer',enum:[1,6,7,12,14]}}))},
    '/reports':{get:{...op('Offene Posten und Monatsauswertungen aller Zeiträume',ref('Report')),parameters:filterParams.filter(p=>['provider','assignee'].includes(String(p.name)))}},
    '/imports/file':{post:{...op('CSV/XLSX prüfen und Spalten zum Zuordnen auslesen',object({headers:array(str),rows:array({type:'object',additionalProperties:str})})),requestBody:{required:true,content:{'multipart/form-data':{schema:object({file:{type:'string',format:'binary',description:'UTF-8 CSV oder XLSX, maximal 5 MB, 5.000 Datenzeilen, 40 Spalten. Keine Formeln.'}})}}}}},
    '/imports/preview':{post:op('Schreibfreie Vorschau; 30 Minuten gültig, an Benutzer gebunden',ref('ImportPreview'),ref('ImportRequest'))},
    '/imports/commit':{post:op('Nur explizite Auswahl atomar importieren; Wiederholung derselben Freigabe idempotent',object({created:integer,updated:integer,skipped:integer}),object({preview_id:{type:'string',format:'uuid'},selection:array(selection)}))},
    '/settings':{get:op('Integrationseinstellungen lesen',{},undefined,true),patch:op('Versand und Zeitplanung konfigurieren',ref('Settings'),ref('Settings'),true)},
    '/messages/preview':{get:op('Separate Testkunden-Vorschau und Telegram-Sammelmeldung',{},undefined,true)},
    '/messages/whatsapp-test':{post:op('Testkonto ausschließlich an feste WHATSAPP_TEST_NUMBER senden',{},object({}),true)},
    '/messages/telegram-test':{post:op('Testnachricht an konfigurierte private Chat-ID',{},object({}),true)},
    '/deliveries':{get:op('Letzte 200 Versandereignisse; unknown/processing vor erneutem Versand prüfen',{},undefined,true)},
    '/audit':{get:op('Letzte 200 Audit-Ereignisse',{},undefined,true)},
    '/users':{get:op('Bekannte persönliche Login-Konten lesen',{},undefined,true)},
  }};


const spec=openapi as unknown as {components:{schemas:Record<string,any>;securitySchemes:Record<string,any>};paths:Record<string,any>};
for(const name of ['CustomerInput','Customer']){
 spec.components.schemas[name].properties.mac_mode={type:'string',enum:['mac','identifier'],default:'mac',description:'Prüfart für denselben Wert in mac_address. Freie Kennungen sind nach äußerem Trimmen case-sensitive.'};
 spec.components.schemas[name].properties.phone={type:'string',maxLength:50,description:'Lokale oder internationale Schreibweise. Standardland initial AT; gültige Nummern werden nach E.164 normalisiert. Unklare Nummern werden vor WhatsApp ausgeschlossen.'};
}
spec.components.schemas.Settings.properties.default_country={type:'string',minLength:2,maxLength:2,example:'AT',description:'ISO-Ländercode als Standard für lokale Telefonnummern.'};
spec.components.securitySchemes.oidc.openIdConnectUrl='http://localhost:3000/auth/realms/kundenraum/.well-known/openid-configuration';
spec.components.schemas.ImportRequest.properties.profile={type:'string',enum:['unified','mgmt','customers'],default:'unified',description:'Kann entfallen. Historische Profilnamen sind nur API-Kompatibilitätsaliasse derselben gemeinsamen Logik.'};
spec.components.schemas.ImportRequest.required=['rows','mapping'];
spec.components.schemas.ImportRequest.properties.mapping.additionalProperties.enum.push('mac_mode');
spec.components.schemas.ImportRequest.properties.mapping.description='Dateispalte → Zielfeld. name, mac_address und service_end sind immer erforderlich. Die Vorlage verwendet Name, MAC-Adresse, Serviceende.';
spec.components.schemas.ImportRequest.properties.modes={type:'object',additionalProperties:{type:'string',enum:['mac','identifier']},description:'Optional: Zeilenindex → ausdrücklich korrigierte Prüfart. Erzeugt eine neue Vorschau.'};
spec.components.schemas.BulkRequest=object({action:{enum:['paid','whatsapp']},customers:{type:'array',minItems:1,maxItems:500,items:object({id:integer,version})}});
spec.components.schemas.BulkResult=object({successful:integer,skipped:integer,failed:integer,entries:array(object({id:integer,status:{enum:['successful','skipped','failed']},reason:str},['id','status']))});
spec.components.schemas.BulkPreview=object({id:{type:'string',format:'uuid'},action:{enum:['paid','whatsapp']},total:integer,eligible:integer,excluded:integer,items:array(object({id:integer,version,name:str,customer_number:str,period_id:integer,service_end:date,eligible:{type:'boolean'},reason:str,phone:str,preview:{}},['id','version','name','customer_number','eligible'])),template:{}});
spec.paths['/bulk/preview']={post:op('Massenaktion schreibfrei prüfen; paid für Mitarbeiter/Administrator, whatsapp nur Administrator',ref('BulkPreview'),ref('BulkRequest'))};
spec.paths['/bulk/commit']={post:op('Freigabe bestätigen: aktueller Zeitraum, serverseitige Rollenprüfung, Einzelresultate; identische batch_id wird nicht erneut ausgeführt',ref('BulkResult'),object({batch_id:{type:'string',format:'uuid'},confirm:{const:true}}))};
const initialPassword={type:'string',minLength:15,maxLength:128,writeOnly:true,description:'Temporäres Passwort ausschließlich an den Identity Provider; Änderung bei nächster Anmeldung, niemals Teil einer Antwort oder eines Audit-Logs.'};
spec.paths['/users'].post=op('Benutzer anlegen, Passwort neu setzen, Rolle ändern oder Konto sperren',object({ok:{type:'boolean'},subject:str,signed_out:{type:'boolean'}},['ok']),{oneOf:[
 object({action:{const:'create'},username:{type:'string',minLength:3,maxLength:64},name:str,password:initialPassword,role:{enum:['admin','employee']}},['action','username','password','role']),
 object({action:{const:'reset'},subject:str,password:initialPassword}),
 object({action:{const:'active'},subject:str,active:{type:'boolean'}}),
 object({action:{const:'role'},subject:str,role:{enum:['admin','employee']}})
]},true);
spec.paths['/health']={get:{summary:'Betriebsbereitschaft ohne Kundendaten',security:[],responses:{200:response(object({status:{const:'ok'}})),503:response(object({status:{const:'not_ready'}}),'Migration oder Datenbank nicht bereit')}}};

spec.components.schemas.ImportPreview.properties.profile={type:'string',enum:['unified','mgmt','customers']};
spec.components.schemas.Customer.required.push('mac_mode');
spec.components.schemas.Settings.required.push('default_country');

Object.assign(spec.components.schemas.UnpaidItem.properties,spec.components.schemas.Period.properties);
spec.components.schemas.Report.properties.periods=array(object({...spec.components.schemas.Period.properties,customer:ref('Customer')}));
spec.components.schemas.Report.required.push('periods');

spec.components.schemas.ImportRequest.properties.mode={type:'string',enum:['all','existing_only'],default:'all',description:'existing_only aktualisiert ausschließlich vorhandene Konten anhand des Benutzernamens. Keine Neuanlagen; Kennungswechsel brauchen approve_mac pro Zeile.'};
spec.components.schemas.ImportPreview.properties.mode={type:'string',enum:['all','existing_only']};
spec.components.schemas.ImportPreview.required.push('mode');
spec.components.schemas.ImportPreview.properties.counts.properties.unmatched=integer;
spec.components.schemas.ImportPreview.properties.counts.required.push('unmatched');
spec.components.schemas.ImportRow.properties.category.enum.push('unmatched');
Object.assign(spec.components.schemas.ImportRow.properties,{previous_mac:str,previous_mac_mode:{enum:['mac','identifier']},requires_mac_approval:{type:'boolean'}});
spec.paths['/imports/commit'].post.requestBody.content['application/json'].schema.properties.selection.items.properties.approve_mac={const:true,description:'Nur explizit für diese Zeile bestätigen. Bei abweichender Kennung im Aktualisierungsmodus zwingend.'};
const backupJob=object({id:{type:'string',format:'uuid'},status:{enum:['running','ready','failed','downloading']},filename:str,expires_at:{type:'string',format:'date-time'},bytes:integer,error:str},['id','status','filename','expires_at']);
spec.components.schemas.BackupJob=backupJob;
spec.paths['/backups']={
 get:{...op('Backup-Verfügbarkeit; nur persönliche Administratorsitzung',object({available:{type:'boolean'},reason:{type:['string','null']}}),undefined,true),security:[{sessionCookie:[]}]},
 post:{...op('PostgreSQL-Dump asynchron erstellen; höchstens 3/15 Minuten pro Administrator',ref('BackupJob'),object({}),true),security:[{sessionCookie:[]}],responses:{202:response(ref('BackupJob'),'Backup gestartet'),...errors}}
};
spec.paths['/backups/{backup_id}']={parameters:[{name:'backup_id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],get:{...op('Status ausschließlich für erstellenden Administrator',ref('BackupJob'),undefined,true),security:[{sessionCookie:[]}]}};
spec.paths['/backups/{backup_id}/download']={parameters:[{name:'backup_id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],get:{summary:'Einmaliger geschützter PostgreSQL-Custom-Dump-Download; Datei anschließend entfernen',security:[{sessionCookie:[]}],responses:{200:{description:'Dump für pg_restore; Dateiname über Content-Disposition',content:{'application/octet-stream':{schema:{type:'string',format:'binary'}}}},...errors}}};

spec.components.schemas.ImportRequest.properties.mapping.description='Dateispalte → Zielfeld. name und mac_address sind erforderlich; service_end ist optional. Fehlendes/leeres Datum erhält vorhandene Enddaten.';
spec.components.schemas.ImportRequest.properties.mode.description='all: Name und Kennung gemeinsam; existing_only: vorhandene Konten auch über eindeutigen Einzelfeldtreffer prüfen. Datum, Name und MAC sind unabhängig freigebbar. Keine Neuanlagen in existing_only.';
Object.assign(spec.components.schemas.ImportRow.properties,{previous_name:str,requires_name_approval:{type:'boolean'},end_change:{type:'string',enum:['initial','update'],description:'initial: Serviceende erstmals setzen; update: vorhandenes Ende ändern.'}});
const importSelection=spec.paths['/imports/commit'].post.requestBody.content['application/json'].schema.properties.selection.items;
importSelection.required=['index'];
importSelection.properties.approve_mac={const:true,description:'Nur die vorgeschlagene MAC-/Kennungsänderung freigeben. Ohne Zustimmung bleibt die gespeicherte Kennung erhalten.'};
importSelection.properties.approve_name={const:true,description:'Nur die vorgeschlagene Namensänderung freigeben. Ohne Zustimmung bleibt der gespeicherte Name erhalten.'};
importSelection.properties.approve_end={type:'boolean',default:true,description:'Gültiges, tatsächlich geändertes Enddatum übernehmen. false erlaubt eine reine Namens-/Kennungsfreigabe. Fehlende oder leere Importdaten löschen kein Datum.'};
spec.components.schemas.DuePage=object({as_of:date,through:date,group:{type:'string',enum:['expired','upcoming']},total:integer,page:integer,per_page:integer,data:array(ref('Customer'))});
spec.paths['/customers/due']={get:{...op('Aktuelle Services: alle abgelaufenen oder heute bis einschließlich 15 Kalendertage, Europe/Vienna',ref('DuePage')),parameters:[{name:'group',in:'query',required:true,schema:{type:'string',enum:['expired','upcoming']}},{name:'page',in:'query',schema:{type:'integer',minimum:1,default:1}},{name:'per_page',in:'query',schema:{type:'integer',minimum:1,maximum:100,default:10}}]}};
