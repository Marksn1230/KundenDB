import fs from 'node:fs';
import ExcelJS from 'exceljs';
const columns=['Name','MAC-Adresse','Serviceende','Telefon','Adresse','PLZ','Anbieter','Paket','Benutzerzuordnung','Punkte','Servicebeginn','Zahlungsfälligkeit','Zahlungsstatus','Kommentar','MAC-Format'];
const rows=[
 ['demo.alpen','02:00:00:AA:00:01','28.02.2027','0676 1234567','Fiktive Adresse','00123','Art','1','Marko','1,5','31.01.2027','31.01.2027','Unbezahlt','Fiktives Beispiel ohne Versandeinwilligung','MAC'],
 ['demo.konto','Service.Alpha','31.12.2027','','','01234','2GO','12','Mirko','12','31.12.2026','31.12.2026','Unbekannt','Freie Kennung bleibt unverändert','Kennung']
];
fs.mkdirSync('public/examples',{recursive:true});fs.writeFileSync('public/examples/import-vorlage.csv','\uFEFF'+[columns,...rows].map(row=>row.join(';')).join('\r\n')+'\r\n');
const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Kunden');
sheet.addRow(columns);for(const row of rows)sheet.addRow(row);
sheet.getRow(1).font={bold:true};sheet.columns.forEach((column,i)=>{column.width=i===13?48:24;if([3,5].includes(i))column.numFmt='@';});
await workbook.xlsx.writeFile('public/examples/import-vorlage.xlsx');console.log('Fiktive CSV-/XLSX-Vorlagen aktualisiert.');
