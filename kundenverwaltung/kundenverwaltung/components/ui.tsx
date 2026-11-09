'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {Users,X} from 'lucide-react';
import type {Payment} from '@/lib/domain';
export const fmt=(date:string|null|undefined)=>date?date.split('-').reverse().join('.'):'—';
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:string}){return <span className={'badge '+tone}><span className="badge-dot"/>{children}</span>;}
export function PaymentBadge({value}:{value:Payment}){return <Badge tone={value==='Bezahlt'?'success':value==='Unbezahlt'?'danger':'neutral'}>{value}</Badge>;}
export function ServiceBadge({date,now}:{date:string|null;now:string}){return <Badge tone={!date?'neutral':date<now?'danger':date===now?'warning':'success'}>{!date?'Serviceende fehlt':date<now?'Abgelaufen':date===now?'Läuft heute ab':'Aktiv'}</Badge>;}
export function Empty({title,text,action}:{title:string;text:string;action?:ReactNode}){return <div className="empty"><div className="empty-icon"><Users size={27}/></div><h3>{title}</h3><p>{text}</p>{action}</div>;}
export function Field({label,children,hint,wide=false}:{label:string;children:ReactNode;hint?:string;wide?:boolean}){return <label className={'field '+(wide?'wide':'')}><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
export function Modal({title,subtitle,children,onClose,wide=false}:{title:string;subtitle?:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const prev=document.activeElement as HTMLElement;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';ref.current?.focus();return()=>{document.body.style.overflow=overflow;prev?.focus();};},[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className={'modal '+(wide?'modal-wide':'')} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onKeyDown={e=>{
    if(e.key==='Escape')onClose();if(e.key==='Tab'){const els=ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]');if(els?.length){const first=els[0],last=els[els.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}
  }}><div className="modal-heading"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button" aria-label="Schließen" onClick={onClose}><X size={21}/></button></div>{children}</div></div>;
}
