import {sessionExpired} from './session-policy';
import {safeReturnTo} from './return-to';
import * as oidc from 'openid-client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { all, audit, get, run, sessionTransaction as transaction } from './db';
import { fail } from './domain';
export type Actor = {
    subject: string;
    username: string;
    name: string;
    role: 'admin' | 'employee' | 'cashier';
    csrf?: string;
    authenticated_at?:number;
};
export const configured = () => Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET && process.env.SESSION_ENCRYPTION_KEY && process.env.APP_URL);
export const appUrl = () => process.env.APP_URL || 'http://localhost:3000';
const secure = () => new URL(appUrl()).protocol === 'https:';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
function encryptionKey() {
    const key = Buffer.from(process.env.SESSION_ENCRYPTION_KEY || '', 'hex');
    if (key.length !== 32)
        fail('SESSION_ENCRYPTION_KEY muss 32 zufällige Bytes als Hex enthalten.', 503);
    return key;
}
function encrypt(value: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString('base64');
}
function decrypt(value: string) {
    const b = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', encryptionKey(), b.subarray(0, 12));
    decipher.setAuthTag(b.subarray(-16));
    return Buffer.concat([decipher.update(b.subarray(12, -16)), decipher.final()]).toString();
}
let configuration: Promise<oidc.Configuration> | undefined;
export function provider() {
    if (!configured())
        fail('Die Anmeldung ist noch nicht eingerichtet. Bitte README beachten.', 503);
    const localHttp = process.env.ALLOW_LOCAL_HTTP === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(appUrl()).hostname);
    if (process.env.NODE_ENV === 'production' && !secure() && !localHttp && process.env.HTTPS_ENABLED !== 'false')
        fail('Produktivbetrieb benötigt HTTPS.', 503);
    return configuration ??= oidc.discovery(new URL(process.env.OIDC_ISSUER!), process.env.OIDC_CLIENT_ID!, process.env.OIDC_CLIENT_SECRET!, undefined, {
        ...((process.env.ALLOW_LOCAL_HTTP === 'true'||process.env.HTTPS_ENABLED==='false') ? { execute: [oidc.allowInsecureRequests] } : {}),
        [oidc.customFetch]: async (input, init) => {
            const url = new URL(input);
            if (process.env.OIDC_INTERNAL_URL && url.origin === new URL(process.env.OIDC_ISSUER!).origin) {
                const internal = new URL(process.env.OIDC_INTERNAL_URL);
                url.protocol = internal.protocol;
                url.host = internal.host;
            }
            return fetch(url, { ...init, body: init.body as BodyInit, signal: AbortSignal.timeout(15000) });
        },
    }).catch(() => {
        configuration = undefined;
        return fail('Der Anmeldedienst ist nicht erreichbar. Bitte Keycloak starten und erneut versuchen.', 503);
    });
}
export async function rateLimit(key: string, max = 20, interval = 900000) {
    await transaction(async () => {
        await run('DELETE FROM rate_limits WHERE reset_at<=?', Date.now());
        const r = await get<{
            attempts: number;
        }>('SELECT attempts FROM rate_limits WHERE key=?', key);
        if (r && r.attempts >= max)
            fail('Zu viele Versuche. Bitte später erneut versuchen.', 429);
        await run('INSERT INTO rate_limits(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=rate_limits.attempts+1', key, Date.now() + interval);
    });
}
export async function login(returnTo='/') {
    await rateLimit('login', 100);
    const config = await provider(), state = oidc.randomState(), verifier = oidc.randomPKCECodeVerifier(), nonce = oidc.randomNonce();
    await run('DELETE FROM oauth_attempts WHERE expires_at<?', Date.now());
    await run('INSERT INTO oauth_attempts(state,verifier,nonce,expires_at,return_to) VALUES(?,?,?,?,?)', state, verifier, nonce, Date.now() + 300000, safeReturnTo(returnTo));
    (await cookies()).set('kr_oauth', state, { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', maxAge: 300 });
    return oidc.buildAuthorizationUrl(config, { redirect_uri: appUrl() + '/api/auth/callback', scope: 'openid profile', state, nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', acr_values: '2' });
}
async function authenticateToken(token: string): Promise<Actor> {
    const result = await oidc.tokenIntrospection(await provider(), token);
    if (!result.active || typeof result.sub !== 'string' || typeof result.iat !== 'number') {
        console.warn('OIDC-Token abgewiesen:', JSON.stringify({ active: result.active, subject_type: typeof result.sub, issued_at_type: typeof result.iat }));
        fail('Sitzung abgelaufen.', 401);
    }
    const audience = result.aud;
    if (!(Array.isArray(audience) ? audience : [audience]).includes(process.env.OIDC_API_AUDIENCE || 'kundenraum-api'))
        fail('Ungültige Token-Zielgruppe.', 401);
    const roles = (result.realm_access as {
        roles?: string[];
    } | undefined)?.roles || [];
    const role = roles.includes('administrator') ? 'admin' : roles.includes('mitarbeiter') ? 'employee' : roles.includes('kassierer') ? 'cashier' : null;
    if (!role)
        fail('Keine Berechtigung für Kundenraum.', 403);
    if (role === 'admin' && String(result.acr) !== '2')
        fail('Administratoren benötigen Mehrfaktor-Authentifizierung (ACR 2).', 403);
    const local = await get<{
        active: number;
        not_before: number;
        role: string;
    }>('SELECT * FROM principals WHERE subject=?', result.sub);
    if (local && (!local.active || result.iat <= local.not_before))
        fail('Das Login-Konto oder diese Sitzung wurde gesperrt.', 401);
    const actor: Actor = { subject: result.sub, username: String(result.preferred_username || result.sub), name: String(result.name || result.preferred_username || 'Benutzer'), role };
    await run('INSERT INTO principals(subject,username,name,role) VALUES(?,?,?,?) ON CONFLICT(subject) DO UPDATE SET username=excluded.username,name=excluded.name,role=excluded.role', actor.subject, actor.username, actor.name, role);
    return actor;
}
export async function callback(url: URL) {
    const jar = await cookies(), state = url.searchParams.get('state');
    if (!state || jar.get('kr_oauth')?.value !== state)
        fail('Ungültiger Anmeldevorgang.', 401);
    const attempt = await transaction(async () => {
        const a = await get<{
            verifier: string;
            nonce: string;
            expires_at: number; return_to:string;
        }>('SELECT * FROM oauth_attempts WHERE state=?', state);
        await run('DELETE FROM oauth_attempts WHERE state=?', state);
        return a;
    });
    jar.delete('kr_oauth');
    if (!attempt || attempt.expires_at < Date.now())
        fail('Anmeldevorgang abgelaufen.', 401);
    // Next.js/reverse proxies may expose an internal hostname. The OAuth redirect URI
    // must be exactly the same canonical URI used in the authorization request.
    const canonical = new URL('/api/auth/callback', appUrl());
    canonical.search = url.search;
    const tokens = await oidc.authorizationCodeGrant(await provider(), canonical, { pkceCodeVerifier: attempt.verifier, expectedState: state, expectedNonce: attempt.nonce });
    const actor = await authenticateToken(tokens.access_token);
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    const seconds = 28800;
    await run('DELETE FROM web_sessions WHERE expires_at<?', Date.now());
    await run('INSERT INTO web_sessions(token_hash,subject,access_token,expires_at,csrf,refresh_token,token_expires_at,last_activity_at,authenticated_at) VALUES(?,?,?,?,?,?,?,?,?)', digest(token), actor.subject, encrypt(tokens.access_token), Date.now() + seconds * 1000, csrf,tokens.refresh_token?encrypt(tokens.refresh_token):null,Date.now()+Number(tokens.expires_in||300)*1000,Date.now(),Date.now());
    jar.set('kr_session', token, { httpOnly: true, secure: secure(), sameSite: 'strict', path: '/', maxAge: seconds });
    await audit(actor.subject, 'auth.login', actor.subject, {});
    return actor.role==='cashier'?'/meine-offenen-kunden':safeReturnTo(attempt.return_to);
}
export async function authorize(request: Request, admin = false) {
    let actor: Actor;
    const header = request.headers.get('authorization');
    if (header) {
        if (!/^Bearer \S+$/.test(header))
            fail('Bearer-Token erforderlich.', 401);
        actor = await authenticateToken(header.slice(7));
    }
    else {
        const cookie = (await cookies()).get('kr_session')?.value;
        actor=await transaction(async()=>{
          const session=cookie?await get<{access_token:string;refresh_token:string|null;csrf:string;expires_at:number;last_activity_at:number;authenticated_at:number;token_expires_at:number}>('SELECT * FROM web_sessions WHERE token_hash=?',digest(cookie)):undefined;
          if(!session||sessionExpired(session))fail('Bitte erneut anmelden.',401);
          let access=session.access_token;
          if(session.token_expires_at<=Date.now()+30000){
            if(!session.refresh_token)fail('Bitte erneut anmelden.',401);
            try{
              const tokens=await oidc.refreshTokenGrant(await provider(),decrypt(session.refresh_token));
              access=encrypt(tokens.access_token);
              await run('UPDATE web_sessions SET access_token=?,refresh_token=?,token_expires_at=? WHERE token_hash=?',access,tokens.refresh_token?encrypt(tokens.refresh_token):session.refresh_token,Date.now()+Number(tokens.expires_in||300)*1000,digest(cookie!));
            }catch{fail('Bitte erneut anmelden.',401);}
          }
          return {...await authenticateToken(decrypt(access)),csrf:session.csrf,authenticated_at:session.authenticated_at};
        });
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
            if (request.headers.get('origin') !== new URL(appUrl()).origin || request.headers.get('x-csrf-token') !== actor.csrf) {
                await audit(actor.subject, 'security.csrf', new URL(request.url).pathname, {});
                fail('CSRF-Prüfung fehlgeschlagen.', 403);
            }
        }
    }
    if (admin && actor.role !== 'admin') {
        await audit(actor.subject, 'security.forbidden', new URL(request.url).pathname, { required_role: 'admin' });
        fail('Administratorrechte erforderlich.', 403);
    }
    return actor;
}
export async function logout(request: Request) {
    const actor = await authorize(request), jar = await cookies(), token = jar.get('kr_session')?.value;
    if (token)
        await run('DELETE FROM web_sessions WHERE token_hash=?', digest(token));
    jar.delete('kr_session');
    await audit(actor.subject, 'auth.logout', actor.subject, {});
}
export async function revoke(subject: string, actor: string, active?: boolean) {
    await run('UPDATE principals SET not_before=?,active=COALESCE(?,active) WHERE subject=?', Math.floor(Date.now() / 1000), active === undefined ? null : active ? 1 : 0, subject);
    await run('DELETE FROM web_sessions WHERE subject=?', subject);
    await audit(actor, 'auth.revoke', subject, { active });
}
async function adminRequest(resource: string, method: string, body?: unknown) {
    const config = await provider();
    const token = await oidc.clientCredentialsGrant(config, { scope: 'openid kc-admin-api' });
    const base = process.env.OIDC_ADMIN_URL;
    if (!base)
        fail('OIDC_ADMIN_URL ist noch nicht konfiguriert.', 503);
    const response = await fetch(base.replace(/\/$/, '') + resource, { method, headers: { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!response.ok) { if(response.status===409)fail('Dieser Benutzername ist bereits vergeben.',409);if(response.status===400)fail('Identitätsverwaltung: Eingaben oder Passwortvorgaben bitte prüfen.',400);fail('Die Identitätsverwaltung konnte die Aktion nicht ausführen.',502); }
    return response;
}
export async function manageIdentity(actor:Actor,input:{action:string;username?:string;name?:string;password?:string;role?:'admin'|'employee'|'cashier';subject?:string;active?:boolean}){
 if(input.action==='create'){
   await rateLimit('create:'+actor.subject,20);
   const username=input.username!;
   const response=await adminRequest('/users','POST',{username,firstName:input.name||username,enabled:true,requiredActions:['UPDATE_PASSWORD'],credentials:[{type:'password',value:input.password,temporary:true}]});
   const id=response.headers.get('location')?.split('/').pop();if(!id)fail('Konto wurde angelegt; Benutzerkennung fehlt. Bitte Identitätsverwaltung prüfen.',502);
   try{const role=await(await adminRequest('/roles/'+(input.role==='admin'?'administrator':input.role==='cashier'?'kassierer':'mitarbeiter'),'GET')).json();await adminRequest('/users/'+encodeURIComponent(id)+'/role-mappings/realm','POST',[role]);}
   catch(error){await adminRequest('/users/'+encodeURIComponent(id),'PUT',{enabled:false});throw error;}
   await transaction(async()=>{await run('INSERT INTO principals(subject,username,name,role) VALUES(?,?,?,?)',id,username,input.name||username,input.role!);await audit(actor.subject,'identity.create',id,{username,role:input.role,password_change_required:true});});
   return{ok:true,subject:id};
 }
 const subject=input.subject!;
 if(subject===actor.subject&&input.action!=='reset')fail('Das eigene Administratorkonto kann hier nicht gesperrt oder in seiner Rolle geändert werden.');
 if(!await get('SELECT subject FROM principals WHERE subject=?',subject))fail('Login-Konto nicht gefunden.',404);
 if(input.action==='reset'){
   await rateLimit('reset:'+subject,3);
   await revoke(subject,actor.subject);
   await adminRequest('/users/'+encodeURIComponent(subject)+'/logout','POST');
   await adminRequest('/users/'+encodeURIComponent(subject)+'/reset-password','PUT',{type:'password',value:input.password,temporary:true});
   await audit(actor.subject,'identity.password.reset',subject,{password_change_required:true});
   return{ok:true,signed_out:subject===actor.subject};
 }
 if(input.action==='active')await adminRequest('/users/'+encodeURIComponent(subject),'PUT',{enabled:input.active});
 if(input.action==='role'){
   for(const name of ['administrator','mitarbeiter','kassierer']){const role=await(await adminRequest('/roles/'+name,'GET')).json();await adminRequest('/users/'+encodeURIComponent(subject)+'/role-mappings/realm','DELETE',[role]);}
   const role=await(await adminRequest('/roles/'+(input.role==='admin'?'administrator':input.role==='cashier'?'kassierer':'mitarbeiter'),'GET')).json();await adminRequest('/users/'+encodeURIComponent(subject)+'/role-mappings/realm','POST',[role]);
   if(input.role==='cashier'){const user=await(await adminRequest('/users/'+encodeURIComponent(subject),'GET')).json();await adminRequest('/users/'+encodeURIComponent(subject),'PUT',{requiredActions:(user.requiredActions||[]).filter((action:string)=>action!=='CONFIGURE_TOTP')});}
   await run('UPDATE principals SET role=? WHERE subject=?',input.role!,subject);await audit(actor.subject,'identity.role',subject,{role:input.role});
 }
 await revoke(subject,actor.subject,input.action==='active'?input.active:undefined);await adminRequest('/users/'+encodeURIComponent(subject)+'/logout','POST');return{ok:true};
}
export async function loginAccounts(){return all('SELECT subject,username,name,role,active FROM principals ORDER BY name');}

export async function recordActivity(){const token=(await cookies()).get('kr_session')?.value;if(token)await run('UPDATE web_sessions SET last_activity_at=? WHERE token_hash=?',Date.now(),digest(token));}
export function requireFreshAdmin(actor:Actor){if(actor.role!=='admin'||!actor.authenticated_at||Date.now()-actor.authenticated_at>5*60000)fail('Bitte für die Wiederherstellung erneut als Administrator anmelden (höchstens 5 Minuten).',403);}
