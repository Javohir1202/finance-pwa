import type {Currency} from './types';
export function fmt(n:number,c:Currency){const value=Math.round(n);if(c==='USD')return `$${new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value)}`;if(c==='UZS')return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(value)} UZS`;return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n)} ${c}`}
export function dateLabel(s:string){return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short'}).format(new Date(s+'T00:00:00'))}
export function monthLabel(s:string){return new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(new Date(s+'-01T00:00:00'))}
export const uid=()=>crypto.randomUUID();
