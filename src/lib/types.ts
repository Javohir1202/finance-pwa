export type Currency='USD'|'UZS'|'EUR'|'CNY'|'GBP';
export type IncomeStatus='received'|'pending';
export interface RateSnapshot{base:string;rates:Record<string,number>;updatedAt:string}
export interface Transaction{ id:string; type:'income'|'expense'; amount:number; currency:Currency; date:string; sourceId?:string; category:string; description:string; status?:IncomeStatus; recurring?:boolean; rateToUsd:number; rateToBase:number; baseAmount:number; createdAt:string }
export interface Source{ id:string; name:string; category:string; createdAt:string }
export interface Goal{ id:string; name:string; target:number; currency:Currency; progress:number; createdAt:string; deadline?:string }
export interface Settings{displayCurrency:'USD'|'UZS'; baseCurrency:'USD'|'UZS'; theme:'dark'|'light'; notifications:{income:boolean;expense:boolean;goal:boolean;monthly:boolean}}
export interface AppData{transactions:Transaction[];sources:Source[];goals:Goal[];settings:Settings;rates:RateSnapshot|null}
