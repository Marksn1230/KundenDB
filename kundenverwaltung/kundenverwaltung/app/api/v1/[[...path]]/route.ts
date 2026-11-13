import {securitySettings,saveSecuritySettings} from '@/lib/security-settings';
import {restoreAvailable,restoreTarget,uploadRestore,restoreStatus,confirmRestore} from '@/lib/restores';
import {cashierAccounts,cashierCustomers,cashierPayment,cashierComment} from '@/lib/cashiers';
import {dueCustomers} from '@/lib/due';
import {backupAvailable,startBackup,backupStatus,downloadBackup} from '@/lib/backups';
import {previewBulk,commitBulk} from '@/lib/bulk';
import {countries} from '@/lib/phone';
import { z } from 'zod';
import { authorize, configured, rateLimit, loginAccounts, logout, manageIdentity, recordActivity,requireFreshAdmin } from '@/lib/auth';
import { all, audit, get, run,withBusinessLease, businessTransaction as transaction } from '@/lib/db';
import { createCustomer, customer, filteredCustomers, renewCustomer, reports, setPayment, updateCustomer, checkVersion } from '@/lib/customers';
import { AppError, customerSchema, customerPatchSchema, dateSchema, fail, payments, renewalPreview, today } from '@/lib/domain';
import { commitImport, makePreview, readImport } from '@/lib/imports';
import { boundedBody, handle, input, json } from '@/lib/http';
import { deliveryLog, messagePreview, saveSettings, sendTelegram, sendWhatsApp, settings, telegramPreview,nextTelegramExecution } from '@/lib/messages';
import { openapi } from '@/lib/openapi';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = {
    params: Promise<{
        path?: string[];
    }>;
};
const password=z.string().min(15,'Das initiale Passwort muss mindestens 15 Zeichen lang sein.').max(128,'Das Passwort darf höchstens 128 Zeichen lang sein.');
const identityInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),username:z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9._@-]+$/,'Ungültiger Benutzername.'),name:z.string().trim().max(100).optional(),password,role:z.enum(['admin','employee','cashier'])}).strict(),
 z.object({action:z.literal('reset'),subject:z.string().min(1).max(200),password}).strict(),
 z.object({action:z.literal('active'),subject:z.string().min(1).max(200),active:z.boolean()}).strict(),
 z.object({action:z.literal('role'),subject:z.string().min(1).max(200),role:z.enum(['admin','employee','cashier'])}).strict()
]);
const filters = z.object({ q: z.string().max(200).optional(), provider: z.enum(['Art', '2GO']).optional(), assignee: z.enum(['Marko', 'Mirko', 'Satem']).optional(),
    payment_status: z.enum(payments).optional(), package_months: z.enum(['1', '6', '7', '12', '14']).optional(), year: z.string().regex(/^\d{4}$/).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(), page: z.coerce.number().int().min(1).max(100000).default(1), per_page: z.coerce.number().int().min(1).max(100).default(25), service_status: z.enum(['active', 'expired']).optional() }).strict();
async function dispatch(request: Request, context: Context) {
    return handle(async () => {
        const path = (await context.params).path || [], endpoint = path.join('/'), method = request.method, url = new URL(request.url);
        if(endpoint==='health'&&method==='GET'){try{await get('SELECT id FROM integration_settings WHERE id=1');return json({status:'ok'});}catch{return json({status:'not_ready'},503);}}
        if (endpoint === 'openapi.json' && method === 'GET')
            return json(openapi);
        if (endpoint === 'me' && method === 'GET') {
            try {
                const actor = await authorize(request);
                return json({ user: actor, configured: configured(), today: today() });
            }
            catch (e) {
                if (e instanceof AppError && e.status === 401)
                    return json({ user: null, configured: configured(), today: today() });
                throw e;
            }
        }
        const admin = ['settings', 'deliveries', 'audit', 'users', 'messages', 'backups'].includes(path[0]) || method === 'DELETE';
        let actor;
        try {
            actor = await authorize(request, admin);
        }
        catch (e) {
            if (e instanceof AppError && [401, 403].includes(e.status))
                await audit('anonymous', 'security.denied', endpoint.slice(0, 200), { status: e.status });
            throw e;
        }
        if(!['GET','HEAD','OPTIONS'].includes(method)&&!['activity','logout','backups'].includes(path[0])&&(await get<{active:number}>('SELECT active FROM maintenance WHERE id=1'))?.active)await transaction(async()=>{});
        if(endpoint==='activity'&&method==='POST'){z.object({}).strict().parse(await input(request));await recordActivity();return json({ok:true});}
        if(actor.role==='cashier'){
          if(endpoint==='logout'&&method==='POST'){await logout(request);return json({ok:true});}
          if(endpoint==='cashier/customers'&&method==='GET')return json({data:await cashierCustomers(actor)});
          if(path.length===3&&path[0]==='customers'&&path[2]==='payment'&&method==='PATCH'){
            const id=z.coerce.number().int().positive().parse(path[1]);
            const b=z.object({version:z.number().int().positive(),period_id:z.number().int().positive(),payment_status:z.literal('Bezahlt')}).strict().parse(await input(request));
            return json(await cashierPayment(actor,id,b.period_id,b.version));
          }
          if(path.length===4&&path[0]==='cashier'&&path[1]==='customers'&&path[3]==='comment'&&method==='PATCH'){const id=z.coerce.number().int().positive().parse(path[2]);const b=z.object({version:z.number().int().positive(),period_id:z.number().int().positive(),comment:z.string().max(10000)}).strict().parse(await input(request));return json(await cashierComment(actor,id,b.period_id,b.version,b.comment));}
          fail('Diese Funktion ist für Kassierer gesperrt.',403);
        }
        if(endpoint==='settings/mfa'){if(request.headers.has('authorization'))fail('IP-Freigaben benötigen eine persönliche Administratorsitzung.',403);if(method==='GET')return json(await securitySettings());if(method==='PATCH'){await rateLimit('mfa-settings:'+actor.subject,12);return json(await saveSecuritySettings(await input(request),actor.subject));}}
        if(endpoint==='cashiers'&&method==='GET')return json({data:await cashierAccounts()});
        if(path[0]==='backups'){
          if(request.headers.has('authorization'))fail('Backup-Zugriff ist ausschließlich über eine angemeldete Administratorsitzung erlaubt.',403);
          if(endpoint==='backups'&&method==='GET')return json({restore_available:restoreAvailable(),target:restoreTarget(),available:backupAvailable(),reason:backupAvailable()?null:'Diese Umgebung verwendet SQLite. Herunterladbare PostgreSQL-Backups sind im Serverbetrieb verfügbar.'});
          if(endpoint==='backups'&&method==='POST'){z.object({}).strict().parse(await input(request));await rateLimit('backup:'+actor.subject,3);return json(await startBackup(actor.subject),202);}
          if(endpoint==='backups/restore'&&method==='POST'){
            requireFreshAdmin(actor);await rateLimit('restore:'+actor.subject,3);
            const bytes=await boundedBody(request,50*1024*1024+65536);const form=await new Response(bytes.buffer as ArrayBuffer,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();const file=form.get('file');if(!(file instanceof File))fail('Backup-Datei fehlt.');return json(await uploadRestore(file,actor.subject),202);
          }
          if(path[1]==='restore'&&path.length===3&&method==='GET')return json(await restoreStatus(z.string().uuid().parse(path[2]),actor.subject));
          if(path[1]==='restore'&&path.length===4&&path[3]==='confirm'&&method==='POST'){requireFreshAdmin(actor);const b=z.object({confirm:z.literal(true),target:z.string().min(1)}).strict().parse(await input(request));return json(await confirmRestore(z.string().uuid().parse(path[2]),actor.subject,b.target),202);}
          const id=z.string().uuid().parse(path[1]);
          if(path.length===2&&method==='GET')return json(await backupStatus(id,actor.subject));
          if(path.length===3&&path[2]==='download'&&method==='GET')return downloadBackup(id,actor.subject);
        }
        if(endpoint==='bulk/preview'&&method==='POST')return json(await transaction(async()=>previewBulk(await input(request),actor.subject,actor.role==='admin')));
        if(endpoint==='bulk/commit'&&method==='POST')return json(await withBusinessLease(async()=>commitBulk(await input(request),actor.subject,actor.role==='admin')));
        if (endpoint === 'logout' && method === 'POST') {
            await logout(request);
            return json({ ok: true });
        }
        if (endpoint === 'customers' && method === 'GET') {
            const f = filters.parse(Object.fromEntries(url.searchParams));
            const list = await filteredCustomers(url.searchParams);
            return json({ data: list.slice((f.page - 1) * f.per_page, f.page * f.per_page), total: list.length, page: f.page, per_page: f.per_page });
        }
        if (endpoint === 'customers' && method === 'POST') {
            const body = customerSchema.parse(await input(request));
            return json(await transaction(async () => await createCustomer(body, actor.subject)), 201);
        }
        if(endpoint==='customers/due'&&method==='GET'){
          const query=z.object({group:z.enum(['expired','upcoming']),page:z.coerce.number().int().min(1).max(100000).default(1),per_page:z.coerce.number().int().min(1).max(100).default(10)}).strict().parse(Object.fromEntries(url.searchParams));return json(await dueCustomers(query.group,query.page,query.per_page));
        }
        if (path[0] === 'customers' && path.length >= 2) {
            const id = z.coerce.number().int().positive().parse(path[1]);
            if (path.length === 2 && method === 'GET')
                return json({ data: await customer(id), periods: await all('SELECT * FROM periods WHERE customer_id=? ORDER BY id DESC', id) });
            if (path.length === 2 && method === 'PATCH') {
                const body = z.object({ version: z.number().int().positive(), data: customerPatchSchema }).strict().parse(await input(request));
                return json(await transaction(async () => await updateCustomer(id, body.data, body.version, actor.subject)));
            }
            if (path.length === 2 && method === 'DELETE') {
                const body = z.object({ version: z.number().int().positive(), confirm: z.literal(true) }).strict().parse(await input(request));
                return json(await transaction(async () => { const c = await customer(id); checkVersion(c, body.version); await audit(actor.subject, 'customer.delete', String(id), { customer: c, periods: await all('SELECT * FROM periods WHERE customer_id=?', id) }); await run('DELETE FROM customers WHERE id=?', id); return { ok: true }; }));
            }
            if (['renew', 'renew-preview'].includes(path[2]) && method === 'POST') {
                const b = z.object({ version: z.number().int().positive(), package_months: z.number().int(), service_start: dateSchema.optional(), payment: z.enum(['keep', 'unpaid']) }).strict().parse(await input(request));
                if (path[2] === 'renew-preview')
                    return json(renewalPreview(await customer(id), b.service_start, b.package_months));
                return json(await transaction(async () => await renewCustomer(id, b.version, b.package_months, b.service_start, b.payment, actor.subject)));
            }
            if (path[2] === 'payment' && method === 'PATCH') {
                const b = z.object({ version: z.number().int().positive(), period_id: z.number().int().positive(), payment_status: z.enum(payments) }).strict().parse(await input(request));
                return json(await transaction(async () => await setPayment(id, b.period_id, b.payment_status, b.version, actor.subject)));
            }
        }
        if (endpoint === 'reports' && method === 'GET') {
            filters.parse(Object.fromEntries(url.searchParams));
            return json(await reports(url.searchParams));
        }
        if (endpoint === 'service-preview' && method === 'POST') {
            const b = z.object({ service_start: dateSchema, package_months: z.number().int() }).strict().parse(await input(request));
            return json(renewalPreview({ service_end: null } as Parameters<typeof renewalPreview>[0], b.service_start, b.package_months));
        }
        if (endpoint === 'imports/file' && method === 'POST') {
            const bytes = await boundedBody(request, 5 * 1024 * 1024 + 65536);
            const form = await new Response(bytes.buffer as ArrayBuffer, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
            const file = form.get('file');
            if (!(file instanceof File))
                fail('Datei fehlt.');
            return json(await readImport(file));
        }
        if (endpoint === 'imports/preview' && method === 'POST')
            return json(await transaction(async()=>makePreview(await input(request), actor.subject)));
        if (endpoint === 'imports/commit' && method === 'POST')
            return json(await transaction(async()=>commitImport(await input(request), actor.subject)));
        if (endpoint === 'settings' && method === 'GET')
            return json({ settings: await settings(),next_telegram_run:await nextTelegramExecution(), countries, test_number: process.env.WHATSAPP_TEST_NUMBER || null, whatsapp_ready: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_TEMPLATE && process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_API_VERSION), telegram_ready: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID), identity_admin_ready: Boolean(process.env.OIDC_ADMIN_URL) });
        if (endpoint === 'settings' && method === 'PATCH')
            return json(await saveSettings(await input(request), actor.subject));
        if (endpoint === 'messages/preview' && method === 'GET')
            return json({ whatsapp: messagePreview(), telegram: await telegramPreview() });
        if (endpoint === 'messages/whatsapp-test' && method === 'POST') {
            await input(request);
            return json(await withBusinessLease(()=>sendWhatsApp(null, 'test', 0, actor.subject)));
        }
        if (endpoint === 'messages/telegram-test' && method === 'POST') {
            await input(request);
            return json(await withBusinessLease(()=>sendTelegram(true, actor.subject)));
        }
        if (endpoint === 'deliveries' && method === 'GET')
            return json({ data: await deliveryLog() });
        if (endpoint === 'audit' && method === 'GET')
            return json({ data: await all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200') });
        if (endpoint === 'users' && method === 'GET')
            return json({ data: await loginAccounts() });
        if (endpoint === 'users' && method === 'POST')
            return json(await transaction(async()=>manageIdentity(actor, identityInput.parse(await input(request)))));
        return fail('Endpunkt oder Methode nicht gefunden.', 404);
    });
}
export { dispatch as GET, dispatch as POST, dispatch as PATCH, dispatch as DELETE };
