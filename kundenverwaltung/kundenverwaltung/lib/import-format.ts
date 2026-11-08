export const importColumns=[
 {name:'Name',field:'name',required:true,format:'Name oder Benutzername'},
 {name:'MAC-Adresse',field:'mac_address',required:true,format:'MAC-Adresse oder freie Kennung; Groß-/Kleinschreibung freier Kennungen bleibt erhalten'},
 {name:'Serviceende',field:'service_end',required:true,format:'TT.MM.JJJJ oder echte Excel-Datumszelle'},
 {name:'Telefon',field:'phone',format:'Text; lokal oder international'}, {name:'Adresse',field:'address',format:'Text'},
 {name:'PLZ',field:'postal_code',format:'Text mit führenden Nullen'}, {name:'Anbieter',field:'provider',format:'Art oder 2GO'},
 {name:'Paket',field:'package_months',format:'1, 6, 7, 12 oder 14 (Monate)'}, {name:'Benutzerzuordnung',field:'assignee',format:'Marko, Mirko oder Satem'},
 {name:'Punkte',field:'points',format:'Dezimalzahl, Komma oder Punkt'}, {name:'Servicebeginn',field:'service_start',format:'TT.MM.JJJJ oder Excel-Datum'},
 {name:'Zahlungsfälligkeit',field:'due_date',format:'TT.MM.JJJJ oder Excel-Datum'}, {name:'Zahlungsstatus',field:'payment_status',format:'Bezahlt, Unbezahlt oder Unbekannt; für neue Konten'},
 {name:'Kommentar',field:'comment',format:'Mehrzeiliger Text'}, {name:'MAC-Format',field:'mac_mode',format:'MAC oder Kennung; leer = automatisch erkennen'}
] as const;
