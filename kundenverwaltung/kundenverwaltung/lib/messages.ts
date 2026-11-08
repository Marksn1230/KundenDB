import {phoneForWhatsApp,countries} from './phone';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { all, audit, get, run, transaction } from './db';
import { customer, everyCustomer } from './customers';
import { addDays, Customer, fail, today } from './domain';
export const settingsSchema = z.object({ version: z.number().int().positive(), default_country: z.string().refine(c=>countries.some(x=>x===c),'Ungültiges Standardland.').default('AT'), whatsapp_enabled: z.boolean(), telegram_enabled: z.boolean(),
    offsets: z.array(z.number().int().min(-365).max(365)).min(1).max(12).refine(v => new Set(v).size === v.length), upcoming_days: z.number().int().min(1).max(90), telegram_hour: z.number().int().min(0).max(23) }).strict();
export type Settings = z.infer<typeof settingsSchema> & {
    last_telegram_date: string | null;
};
export async function settings(): Promise<Settings> {
    const s = (await get<Record<string, unknown>>('SELECT * FROM integration_settings WHERE id=1'))!;
    return { version: Number(s.version), default_country: String(s.default_country), whatsapp_enabled: Boolean(s.whatsapp_enabled), telegram_enabled: Boolean(s.telegram_enabled), offsets: JSON.parse(String(s.offsets)), upcoming_days: Number(s.upcoming_days), telegram_hour: Number(s.telegram_hour), last_telegram_date: s.last_telegram_date as string | null };
}
export async function saveSettings(input: unknown, actor: string) {
    const data = settingsSchema.parse(input);
    return await transaction(async () => {
        if ((await settings()).version !== data.version)
            fail('Einstellungen wurden inzwischen geändert.', 409);
        await run('UPDATE integration_settings SET whatsapp_enabled=?,telegram_enabled=?,offsets=?,upcoming_days=?,telegram_hour=?,default_country=?,version=version+1 WHERE id=1', data.whatsapp_enabled ? 1 : 0, data.telegram_enabled ? 1 : 0, JSON.stringify(data.offsets), data.upcoming_days, data.telegram_hour, data.default_country);
        await audit(actor, 'integrations.update', '1', data);
        return await settings();
    });
}
export function whatsappConfigured(){return Boolean(process.env.WHATSAPP_TOKEN&&process.env.WHATSAPP_PHONE_ID&&process.env.WHATSAPP_TEMPLATE&&process.env.WHATSAPP_API_VERSION);}
export async function whatsappEligibility(c:Customer){
 const config=await settings();
 if(!config.whatsapp_enabled)return{eligible:false,reason:'Produktivversand ist ausgeschaltet.'};
 if(!whatsappConfigured())return{eligible:false,reason:'WhatsApp-Versandkonfiguration fehlt.'};
 if(!c.service_end)return{eligible:false,reason:'Serviceende fehlt.'};
 if(!c.consent||!c.consent_at||!c.consent_note)return{eligible:false,reason:'Dokumentierte Einwilligung fehlt.'};
 try{return{eligible:true,target:phoneForWhatsApp(c.phone,config.default_country)};}
 catch(e){return{eligible:false,reason:e instanceof Error?e.message:'Telefonnummer ist nicht eindeutig verarbeitbar.'};}
}
export async function notificationTarget(c:Customer,mode:'test'|'production',testNumber=process.env.WHATSAPP_TEST_NUMBER){
 const config=await settings();
 if(mode==='test'){if(!testNumber)fail('Feste Testnummer ist nicht konfiguriert.',503);return phoneForWhatsApp(testNumber,config.default_country);}
 if(!config.whatsapp_enabled||!c.consent||!c.consent_at||!c.consent_note)fail('Produktivversand oder Einwilligung fehlt.',409);
 return phoneForWhatsApp(c.phone,config.default_country);
}
export function messagePreview(c?: Customer) {
    const name = c?.name || 'Testkonto', end = c?.service_end || addDays(today(), 7), number = c?.customer_number || 'TEST01';
    return { name, service_end: end, customer_number: number, text: `Hallo ${name}, dein Servicekonto ${number} läuft am ${end.split('-').reverse().join('.')} ab. Bitte melde dich für eine Verlängerung.` };
}
type Transport = (url: string, init: RequestInit) => Promise<Response>;
export async function sendWhatsApp(id: number | null, mode: 'test' | 'production', offset = 0, actor = 'scheduler', transport: Transport = fetch, manual?: {batch_id:string;version:number;service_end:string}) {
    const initial = id === null ? undefined : await customer(id);
    if (mode === 'production' && !initial?.service_end)
        fail('Serviceende fehlt.');
    const preview = messagePreview(mode === 'test' ? undefined : initial);
    const target = await notificationTarget(initial || {} as Customer, mode);
    const token = process.env.WHATSAPP_TOKEN, sender = process.env.WHATSAPP_PHONE_ID, template = process.env.WHATSAPP_TEMPLATE;
    if (!token || !sender || !template || !process.env.WHATSAPP_API_VERSION)
        fail('WhatsApp-Zugangsdaten und freigegebene Vorlage fehlen.', 503);
    if(manual && (initial?.version!==manual.version||initial?.service_end!==manual.service_end))fail('Datensatz wurde seit der Vorschau geändert.',409);
    const key = mode === 'test' ? 'wa:test:' + randomUUID() : manual ? `wa:manual:${manual.batch_id}:${id}:${initial!.service_end}` : `wa:${id}:${initial!.service_end}:${offset}`;
    const claimed = await transaction(async () => {
        if (await get('SELECT id FROM deliveries WHERE dedupe_key=?', key))
            return false;
        await run('INSERT INTO deliveries(channel,dedupe_key,customer_id,service_end,offset_days,mode,status) VALUES(?,?,?,?,?,?,?)', 'whatsapp', key, id, preview.service_end, offset, mode, 'processing');
        await audit(actor, 'whatsapp.claim', key, { mode, customer_id: id });
        return true;
    });
    if (!claimed)
        return { status: 'skipped' };
    try {
        // Final gate directly before the outbound request, using current persisted data.
        if (mode === 'production') {
            const current = await customer(id!);
            if (await notificationTarget(current, mode) !== target || current.service_end !== initial!.service_end || current.version !== initial!.version || (!manual && addDays(current.service_end!, offset) !== today())) {
                await run("UPDATE deliveries SET status='cancelled' WHERE dedupe_key=?", key);
                return { status: 'cancelled' };
            }
        }
        const response = await transport(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION}/${encodeURIComponent(sender)}/messages`, {
            method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
            body: JSON.stringify({ messaging_product: 'whatsapp', to: target.replace('+', ''), type: 'template', template: { name: template, language: { code: process.env.WHATSAPP_LANGUAGE || 'de' }, components: [{ type: 'body', parameters: [preview.name, preview.customer_number, preview.service_end.split('-').reverse().join('.')].map(text => ({ type: 'text', text })) }] } }),
        });
        if (!response.ok) {
            await run("UPDATE deliveries SET status='failed' WHERE dedupe_key=?", key);
            await audit(actor, 'whatsapp.failed', key, { http_status: response.status });
            return { status: 'failed' };
        }
        const data = await response.json();
        const providerId = data.messages?.[0]?.id;
        await run('UPDATE deliveries SET status=?,provider_id=? WHERE dedupe_key=?', providerId ? 'accepted' : 'unknown', providerId || null, key);
        await audit(actor, 'whatsapp.result', key, { status: providerId ? 'accepted' : 'unknown' });
        return { status: providerId ? 'accepted' : 'unknown' };
    }
    catch {
        await run("UPDATE deliveries SET status='unknown' WHERE dedupe_key=?", key);
        await audit(actor, 'whatsapp.unknown', key, {});
        return { status: 'unknown' };
    }
}
export async function telegramPreview(now = today()) {
    const s = await settings(), customers = await everyCustomer(), last = s.last_telegram_date || addDays(now, -1);
    const groups = [
        ['Läuft demnächst ab', customers.filter(c => c.service_end && c.service_end > now && c.service_end <= addDays(now, s.upcoming_days))],
        ['Läuft heute ab', customers.filter(c => c.service_end === now)],
        ['Seit dem letzten Bericht abgelaufen', customers.filter(c => c.service_end && c.service_end >= last && c.service_end < now)],
    ] as [
        string,
        Customer[]
    ][];
    return `Kundenraum · ${now.split('-').reverse().join('.')}\n\n` + groups.map(([label, rows]) => label + ` (${rows.length})\n` + (rows.map(c => `${c.customer_number} · ${c.name} · ${c.provider || 'zu ergänzen'} · ${c.service_end!.split('-').reverse().join('.')}`).join('\n') || 'Keine Konten')).join('\n\n');
}
function chunks(text: string, length = 3500) {
    const lines = text.split('\n'), result: string[] = [];
    let current = '';
    for (const line of lines) {
        if (current.length + line.length + 1 > length) {
            result.push(current);
            current = '';
        }
        current += line + '\n';
    }
    if (current)
        result.push(current);
    return result;
}
export async function sendTelegram(test = false, actor = 'scheduler', transport: Transport = fetch) {
    const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chat || !/^\d+$/.test(chat))
        fail('Telegram benötigt Bot-Token und private positive Chat-ID.', 503);
    const key = test ? 'tg:test:' + randomUUID() : 'tg:' + today();
    const text = test ? 'Kundenraum · Testnachricht\nDie interne Benachrichtigung ist eingerichtet.' : await telegramPreview();
    const claimed = await transaction(async () => {
        if (!test && !(await settings()).telegram_enabled)
            return false;
        if (await get('SELECT id FROM deliveries WHERE dedupe_key=?', key))
            return false;
        await run('INSERT INTO deliveries(channel,dedupe_key,mode,status) VALUES(?,?,?,?)', 'telegram', key, test ? 'test' : 'production', 'processing');
        return true;
    });
    if (!claimed)
        return { status: 'skipped' };
    try {
        for (const chunk of chunks(text)) {
            if (!test && !(await settings()).telegram_enabled) {
                await run("UPDATE deliveries SET status='cancelled' WHERE dedupe_key=?", key);
                return { status: 'cancelled' };
            }
            const response = await transport(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: chunk, disable_web_page_preview: true }), signal: AbortSignal.timeout(20000) });
            const body = await response.json();
            if (!response.ok || !body.ok)
                throw new Error('telegram');
        }
        await run("UPDATE deliveries SET status='accepted' WHERE dedupe_key=?", key);
        if (!test)
            await run('UPDATE integration_settings SET last_telegram_date=? WHERE id=1', today());
        await audit(actor, 'telegram.sent', key, { test });
        return { status: 'accepted' };
    }
    catch {
        await run("UPDATE deliveries SET status='unknown' WHERE dedupe_key=?", key);
        await audit(actor, 'telegram.unknown', key, {});
        return { status: 'unknown' };
    }
}
export async function schedulerTick() {
    // A crashed request is never automatically retried: the provider may already have accepted it.
    await run("UPDATE deliveries SET status='unknown' WHERE status='processing' AND at < ?",new Date(Date.now()-300000).toISOString());
    const s = await settings();
    if (s.whatsapp_enabled)
        for (const c of await everyCustomer()) {
            if (!c.service_end || !c.consent || !c.consent_at || !c.phone)
                continue;
            for (const offset of s.offsets)
                if (addDays(c.service_end, offset) === today()) {
                    try {
                        await sendWhatsApp(c.id, 'production', offset);
                    }
                    catch {
                        await audit('scheduler', 'whatsapp.configuration', String(c.id), { status: 'not_sent' });
                    }
                }
        }
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Vienna' }).format(new Date()));
    if (s.telegram_enabled && hour >= s.telegram_hour)
        await sendTelegram();
}
export const deliveryLog = async () => await all('SELECT * FROM deliveries ORDER BY id DESC LIMIT 200');
