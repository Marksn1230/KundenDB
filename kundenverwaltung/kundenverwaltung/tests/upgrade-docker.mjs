// Real Docker upgrade from cb4da6b; isolated fixtures and generated credentials.
// Requires Docker Engine/Compose, registry access and Playwright Chromium.
// Re-run without --fresh to resume the same test; never use a production checkout.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHmac } from 'node:crypto';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const app = process.cwd(), repo = path.resolve(app, '../..'), record = path.join(app, '.runtime/upgrade-e2e.json');
const linux = p => process.platform === 'win32' ? '/run/desktop/mnt/host/' + p[0].toLowerCase() + p.slice(2).replaceAll('\\', '/') : p;
const run = (bin, args, options = {}) => execFileSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 240000, maxBuffer: 20 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options });
let state = fs.existsSync(record) && !process.argv.includes('--fresh') ? JSON.parse(fs.readFileSync(record, 'utf8')) : null;
function save() { fs.writeFileSync(record, JSON.stringify(state, null, 2), { mode: 0o600 }); }
if (!state) {
    const stamp = Date.now();
    state = { root: path.join(app, '.test-data', 'upgrade-' + stamp), project: 'kundenraum-upgrade-' + stamp, helper: 'kundenraum-update-helper-' + stamp, origin: 'https://upgrade-kundenraum.localhost', password: randomBytes(24).toString('base64url'), checks: [] };
    fs.mkdirSync(state.root, { recursive: true });
    state.checkout = path.join(state.root, 'repository');
    fs.mkdirSync(state.checkout);
    run('git', ['init', '--initial-branch=master', state.checkout]);
    run('git', ['-C', state.checkout, 'config', 'core.autocrlf', 'false']);
    run('git', ['-C', state.checkout, 'remote', 'add', 'origin', repo]);
    run('git', ['-C', state.checkout, 'fetch', 'origin']);
    run('git', ['-C', state.checkout, 'checkout', '-b', 'fixture-release', 'origin/master']);
    state.fixture = path.join(state.checkout, 'kundenverwaltung/kundenverwaltung');
    fs.copyFileSync('Dockerfile', path.join(state.fixture, 'Dockerfile'));
    fs.copyFileSync('scripts/update-server.sh', path.join(state.fixture, 'scripts/update-server.sh'));
    run('git', ['-C', state.checkout, 'add', 'kundenverwaltung/kundenverwaltung/Dockerfile', 'kundenverwaltung/kundenverwaltung/scripts/update-server.sh']);
    run('git', ['-C', state.checkout, '-c', 'user.name=Upgrade Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture candidate with verified permission and update fixes']);
    const release = run('git', ['-C', state.checkout, 'rev-parse', 'HEAD']).trim();
    run('git', ['-C', state.checkout, 'update-ref', 'refs/remotes/origin/master', release]);
    run('git', ['-C', state.checkout, 'checkout', '-b', 'master', 'cb4da6b']);
    state.fixture = path.join(state.checkout, 'kundenverwaltung/kundenverwaltung');
    state.native = linux(state.fixture);
    save();
}
assert.ok(state.project.startsWith('kundenraum-upgrade-'));
assert.ok(path.resolve(state.root).startsWith(path.resolve(app, '.test-data') + path.sep));
function checked(name) { if (!state.checks.includes(name))
    state.checks.push(name); save(); console.log('PASS: ' + name); }
function dc(args) { return run('docker', ['exec', '-i', '--workdir', state.native, state.helper, '/usr/local/bin/docker', 'compose', '--env-file', '.env', '-p', state.project, '-f', 'compose.server.yml', '-f', '.runtime/upgrade-test.yml', ...args]); }
function sql(service, db, query) { return dc(['exec', '-T', service, 'psql', '-U', 'postgres', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query]).trim(); }
function updater(action) { return run('docker', ['exec', '-i', '--workdir', state.native, state.helper, 'bash', '-c', 'nohup bash .runtime/update-runner.sh ' + action + ' > .runtime/update-launch.log 2>&1 < /dev/null & sleep 1; kill -HUP "$$"'], { timeout: 15000 }); }
function updateState() { const current = fs.readFileSync(path.join(state.fixture, '.runtime/server-update/current'), 'utf8').trim(); const dir = path.join(state.fixture, 'backups', path.posix.basename(current)); return { dir, status: fs.readFileSync(path.join(dir, 'status'), 'utf8').trim(), phase: fs.readFileSync(path.join(dir, 'phase'), 'utf8').trim() }; }
async function waitUpdate(want) { for (let n = 0; n < 360; n++) {
    try {
        const s = updateState();
        if (s.status === want)
            return s;
        if (s.status === 'failed' && want === 'complete')
            throw new Error('Update fehlgeschlagen in ' + s.phase + '; Protokoll: ' + path.join(s.dir, 'update.log'));
    }
    catch (e) {
        if (e.message.startsWith('Update fehlgeschlagen'))
            throw e;
    }
    await new Promise(r => setTimeout(r, 1000));
} throw new Error('Update-Test überschreitet Zeitlimit.'); }
function totp(secret) { let bits = ''; for (const c of secret.replace(/\s/g, '').toUpperCase())
    bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0'); const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2)); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const mac = createHmac('sha256', Buffer.from(bytes)).update(counter).digest(); return String((mac.readUInt32BE(mac.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0'); }
let browser;
async function login(initial = false) {
    browser ??= await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROME_BINARY || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined), args: ['--host-resolver-rules=MAP upgrade-kundenraum.localhost 127.0.0.2'] });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(state.origin + '/kunden');
    await page.locator('#username').fill('upgrade.admin');
    await page.locator('#password').fill(initial ? state.initialPassword : state.password);
    await page.locator('#kc-login').click();
    let otp = false;
    for (let n = 0; n < 6; n++) {
        await page.locator('#password-new,#totp,#otp,h1').first().waitFor({ timeout: 20000 });
        if (await page.locator('#password-new').count()) {
            await page.locator('#password-new').fill(state.password);
            await page.locator('#password-confirm').fill(state.password);
            await page.locator('input[type=submit],button[type=submit]').first().click();
        }
        else if (await page.locator('#totp').count()) {
            otp = true;
            if (await page.locator('#mode-manual').count())
                await page.locator('#mode-manual').click();
            state.secret = await page.locator('#kc-totp-secret-key').textContent();
            save();
            if (await page.locator('#userLabel').count())
                await page.locator('#userLabel').fill('Upgrade-Test');
            await page.locator('#totp').fill(totp(state.secret));
            state.lastOTP = Math.floor(Date.now() / 30000);
            await page.locator('input[type=submit],button[type=submit]').first().click();
        }
        else if (await page.locator('#otp').count()) {
            otp = true;
            if (state.lastOTP === Math.floor(Date.now() / 30000))
                await new Promise(r => setTimeout(r, 30500 - Date.now() % 30000));
            await page.locator('#otp').fill(totp(state.secret));
            state.lastOTP = Math.floor(Date.now() / 30000);
            await page.locator('input[type=submit],button[type=submit]').first().click();
        }
        else
            break;
    }
    await page.getByRole('heading', { name: 'Deine Kunden.', exact: true }).waitFor({ timeout: 20000 });
    assert.equal(otp, true);
    save();
    return page;
}
async function api(page, resource, method = 'GET', body) { return page.evaluate(async ({ resource, method, body }) => { const me = await (await fetch('/api/v1/me')).json(); const r = await fetch('/api/v1/' + resource, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.user?.csrf || '' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }, { resource, method, body }); }
try {
    if (!state.prepared) {
        run('docker', ['build', '-t', 'kundenraum-update-runner:test', '-f', 'tests/fixtures/update-runner.Dockerfile', '.']);
        fs.mkdirSync(path.join(state.fixture, '.runtime'), { recursive: true });
        let env = fs.readFileSync(path.join(state.fixture, 'deploy/.env.example'), 'utf8').replace(/GENERIEREN/g, () => randomBytes(32).toString('hex')).replace(/^APP_VERSION=.*$/m, 'APP_VERSION=upgrade-e2e').replace(/^APP_DOMAIN=.*$/m, 'APP_DOMAIN=upgrade-kundenraum.localhost').replace(/^INITIAL_ADMIN_USERNAME=.*$/m, 'INITIAL_ADMIN_USERNAME=upgrade.admin');
        const password = env.match(/^POSTGRES_PASSWORD=(.*)$/m)[1];
        env = env.replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL=postgresql://kundenraum:' + password + '@db:5432/kundenraum');
        state.initialPassword = env.match(/^INITIAL_ADMIN_PASSWORD=(.*)$/m)[1];
        fs.writeFileSync(path.join(state.fixture, '.env'), env, { mode: 0o600 });
        fs.writeFileSync(path.join(state.fixture, '.runtime/Caddyfile.test'), '{\n skip_install_trust\n}\n{$APP_DOMAIN} {\n tls internal\n import routes.caddy\n}\n');
        fs.writeFileSync(path.join(state.fixture, '.runtime/routes.test'), fs.readFileSync('deploy/routes.caddy', 'utf8').replaceAll('172.30.93.3', '172.30.95.3'));
        fs.copyFileSync('deploy/mfa-allowlist.caddy', path.join(state.fixture, '.runtime/mfa.empty'));
        fs.writeFileSync(path.join(state.fixture, '.runtime/upgrade-test.yml'), `services:\n  caddy:\n    ports: !override\n      - "127.0.0.2:80:80"\n      - "127.0.0.2:443:443"\n    volumes:\n      - ./.runtime/Caddyfile.test:/etc/caddy/Caddyfile:ro\n      - ./.runtime/routes.test:/etc/caddy/routes.caddy:ro\n      - ./.runtime/mfa.empty:/etc/caddy/mfa-allowlist.caddy:ro\n    networks:\n      default: {}\n      identity-proxy:\n        ipv4_address: 172.30.95.2\n  keycloak:\n    environment:\n      KC_PROXY_TRUSTED_ADDRESSES: 172.30.95.2\n    networks:\n      default: {}\n      identity-proxy:\n        ipv4_address: 172.30.95.3\nnetworks:\n  identity-proxy:\n    internal: true\n    ipam:\n      config: !override\n        - subnet: 172.30.95.0/29\n`);
        fs.mkdirSync(path.join(state.fixture, '.runtime/fixture-tools'));
        fs.writeFileSync(path.join(state.fixture, '.runtime/fixture-tools/docker'), `#!/usr/bin/env bash\nif [[ " $* " == *' compose '* && " $* " == *' up '* && " $* " == *' restore-db '* && -f '${state.native}/.runtime/fail-infra' ]]; then rm '${state.native}/.runtime/fail-infra'; echo 'INJECTED: infrastructure failure' >&2; exit 73; fi\nif [[ " $* " == *' run '* && " $* " == *' identity-policy '* && -f '${state.native}/.runtime/fail-policy' ]]; then rm '${state.native}/.runtime/fail-policy'; echo 'INJECTED: policy failure' >&2; exit 74; fi\nexec /usr/local/bin/docker "$@"\n`);
        run('docker', ['run', '-d', '--name', state.helper, '--network', 'bridge', '--mount', 'type=bind,source=' + state.checkout + ',target=' + linux(state.checkout), '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock', '-e', 'PATH=' + state.native + '/.runtime/fixture-tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', '--entrypoint', 'sh', 'kundenraum-update-runner:test', '-c', 'sleep infinity']);
        run('docker', ['exec', state.helper, 'chmod', '+x', state.native + '/.runtime/fixture-tools/docker']);
        state.prepared = true;
        save();
    }
    if (!state.oldBuilt) {
        console.log('START: GitHub-Altstand cb4da6b bauen');
        dc(['build', 'web']);
        state.oldBuilt = true;
        save();
    }
    if (!state.oldStarted) {
        dc(['up', '-d', '--wait', 'db', 'identity-db']);
        dc(['run', '--rm', '-T', 'migrate']);
        dc(['up', '-d', 'keycloak']);
        dc(['run', '--rm', '-T', 'bootstrap']);
        dc(['up', '-d', '--wait', 'web', 'worker', 'caddy']);
        state.oldStarted = true;
        save();
    }
    if (!state.seeded) {
        const page = await login(true);
        const result = await api(page, 'customers', 'POST', { name: 'Fiktiver Upgrade-Bestand', mac_mode: 'identifier', mac_address: 'Upgrade.Legacy.Account', phone: '+436761111111', provider: 'Art', assignee: 'Mirko', points: 9.5, package_months: 12, service_start: '2026-01-31', due_date: '2026-02-15', payment_status: 'Unbezahlt' });
        assert.equal(result.status, 201, JSON.stringify(result.data));
        state.customer = result.data;
        state.credentials = sql('identity-db', 'keycloak', "SELECT c.type,md5(c.credential_data||c.secret_data) FROM credential c JOIN user_entity u ON u.id=c.user_id WHERE u.username='upgrade.admin' ORDER BY c.type");
        state.oldDocker = run('docker', ['version', '--format', '{{.Server.Version}}']).trim();
        state.seeded = true;
        save();
        checked('GitHub-Altstand läuft mit echtem OTP-Login, Bestandskunde und historischer Zahlungsfälligkeit.');
    }
    fs.copyFileSync('scripts/update-server.sh', path.join(state.fixture, '.runtime/update-runner.sh'));
    if (!state.infraFailed) {
        fs.writeFileSync(path.join(state.fixture, '.runtime/fail-infra'), '1');
        fs.writeFileSync(path.join(state.fixture, '.runtime/fail-policy'), '1');
        try {
            updater('run');
        }
        catch { }
        const s = await waitUpdate('failed');
        assert.equal(s.phase, '06-databases');
        assert.ok(fs.existsSync(path.join(s.dir, 'db.dump')));
        assert.ok(fs.existsSync(path.join(s.dir, 'identity-db.dump')));
        state.infraFailed = true;
        save();
        checked('Eltern-Shell per HUP beendet; Hintergrundlauf erreicht protokollierten Infrastrukturfehler und erhält beide Sicherungen.');
    }
    if (!state.policyFailed) {
        try {
            updater('resume');
        }
        catch { }
        const s = await waitUpdate('failed');
        assert.equal(s.phase, '08-keycloak');
        assert.equal(sql('db', 'kundenraum', 'SELECT max(version) FROM schema_migrations'), '2');
        state.policyFailed = true;
        save();
        checked('Neue Sitzung setzt bis zum gezielten Keycloak-Fehler fort; Migration und Sicherungen bleiben erhalten.');
    }
    if (!state.complete) {
        try {
            updater('resume');
        }
        catch { }
        const s = await waitUpdate('complete');
        assert.ok(fs.existsSync(path.join(s.dir, '07-migration.done')));
        state.complete = true;
        save();
        checked('Zweite neue Sitzung setzt den echten Linux/Docker-Upgrade erfolgreich fort.');
    }
    const credentials = sql('identity-db', 'keycloak', "SELECT c.type,md5(c.credential_data||c.secret_data) FROM credential c JOIN user_entity u ON u.id=c.user_id WHERE u.username='upgrade.admin' ORDER BY c.type");
    assert.equal(credentials, state.credentials);
    assert.equal(run('docker', ['version', '--format', '{{.Server.Version}}']).trim(), state.oldDocker);
    const page = await login(false), loaded = await api(page, 'customers/' + state.customer.id);
    assert.equal(loaded.status, 200);
    for (const key of ['customer_number', 'due_date', 'service_end', 'phone', 'points', 'payment_status'])
        assert.equal(loaded.data.data[key], state.customer[key], key);
    assert.equal(loaded.data.data.payment_method, null);
    assert.equal(loaded.data.data.cashier_subject, null);
    assert.equal((await api(page, 'settings')).status, 200);
    checked('Nach Upgrade: erneuter echter Admin-/OTP-Login, unveränderte Passwörter/OTP, Kundendaten und Fälligkeit; Docker unverändert verfügbar.');
    console.log('Prüfbericht: ' + record);
}
catch (e) {
    console.error('Upgrade-Test fehlgeschlagen. Isolierter Testzustand und Protokolle bleiben unter ' + state.root);
    throw e;
}
finally {
    await browser?.close();
}
