import type {AppData} from './types';
const KEY='finance_app_v1';
export const emptyData=():AppData=>({transactions:[],sources:[{id:'work',name:'Работа',category:'Основной доход',createdAt:new Date().toISOString()},{id:'freelance',name:'Freelance',category:'Дополнительный доход',createdAt:new Date().toISOString()}],goals:[],settings:{displayCurrency:'USD',baseCurrency:'USD',theme:'dark',notifications:{income:true,expense:true,goal:true,monthly:true}},rates:null});
export function loadData():AppData{try{const raw=localStorage.getItem(KEY);return raw?{...emptyData(),...JSON.parse(raw)}:emptyData()}catch{return emptyData()}}
export function saveData(d:AppData){localStorage.setItem(KEY,JSON.stringify(d))}
export function download(name:string,text:string,type='text/csv'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
