import { supabase } from './supabase';
import type { AppData, Transaction, Source, Goal, Currency } from './types';

function txToDb(userId: string, t: Transaction) {
  return {
    id: t.id,
    user_id: userId,
    type: t.type,
    amount: t.amount,
    currency: t.currency,
    date: t.date,
    source_id: t.sourceId || null,
    category: t.category,
    description: t.description || '',
    status: t.status || null,
    recurring: !!t.recurring,
    rate_to_usd: t.rateToUsd,
    rate_to_base: t.rateToBase,
    base_amount: t.baseAmount,
    created_at: t.createdAt,
  };
}
function txFromDb(r: any): Transaction {
  return {
    id: r.id,
    type: r.type,
    amount: Number(r.amount),
    currency: r.currency,
    date: r.date,
    sourceId: r.source_id || undefined,
    category: r.category,
    description: r.description || '',
    status: r.status || undefined,
    recurring: !!r.recurring,
    rateToUsd: Number(r.rate_to_usd),
    rateToBase: Number(r.rate_to_base),
    baseAmount: Number(r.base_amount),
    createdAt: r.created_at,
  };
}
function sourceToDb(userId: string, s: Source) {
  return { id: s.id, user_id: userId, name: s.name, category: s.category, created_at: s.createdAt };
}
function sourceFromDb(r: any): Source {
  return { id: r.id, name: r.name, category: r.category, createdAt: r.created_at };
}
function goalToDb(userId: string, g: Goal) {
  return {
    id: g.id,
    user_id: userId,
    name: g.name,
    target: g.target,
    currency: g.currency,
    progress: g.progress,
    deadline: g.deadline || null,
    created_at: g.createdAt,
  };
}
function goalFromDb(r: any): Goal {
  return {
    id: r.id,
    name: r.name,
    target: Number(r.target),
    currency: r.currency,
    progress: Number(r.progress),
    deadline: r.deadline || undefined,
    createdAt: r.created_at,
  };
}

export async function fetchAllRemote(userId: string): Promise<{
  transactions: Transaction[];
  sources: Source[];
  goals: Goal[];
  profile: any;
}> {
  const [tx, src, goals, profile] = await Promise.all([
    supabase!.from('transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase!.from('sources').select('*').eq('user_id', userId),
    supabase!.from('goals').select('*').eq('user_id', userId),
    supabase!.from('profiles').select('*').eq('id', userId).maybeSingle(),
  ]);
  return {
    transactions: (tx.data || []).map(txFromDb),
    sources: (src.data || []).map(sourceFromDb),
    goals: (goals.data || []).map(goalFromDb),
    profile: profile.data,
  };
}

export async function upsertTransactionRemote(userId: string, t: Transaction) {
  await supabase!.from('transactions').upsert(txToDb(userId, t));
}
export async function deleteTransactionRemote(id: string) {
  await supabase!.from('transactions').delete().eq('id', id);
}
export async function upsertSourceRemote(userId: string, s: Source) {
  await supabase!.from('sources').upsert(sourceToDb(userId, s));
}
export async function upsertGoalRemote(userId: string, g: Goal) {
  await supabase!.from('goals').upsert(goalToDb(userId, g));
}
export async function updateProfileRemote(
  userId: string,
  patch: Partial<{ base_currency: Currency; display_currency: Currency; theme: string }>
) {
  await supabase!.from('profiles').update(patch).eq('id', userId);
}
export async function linkTelegramRemote(code: string): Promise<boolean> {
  const { data, error } = await supabase!.rpc('link_telegram', { p_code: code });
  if (error) throw error;
  return !!data;
}
export async function unlinkTelegramRemote(userId: string) {
  await supabase!.from('profiles').update({ telegram_user_id: null }).eq('id', userId);
}
