import type {Currency,RateSnapshot} from './types';
const KEY='finance_rates_v1';
export const defaultRates:RateSnapshot={base:'USD',rates:{USD:1,UZS:12600,EUR:1.17,CNY:.139,GBP:1.35},updatedAt:new Date(0).toISOString()};
export async function fetchRates():Promise<RateSnapshot>{
 const url='https://open.er-api.com/v6/latest/USD';
 const r=await fetch(url); if(!r.ok) throw new Error('rates'); const j=await r.json();
 return {base:'USD',rates:{USD:1,UZS:j.rates.UZS,EUR:1/j.rates.USD,CNY:j.rates.CNY,GBP:j.rates.GBP},updatedAt:new Date().toISOString()};
}
export function loadCachedRates():RateSnapshot{try{return JSON.parse(localStorage.getItem(KEY)||'null')||defaultRates}catch{return defaultRates}}
export function saveRates(r:RateSnapshot){localStorage.setItem(KEY,JSON.stringify(r))}
export function toUsd(amount:number,currency:Currency,r:RateSnapshot){return amount/(r.rates[currency]||1)}
export function fromUsd(usd:number,currency:Currency,r:RateSnapshot){return usd*(r.rates[currency]||1)}
export function convert(amount:number,from:Currency,to:Currency,r:RateSnapshot){return fromUsd(toUsd(amount,from,r),to,r)}
