import {protectedPage} from '@/lib/protected-page';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){return protectedPage('/',await searchParams);}
