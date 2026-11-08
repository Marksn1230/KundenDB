import { NextRequest, NextResponse } from 'next/server';
export function proxy(request:NextRequest){
  const nonce=Buffer.from(crypto.randomUUID()).toString('base64');
  const csp=`default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV==='development'?" 'unsafe-eval'":''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`;
  const headers=new Headers(request.headers);headers.set('Content-Security-Policy',csp);headers.set('x-nonce',nonce);
  const response=NextResponse.next({request:{headers}});response.headers.set('Content-Security-Policy',csp);
  response.headers.set('Cache-Control','no-store');
  if(process.env.APP_URL?.startsWith('https:'))response.headers.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  return response;
}
export const config={matcher:['/','/kunden/:path*','/import','/reports','/einstellungen']};
