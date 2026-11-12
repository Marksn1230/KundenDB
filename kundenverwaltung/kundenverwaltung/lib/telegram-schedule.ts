export type Schedule={telegram_hour:number;telegram_minute:number;telegram_second_time:string|null};
export function localClock(now:Date){const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Vienna',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);const p=Object.fromEntries(parts.map(v=>[v.type,v.value]));return{date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};}
export function telegramSlots(s:Schedule){return [{id:'1',time:String(s.telegram_hour).padStart(2,'0')+':'+String(s.telegram_minute).padStart(2,'0')},...(s.telegram_second_time?[{id:'2',time:s.telegram_second_time}]:[])];}
export function dueTelegramSlots(s:Schedule,now=new Date()){const local=localClock(now);return telegramSlots(s).filter(slot=>slot.time<=local.time).map(slot=>({...slot,date:local.date,key:'tg:'+local.date+':'+slot.id}));}
export function nextTelegramRun(s:Schedule,claimed:Set<string>,now=new Date()){
 const local=localClock(now);for(let minute=0;minute<=49*60;minute++){const instant=new Date(now.getTime()+minute*60000),clock=localClock(instant);for(const slot of telegramSlots(s))if(clock.time>=slot.time&&!claimed.has('tg:'+clock.date+':'+slot.id)&&clock.date>=local.date)return {at:instant.toISOString(),slot:slot.id,time:slot.time,timezone:'Europe/Vienna'};}return null;
}
