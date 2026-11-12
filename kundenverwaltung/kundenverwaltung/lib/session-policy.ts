const idleSeconds=Number(process.env.SESSION_IDLE_SECONDS||3600);
if(!Number.isInteger(idleSeconds)||idleSeconds<1)throw new Error('Ungültiges Sitzungs-Inaktivitätslimit.');
export const SESSION_IDLE_MS=idleSeconds*1000;
export function sessionExpired(session:{expires_at:number;last_activity_at:number},now=Date.now(),idle=SESSION_IDLE_MS){return session.expires_at<=now||session.last_activity_at+idle<=now;}
