import { createCustomer } from '../lib/customers';
import { audit, get, transaction } from '../lib/db';
import { addDays, today } from '../lib/domain';
if (!process.argv.includes('--fictional-only'))
    throw new Error('Bitte ausdrücklich mit --fictional-only starten.');
await transaction(async () => {
    for (let i = 0; i < 18; i++) {
        const name = ['demo.alpen', 'demo.nord', 'demo.sonne', 'demo.mond', 'demo.wald', 'demo.hafen'][i % 6] + '.' + (i + 1);
        if (await get('SELECT id FROM customers WHERE name=?', name))
            continue;
        await createCustomer({ name, mac_address: `02:00:00:00:00:${(i + 1).toString(16).padStart(2, '0')}`, provider: i % 2 ? 'Art' : '2GO', assignee: (['Marko', 'Mirko', 'Satem'] as const)[i % 3], package_months: ([1, 6, 7, 12, 14] as const)[i % 5],
            service_start: addDays(today(), -90), service_end: addDays(today(), i * 8 - 24), payment_status: (['Bezahlt', 'Unbezahlt', 'Unbekannt'] as const)[i % 3], postal_code: '01234', points: i + .5, comment: 'Fiktives Beispielkonto. Keine reale Telefonnummer und keine Versandeinwilligung.' }, 'local-seed');
    }
    await audit('local-seed', 'seed.fictional', 'demo', {});
});
console.log('Fiktive Beispielkonten angelegt (wiederholbar, ohne Versandziele).');
