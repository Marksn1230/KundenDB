import { appUrl, callback } from '@/lib/auth';
import { audit } from '@/lib/db';
import { AppError } from '@/lib/domain';
export const runtime = 'nodejs';
export async function GET(request: Request) {
    try {
        const destination=await callback(new URL(request.url));
        return Response.redirect(new URL(destination,appUrl()), 302);
    }
    catch (error) {
        const code = error instanceof AppError ? 'APP_' + error.status : error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'Unknown';
        const reason = error instanceof AppError ? error.message : code;
        console.error('OIDC-Anmeldung fehlgeschlagen:', code, reason);
        await audit('anonymous', 'auth.failed', 'callback', { code, reason });
        return Response.redirect(appUrl() + '/?auth_error=1', 302);
    }
}
