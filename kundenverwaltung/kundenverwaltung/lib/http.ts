import { z } from 'zod';
import { AppError, fail } from './domain';
export function json(data:unknown,status=200) { return Response.json(data,{status,headers:{'Cache-Control':'no-store'}}); }
export async function boundedBody(request:Request,max=2*1024*1024) {
  if (Number(request.headers.get('content-length'))>max) fail('Anfrage zu groß.',413);
  const reader=request.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks:Uint8Array[]=[];let size=0;
  for (;;) { const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max){await reader.cancel();fail('Anfrage zu groß.',413);}chunks.push(part.value); }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export async function input(request:Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) fail('JSON erwartet.',415);
  try { return JSON.parse(new TextDecoder().decode(await boundedBody(request))); }
  catch(e) {if(e instanceof AppError)throw e;return fail('Ungültige JSON-Daten.');}
}
export async function handle(operation:()=>Promise<Response>) {
  try { return await operation(); }
  catch(e) {
    if(e instanceof AppError)return json({error:{message:e.message,details:e.details}},e.status);
    if(e instanceof z.ZodError)return json({error:{message:'Bitte Eingaben prüfen.',details:e.issues.map(i=>({field:i.path.join('.'),message:i.message}))}},400);
    // Never log provider responses, tokens, import payloads or personal fields.
    console.error('Anfrage fehlgeschlagen:',e instanceof Error?e.name:'Unknown');
    return json({error:{message:'Die Anfrage konnte nicht verarbeitet werden.'}},500);
  }
}
