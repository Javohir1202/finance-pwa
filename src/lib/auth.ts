import { supabase, isSupabaseConfigured } from './supabase';

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (session: any) => void) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithEmail(email: string) {
  if (!supabase) throw new Error('Supabase не настроен');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}

export { isSupabaseConfigured };
