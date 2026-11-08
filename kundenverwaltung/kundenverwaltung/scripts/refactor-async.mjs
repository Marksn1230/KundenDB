import fs from 'node:fs';
import ts from 'typescript';
const names=new Set(['get','all','run','audit','transaction','atomic','customer','everyCustomer','customerNumber','checkIdentity','insertPeriod','createCustomer','updateCustomer','renewCustomer','setPayment','filteredCustomers','reports','classify','makePreview','commitImport','settings','saveSettings','notificationTarget','telegramPreview','rateLimit','revoke','loginAccounts','deliveryLog','make']);
function hasAwait(node){if(!node)return false;let found=false;function visit(n){if(n!==node&&(ts.isFunctionDeclaration(n)||ts.isArrowFunction(n)||ts.isFunctionExpression(n)))return;if(ts.isAwaitExpression(n))found=true;ts.forEachChild(n,visit);}visit(node);return found;}
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
const files=['lib/imports.ts','lib/messages.ts','lib/auth.ts','app/api/v1/[[...path]]/route.ts','app/api/auth/callback/route.ts','scripts/seed.ts','scripts/worker.ts','tests/domain.test.ts','tests/migration.test.ts'];
for(const file of files){
 const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const result=ts.transform(source,[context=>{const f=context.factory;
 function visitor(node){
   let updated=ts.visitEachChild(node,visitor,context);
   if(ts.isCallExpression(updated)&&ts.isPropertyAccessExpression(updated.expression)&&ts.isIdentifier(updated.expression.expression)&&updated.expression.expression.text==='assert'&&updated.expression.name.text==='throws'&&updated.arguments[0]&&hasAwait(updated.arguments[0])){
     updated=f.updateCallExpression(updated,f.createPropertyAccessExpression(f.createIdentifier('assert'),'rejects'),undefined,updated.arguments);return f.createAwaitExpression(updated);
   }
   if(ts.isFunctionDeclaration(updated)&&(names.has(updated.name?.text)||hasAwait(updated.body))){
     if(!updated.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))updated=f.updateFunctionDeclaration(updated,[...(updated.modifiers||[]),f.createModifier(ts.SyntaxKind.AsyncKeyword)],updated.asteriskToken,updated.name,updated.typeParameters,updated.parameters,updated.type,updated.body);
   }else if(ts.isArrowFunction(updated)&&hasAwait(updated.body)){
     if(!updated.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))updated=f.updateArrowFunction(updated,[f.createModifier(ts.SyntaxKind.AsyncKeyword)],updated.typeParameters,updated.parameters,updated.type,updated.equalsGreaterThanToken,updated.body);
   }else if(ts.isFunctionExpression(updated)&&hasAwait(updated.body)){
     if(!updated.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))updated=f.updateFunctionExpression(updated,[f.createModifier(ts.SyntaxKind.AsyncKeyword)],updated.asteriskToken,updated.name,updated.typeParameters,updated.parameters,updated.type,updated.body);
   }
   if(ts.isCallExpression(updated)&&ts.isIdentifier(updated.expression)&&names.has(updated.expression.text)&&!ts.isAwaitExpression(node.parent))return f.createAwaitExpression(updated);
   return updated;
 }return node=>ts.visitNode(node,visitor);}]);
 fs.writeFileSync(file,printer.printFile(result.transformed[0]));result.dispose();
}
