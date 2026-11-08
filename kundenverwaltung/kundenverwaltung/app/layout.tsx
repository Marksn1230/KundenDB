import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Kundenraum · Dein Service. Organisiert.',description:'Kundenkonten, Servicezeiträume und Zahlungen sicher verwalten.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="de"><body>{children}</body></html>;}
