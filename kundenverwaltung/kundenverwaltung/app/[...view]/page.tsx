import {protectedPage} from '@/lib/protected-page';
import {notFound} from 'next/navigation';
export default async function Page({params,searchParams}:{params:Promise<{view:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){const path='/'+(await params).view.join('/');if(!/^\/(?:kunden(?:\/[1-9]\d*)?|import|reports|einstellungen|meine-offenen-kunden)$/.test(path))notFound();return protectedPage(path,await searchParams);}
