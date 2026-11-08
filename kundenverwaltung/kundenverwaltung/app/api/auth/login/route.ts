import { appUrl, login } from '@/lib/auth';
import { AppError } from '@/lib/domain';
export const runtime='nodejs';
export async function GET(request:Request){
  try{return Response.redirect(await login(new URL(request.url).searchParams.get('returnTo')||'/'),302);}
  catch(error){
    const reason=error instanceof AppError&&error.status===429?'rate_limit':error instanceof AppError&&error.status===503?'provider_unavailable':'login_failed';
    console.error('Anmeldestart fehlgeschlagen:',error instanceof AppError?error.status:error instanceof Error?error.name:'Unknown');
    return Response.redirect(new URL('/?auth_error='+reason,appUrl()),302);
  }
}
