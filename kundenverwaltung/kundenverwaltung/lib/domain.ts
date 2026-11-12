import { z } from 'zod';
export class AppError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) { super(message); }
}
export function fail(message: string, status = 400): never { throw new AppError(message, status); }
export const packages = [1, 6, 7, 12, 14] as const;
export const payments = ['Bezahlt', 'Unbezahlt', 'Unbekannt'] as const;
export type Payment = typeof payments[number];
export function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2200-12-31') return false;
  const d = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}
export const dateSchema = z.string().refine(calendarDate, 'Ungültiges Kalenderdatum (JJJJ-MM-TT).');
export function today(reference=new Date()) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(reference); }
export function addMonths(date: string, months: number) {
  if (!calendarDate(date) || !Number.isInteger(months)) fail('Ungültige Laufzeit.');
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}
export function addDays(date: string, days: number) {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function fullMonths(from: string, to: string) {
  if (from > to) return 0;
  const a = from.split('-').map(Number), b = to.split('-').map(Number);
  let n = (b[0] - a[0]) * 12 + b[1] - a[1];
  if (addMonths(from, n) > to) n--;
  return Math.max(0, n);
}
export function normalizeMac(raw: string) {
  const compact = raw.trim().replace(/[:.\-]/g, '');
  if (!/^[0-9a-f]{12}$/i.test(compact)) fail('MAC-Adresse: zwölf Hexadezimalzeichen erforderlich.');
  return compact.toUpperCase().match(/.{2}/g)!.join(':');
}
export function normalizeIdentifier(raw:string,mode:'mac'|'identifier'){
 if(mode==='mac')return normalizeMac(raw);
 const value=raw.trim();
 if(!/^[\p{L}\p{N}][\p{L}\p{N}._@:+-]{0,159}$/u.test(value))fail('Kennung muss aus Buchstaben, Ziffern und üblichen Kennungszeichen bestehen.');
 return value;
}
export function detectIdentifierMode(raw:string):'mac'|'identifier'{try{normalizeMac(raw);return 'mac';}catch{return 'identifier';}}
export const normalizeName=(s:string)=>s.trim().toLocaleLowerCase('de-DE');
export const customerSchema = z.object({
  payment_method: z.enum(['Bar','Konto']).nullable().default(null),
  payment_account: z.string().trim().max(160).default(''),
  cashier_subject: z.string().min(1).max(200).nullable().default(null),
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(50).default(''),
  postal_code: z.string().trim().max(20).default(''), address: z.string().trim().max(500).default(''),
  mac_address: z.string().trim().min(1).max(160),
  mac_mode: z.enum(['mac','identifier']).default('mac'),
  provider: z.enum(['Art', '2GO']).nullable().default(null),
  assignee: z.enum(['Marko', 'Mirko', 'Satem']).nullable().default(null),
  package_months: z.union([z.literal(1),z.literal(6),z.literal(7),z.literal(12),z.literal(14)]).nullable().default(null),
  points: z.number().finite().min(-1000000).max(1000000).nullable().default(null),
  service_start: dateSchema.nullable().default(null), service_end: dateSchema.nullable().optional(),
  due_date: dateSchema.nullable().optional(), payment_status: z.enum(payments).default('Unbekannt'),
  comment: z.string().max(10000).default(''), consent: z.boolean().default(false),
  consent_note: z.string().trim().max(1000).default(''),
}).strict();
export type CustomerInput = z.infer<typeof customerSchema>;
// Zod v4 applies defaults even within partial objects. A PATCH may only contain
// properties the caller actually sent, otherwise defaults erase persisted data.
export const customerPatchSchema=z.record(z.string(),z.unknown()).transform(raw=>{
  const parsed=customerSchema.partial().parse(raw);
  return Object.fromEntries(Object.keys(raw).map(key=>[key,parsed[key as keyof CustomerInput]]));
});
export type Customer = CustomerInput & { cashier_name?:string|null; id: number; customer_number: string; version: number; period_id: number; service_end: string | null; due_date: string | null; end_source: string; needs_completion: boolean; consent_at: string | null };
export function renewalPreview(c: Customer, start: string | undefined, months: number, now = today()) {
  const service_start = start || (c.service_end && c.service_end >= now ? c.service_end : now);
  if (!packages.includes(months as typeof packages[number])) fail('Ungültiges Paket.');
  dateSchema.parse(service_start);
  if (c.service_end && service_start < c.service_end) fail('Der neue Zeitraum darf sich nicht mit dem bisherigen überschneiden.');
  return { service_start, service_end: addMonths(service_start, months), package_months: months, due_date: addMonths(service_start, 1) };
}
