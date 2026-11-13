import { request } from 'node:http';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { Pool } from 'pg';
import { allowlistConfig, normalizeIPs } from '../lib/mfa-policy.mjs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 10000 });
const directory = process.env.MFA_POLICY_DIRECTORY || '/policy', file = directory + '/policy.caddy';
const upstream = process.env.MFA_KEYCLOAK_UPSTREAM || '172.30.93.3:8080';
const delay = ms => new Promise(r => setTimeout(r, ms));
let stopped = false;
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });
function docker(method, path, body) { return new Promise((resolve, reject) => { const req = request({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock', method, path, headers: body ? { 'Content-Type': 'application/json' } : {} }, res => { const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => { const raw = Buffer.concat(chunks); if (res.statusCode >= 300)
    return reject(new Error('Docker-Aktion fehlgeschlagen (HTTP ' + res.statusCode + ').')); try {
    resolve(raw.length ? JSON.parse(raw.toString()) : null);
}
catch {
    resolve(raw);
} }); }); req.setTimeout(90000, () => req.destroy(new Error('Docker-Zeitlimit überschritten.'))); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined); }); }
const self = await docker('GET', '/containers/' + encodeURIComponent(process.env.HOSTNAME) + '/json');
const project = self.Config.Labels['com.docker.compose.project'];
if (!project)
    throw new Error('Kein verwaltetes Compose-Projekt.');
async function container(service) { const list = await docker('GET', '/containers/json?all=1&filters=' + encodeURIComponent(JSON.stringify({ label: ['com.docker.compose.project=' + project, 'com.docker.compose.service=' + service] }))); if (list.length !== 1)
    throw new Error('Dienst ' + service + ' ist nicht eindeutig.'); return list[0].Id; }
async function execCaddy(command) { const id = await container('caddy'); const execution = await docker('POST', '/containers/' + id + '/exec', { AttachStdout: true, AttachStderr: true, Cmd: ['sh', '-eu', '-c', command] }); await docker('POST', '/exec/' + execution.Id + '/start', { Detach: false, Tty: false }); const result = await docker('GET', '/exec/' + execution.Id + '/json'); if (result.ExitCode !== 0)
    throw new Error('Caddy-Prüfung fehlgeschlagen. Bisherige Freigabe bleibt aktiv.'); }
const validate = '. /etc/caddy/domain-env.sh; configuration=/etc/caddy/Caddyfile; if [ "${HTTPS_ENABLED:-true}" = false ]; then configuration=/etc/caddy/Caddyfile.http; fi; caddy validate --config "$configuration" --adapter caddyfile';
async function writePolicy(addresses) { await writeFile(file + '.tmp', allowlistConfig(addresses, upstream), { mode: 0o644 }); await rename(file + '.tmp', file); }
async function restart() { const keycloak = await container('keycloak'), caddy = await container('caddy'); await docker('POST', '/containers/' + keycloak + '/restart?t=10'); let ready = false; for (let n = 0; n < 90 && !stopped; n++) {
    try {
        if ((await fetch('http://keycloak:8080/auth/realms/kundenraum/.well-known/openid-configuration', { signal: AbortSignal.timeout(2000) })).ok) {
            ready = true;
            break;
        }
    }
    catch { }
    await delay(1000);
} if (!ready)
    throw new Error('Keycloak wurde nicht rechtzeitig bereit.'); await docker('POST', '/containers/' + caddy + '/restart?t=10'); for (let n = 0; n < 30; n++) {
    try {
        await execCaddy('wget -q -O /dev/null http://127.0.0.1:2019/config/');
        return;
    }
    catch { }
    await delay(500);
} throw new Error('Proxy wurde nicht rechtzeitig bereit.'); }
async function audit(client, actor, action, changes) { await client.query('INSERT INTO audit_log(actor,action,entity,changes) VALUES($1,$2,$3,$4)', [actor, action, 'ip-allowlist', JSON.stringify(changes)]); }
await mkdir(directory, { recursive: true });
const bootstrap=await pool.connect();
try {
 await bootstrap.query('SELECT pg_advisory_lock(928341709)');
 let initial=[];
 try {const r=await bootstrap.query('SELECT applied_addresses FROM security_settings WHERE id=1');initial=normalizeIPs(JSON.parse(r.rows[0].applied_addresses));}catch(e){if(e.code!=='42P01')throw e;}
 await writePolicy(initial);
} finally {await bootstrap.query('SELECT pg_advisory_unlock(928341709)').catch(()=>{});bootstrap.release();}
await writeFile(directory + '/heartbeat', String(Date.now()));
while (!stopped) {
    let client, locked = false;
    try {
        client = await pool.connect();
        locked = (await client.query('SELECT pg_try_advisory_lock(928341709) AS locked')).rows[0].locked;
        if (locked) {
            const row = (await client.query("UPDATE security_settings SET status='applying' WHERE id=1 AND status IN ('queued','applying') RETURNING *")).rows[0];
            if (row) {
                const previous = normalizeIPs(JSON.parse(row.applied_addresses));
                let restarted = false;
                try {
                    const addresses = normalizeIPs(JSON.parse(row.addresses));
                    await writePolicy(addresses);
                    await execCaddy(validate);
                    restarted = true;
                    await restart();
                    await client.query('BEGIN');
                    await client.query("UPDATE security_settings SET applied_addresses=$1,applied_version=$2,status='active',error='' WHERE id=1 AND version=$2", [JSON.stringify(addresses), row.version]);
                    await audit(client, row.updated_by, 'security.mfa.applied', { addresses, version: row.version, restarted: ['keycloak', 'caddy'] });
                    await client.query('COMMIT');
                    console.log('IP-Freigabe aktiviert, Version ' + row.version);
                }
                catch (e) {
                    await client.query('ROLLBACK').catch(() => { });
                    await writePolicy(previous);
                    let rollback = true;
                    if (restarted) {
                        try {
                            await restart();
                        }
                        catch {
                            rollback = false;
                        }
                    }
                    await client.query("UPDATE security_settings SET status='failed',error=$1 WHERE id=1 AND version=$2", [(e.message + ' ' + (rollback ? 'Vorherige Freigabe wiederhergestellt.' : 'Wiederanlauf fehlgeschlagen; Administrator muss die Containerlogs prüfen.')).slice(0, 500), row.version]);
                    await audit(client, row.updated_by, 'security.mfa.failed', { version: row.version, rollback });
                    console.error('IP-Aktivierung fehlgeschlagen, Version ' + row.version);
                }
            }
        }
    }
    catch (e) {
        if (e.code !== '42P01')
            console.error('Sicherheitssteuerung wartet auf Datenbank/Docker.');
    }
    finally {
        if (locked)
            await client.query('SELECT pg_advisory_unlock(928341709)').catch(() => { });
        client?.release();
        await writeFile(directory + '/heartbeat', String(Date.now()));
    }
    await delay(1000);
}
await pool.end();
