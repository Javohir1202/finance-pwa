import { createClient } from '@supabase/supabase-js';
import { fetchRates, toUsd, fromUsd, defaultRates } from '../src/lib/currency.js';
import { fmt } from '../src/lib/format.js';
import type { Currency } from '../src/lib/types.js';

// Server-only secrets. Never prefixed with VITE_, so Vite never bundles them into the browser.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN as string;
const APP_URL = process.env.APP_URL || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL as string;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

// service_role bypasses Row Level Security — that's intentional and safe here because every
// query below is explicitly scoped to a single user_id resolved from the Telegram chat id.
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

type Profile = { id: string; base_currency: Currency; display_currency: Currency };

async function tg(method: string, body: any) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}
const sendMessage = (chatId: number, text: string, extra: any = {}) =>
  tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
const answerCallback = (id: string, text?: string) => tg('answerCallbackQuery', { callback_query_id: id, text });

const MAIN_KEYBOARD = {
  keyboard: [
    ['💰 Доход', '💸 Расход'],
    ['📊 Статистика', '📅 Сегодня'],
    ['📅 Этот месяц', '🎯 Цели'],
    ['💼 Источники', '📱 Открыть приложение'],
    ['⚙️ Настройки'],
  ],
  resize_keyboard: true,
};

// Simple keyword -> category matcher for fast expense entry ("-120000 еда").
// Extend this map freely; it's the easiest lever for improving parsing quality.
const CATEGORY_KEYWORDS: Record<string, string> = {
  еда: 'Еда', кафе: 'Еда', продукты: 'Еда', ресторан: 'Еда', обед: 'Еда',
  такси: 'Транспорт', метро: 'Транспорт', автобус: 'Транспорт', бензин: 'Транспорт', транспорт: 'Транспорт',
  аренда: 'Жильё', квартира: 'Жильё', жильё: 'Жильё', жилье: 'Жильё', коммуналка: 'Жильё',
  учёба: 'Учёба', учеба: 'Учёба', курсы: 'Учёба', книги: 'Учёба',
  техника: 'Техника', телефон: 'Техника', ноутбук: 'Техника',
  одежда: 'Одежда',
  кино: 'Развлечения', развлечения: 'Развлечения',
  игры: 'Игры', игра: 'Игры',
  здоровье: 'Здоровье', аптека: 'Здоровье', врач: 'Здоровье',
  семья: 'Семья', бизнес: 'Бизнес',
};

async function getProfileByChatId(chatId: number): Promise<Profile | null> {
  const { data } = await admin
    .from('profiles')
    .select('id,base_currency,display_currency')
    .eq('telegram_user_id', chatId)
    .maybeSingle();
  return data as any;
}
async function getPending(chatId: number) {
  const { data } = await admin.from('bot_pending').select('draft').eq('telegram_user_id', chatId).maybeSingle();
  return (data?.draft as any) || null;
}
async function setPending(chatId: number, draft: any) {
  await admin.from('bot_pending').upsert({ telegram_user_id: chatId, draft, updated_at: new Date().toISOString() });
}
async function clearPending(chatId: number) {
  await admin.from('bot_pending').delete().eq('telegram_user_id', chatId);
}

// Parses "+500000", "-120000 еда", "500000 работа зарплата" etc.
// Currency is intentionally NOT asked in chat (simplification, see README) — every
// bot-entered transaction is recorded in the user's own app currency (Settings > Валюта).
function parseAmountLine(text: string) {
  const m = text.match(/([+-])?\s*(\d[\d\s]*)/);
  if (!m) return null;
  const amount = Number(m[2].replace(/\s/g, ''));
  if (!amount || amount <= 0) return null;
  const type = m[1] === '-' ? 'expense' : m[1] === '+' ? 'income' : null;
  const rest = text.slice((m.index || 0) + m[0].length).trim();
  return { type, amount, rest } as { type: 'income' | 'expense' | null; amount: number; rest: string };
}

async function insertTransaction(
  userId: string,
  currency: Currency,
  tx: { type: 'income' | 'expense'; amount: number; category: string; description: string; sourceId?: string }
) {
  const rates = await fetchRates().catch(() => defaultRates);
  const usd = toUsd(tx.amount, currency, rates);
  const baseAmount = fromUsd(usd, currency, rates);
  await admin.from('transactions').insert({
    user_id: userId,
    type: tx.type,
    amount: tx.amount,
    currency,
    date: new Date().toISOString().slice(0, 10),
    source_id: tx.sourceId || null,
    category: tx.category,
    description: tx.description || '',
    status: tx.type === 'income' ? 'received' : null,
    recurring: false,
    rate_to_usd: usd / tx.amount,
    rate_to_base: baseAmount / tx.amount,
    base_amount: baseAmount,
  });
}

async function finalizeExpense(chatId: number, profile: Profile, cur: Currency, amount: number, rest: string) {
  const words = rest.toLowerCase().split(/\s+/).filter(Boolean);
  let category = 'Другое';
  for (const w of words) {
    if (CATEGORY_KEYWORDS[w]) { category = CATEGORY_KEYWORDS[w]; break; }
  }
  await insertTransaction(profile.id, cur, { type: 'expense', amount, category, description: rest });
  await sendMessage(
    chatId,
    `✅ Расход добавлен\n\n−${fmt(amount, cur)}\n\nКатегория: ${category}\nДата: ${new Date().toLocaleDateString('ru-RU')}`,
    { reply_markup: MAIN_KEYBOARD }
  );
}

async function finalizeIncome(chatId: number, profile: Profile, cur: Currency, amount: number, rest: string) {
  const { data: sources } = await admin.from('sources').select('id,name').eq('user_id', profile.id);
  const words = rest.toLowerCase().split(/\s+/).filter(Boolean);
  const matched = (sources || []).find((s) => words.some((w) => s.name.toLowerCase().includes(w)));
  if (matched) {
    await insertTransaction(profile.id, cur, {
      type: 'income',
      amount,
      category: matched.name,
      description: rest,
      sourceId: matched.id,
    });
    return sendMessage(
      chatId,
      `✅ Доход добавлен\n\n+${fmt(amount, cur)}\n\nИсточник: ${matched.name}\nДата: ${new Date().toLocaleDateString('ru-RU')}`,
      { reply_markup: MAIN_KEYBOARD }
    );
  }
  await setPending(chatId, { type: 'income', amount, description: rest });
  const buttons = (sources || []).map((s) => [{ text: s.name, callback_data: `src:${s.id}` }]);
  buttons.push([{ text: 'Другое', callback_data: 'src:other' }]);
  return sendMessage(chatId, 'Источник дохода?', { reply_markup: { inline_keyboard: buttons } });
}

async function handleStart(chatId: number) {
  const profile = await getProfileByChatId(chatId);
  if (profile) return sendMessage(chatId, 'С возвращением! Аккаунт уже привязан.', { reply_markup: MAIN_KEYBOARD });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await admin.from('telegram_link_codes').delete().eq('telegram_chat_id', chatId);
  await admin.from('telegram_link_codes').insert({ code, telegram_chat_id: chatId });
  return sendMessage(
    chatId,
    `Привет! 👋\n\nЧтобы привязать этот чат к вашему финансовому аккаунту:\n\n1. Откройте веб-приложение и войдите по email\n2. Настройки → Telegram → введите код:\n\n<code>${code}</code>\n\nКод действует 10 минут.`
  );
}

async function handleMessage(msg: any) {
  const chatId = msg.chat.id;
  const text: string = (msg.text || '').trim();
  if (text === '/start') return handleStart(chatId);

  const profile = await getProfileByChatId(chatId);
  if (!profile) {
    return sendMessage(chatId, 'Этот чат ещё не привязан к аккаунту. Отправьте /start, чтобы получить код привязки.');
  }
  const cur = (profile.display_currency || profile.base_currency || 'USD') as Currency;

  if (text === '💰 Доход') {
    await setPending(chatId, { type: 'income' });
    return sendMessage(chatId, 'Введите сумму дохода, например:\n<code>500000 работа зарплата</code>');
  }
  if (text === '💸 Расход') {
    await setPending(chatId, { type: 'expense' });
    return sendMessage(chatId, 'Введите сумму расхода, например:\n<code>120000 еда</code>');
  }
  if (text === '📊 Статистика') return sendStats(chatId, profile, cur);
  if (text === '📅 Сегодня') return sendToday(chatId, profile, cur);
  if (text === '📅 Этот месяц') return sendMonth(chatId, profile, cur);
  if (text === '🎯 Цели') return sendGoals(chatId, profile);
  if (text === '💼 Источники') return sendSources(chatId, profile, cur);
  if (text === '📱 Открыть приложение') {
    return sendMessage(
      chatId,
      APP_URL ? 'Открыть приложение:' : 'Ссылка на приложение не настроена (переменная APP_URL).',
      APP_URL ? { reply_markup: { inline_keyboard: [[{ text: '📱 Открыть', web_app: { url: APP_URL } }]] } } : {}
    );
  }
  if (text === '⚙️ Настройки') {
    return sendMessage(chatId, `Аккаунт привязан.\nВалюта: ${cur}\n\nОтвязать Telegram можно в настройках веб-приложения.`);
  }

  const pending = await getPending(chatId);
  const parsed = parseAmountLine(text);
  if (!parsed) {
    return sendMessage(chatId, 'Не понял сумму. Пример: +500000 или -120000 еда', { reply_markup: MAIN_KEYBOARD });
  }

  const type = parsed.type || pending?.type;
  if (!type) {
    await setPending(chatId, { amount: parsed.amount, rest: parsed.rest });
    return sendMessage(chatId, 'Это доход или расход?', {
      reply_markup: {
        inline_keyboard: [[{ text: '💰 Доход', callback_data: 'type:income' }, { text: '💸 Расход', callback_data: 'type:expense' }]],
      },
    });
  }
  await clearPending(chatId);
  if (type === 'expense') return finalizeExpense(chatId, profile, cur, parsed.amount, parsed.rest);
  return finalizeIncome(chatId, profile, cur, parsed.amount, parsed.rest);
}

async function handleCallback(cq: any) {
  const chatId = cq.message.chat.id;
  const data: string = cq.data;
  await answerCallback(cq.id);
  const profile = await getProfileByChatId(chatId);
  if (!profile) return;
  const cur = (profile.display_currency || profile.base_currency || 'USD') as Currency;

  if (data.startsWith('type:')) {
    const pending = await getPending(chatId);
    if (!pending?.amount) return;
    await clearPending(chatId);
    const t = data.slice(5);
    if (t === 'expense') return finalizeExpense(chatId, profile, cur, pending.amount, pending.rest || '');
    return finalizeIncome(chatId, profile, cur, pending.amount, pending.rest || '');
  }
  if (data.startsWith('src:')) {
    const pending = await getPending(chatId);
    if (!pending || pending.type !== 'income') return;
    const sourceId = data.slice(4);
    let sourceName = 'Другое';
    let realSourceId: string | undefined;
    if (sourceId !== 'other') {
      const { data: s } = await admin.from('sources').select('id,name').eq('id', sourceId).maybeSingle();
      if (s) { sourceName = s.name; realSourceId = s.id; }
    }
    await clearPending(chatId);
    await insertTransaction(profile.id, cur, {
      type: 'income',
      amount: pending.amount,
      category: sourceName,
      description: pending.description || '',
      sourceId: realSourceId,
    });
    return sendMessage(chatId, `✅ Доход добавлен\n\n+${fmt(pending.amount, cur)}\n\nИсточник: ${sourceName}`, {
      reply_markup: MAIN_KEYBOARD,
    });
  }
}

async function sendStats(chatId: number, profile: Profile, cur: Currency) {
  const today = new Date().toISOString().slice(0, 10);
  const ym = today.slice(0, 7);
  const { data } = await admin.from('transactions').select('*').eq('user_id', profile.id);
  const list = data || [];
  const rates = await fetchRates().catch(() => defaultRates);
  const conv = (t: any) => fromUsd(toUsd(t.amount, t.currency, rates), cur, rates);
  const sum = (arr: any[], type: string) =>
    arr.filter((t) => t.type === type && (type !== 'income' || t.status !== 'pending')).reduce((s, t) => s + conv(t), 0);
  const dToday = list.filter((t) => t.date === today);
  const dMonth = list.filter((t) => t.date.startsWith(ym));
  const iT = sum(dToday, 'income'), eT = sum(dToday, 'expense'), iM = sum(dMonth, 'income'), eM = sum(dMonth, 'expense');
  return sendMessage(
    chatId,
    `📊 <b>Финансы</b>\n\n<b>Сегодня</b>\n💰 Доход: ${fmt(iT, cur)}\n💸 Расход: ${fmt(eT, cur)}\n📈 Прибыль: ${fmt(iT - eT, cur)}\n\n<b>Этот месяц</b>\n💰 Доход: ${fmt(iM, cur)}\n💸 Расход: ${fmt(eM, cur)}\n📈 Прибыль: ${fmt(iM - eM, cur)}`,
    { reply_markup: MAIN_KEYBOARD }
  );
}

async function sendToday(chatId: number, profile: Profile, cur: Currency) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from('transactions')
    .select('*')
    .eq('user_id', profile.id)
    .eq('date', today)
    .order('created_at', { ascending: false });
  const list = data || [];
  if (!list.length) return sendMessage(chatId, 'Сегодня операций пока нет.', { reply_markup: MAIN_KEYBOARD });
  const rates = await fetchRates().catch(() => defaultRates);
  const lines = list
    .map((t) => `${t.type === 'income' ? '+' : '−'}${fmt(fromUsd(toUsd(t.amount, t.currency, rates), cur, rates), cur)} · ${t.category}`)
    .join('\n');
  return sendMessage(chatId, `📅 <b>Сегодня</b>\n\n${lines}`, { reply_markup: MAIN_KEYBOARD });
}

async function sendMonth(chatId: number, profile: Profile, cur: Currency) {
  const ym = new Date().toISOString().slice(0, 7);
  const { data } = await admin
    .from('transactions')
    .select('*')
    .eq('user_id', profile.id)
    .gte('date', ym + '-01')
    .lte('date', ym + '-31');
  const list = data || [];
  const rates = await fetchRates().catch(() => defaultRates);
  const conv = (t: any) => fromUsd(toUsd(t.amount, t.currency, rates), cur, rates);
  const income = list.filter((t) => t.type === 'income' && t.status !== 'pending');
  const expense = list.filter((t) => t.type === 'expense');
  const iM = income.reduce((s, t) => s + conv(t), 0), eM = expense.reduce((s, t) => s + conv(t), 0);
  const bySource: Record<string, number> = {};
  for (const t of income) bySource[t.category] = (bySource[t.category] || 0) + conv(t);
  const byCat: Record<string, number> = {};
  for (const t of expense) byCat[t.category] = (byCat[t.category] || 0) + conv(t);
  const topSource = Object.entries(bySource).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  return sendMessage(
    chatId,
    `📅 <b>${new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</b>\n\n💰 Доход: ${fmt(iM, cur)}\n💸 Расход: ${fmt(eM, cur)}\n📈 Чистая прибыль: ${fmt(iM - eM, cur)}\n\nЛучший источник: ${topSource}\nСамый большой расход: ${topCat}`,
    { reply_markup: MAIN_KEYBOARD }
  );
}

async function sendGoals(chatId: number, profile: Profile) {
  const { data } = await admin.from('goals').select('*').eq('user_id', profile.id);
  if (!data?.length) return sendMessage(chatId, 'Целей пока нет. Создайте их в приложении.', { reply_markup: MAIN_KEYBOARD });
  const lines = data
    .map((g: any) => {
      const pct = Math.min(100, Math.round((g.progress / g.target) * 100));
      return `🎯 <b>${g.name}</b>\n${fmt(g.progress, g.currency)} / ${fmt(g.target, g.currency)} (${pct}%)`;
    })
    .join('\n\n');
  return sendMessage(chatId, lines, { reply_markup: MAIN_KEYBOARD });
}

async function sendSources(chatId: number, profile: Profile, cur: Currency) {
  const { data: sources } = await admin.from('sources').select('*').eq('user_id', profile.id);
  const { data: tx } = await admin.from('transactions').select('*').eq('user_id', profile.id).eq('type', 'income');
  const rates = await fetchRates().catch(() => defaultRates);
  const lines = (sources || [])
    .map((s: any) => {
      const own = (tx || []).filter((t: any) => t.source_id === s.id && t.status !== 'pending');
      const total = own.reduce((sum: number, t: any) => sum + fromUsd(toUsd(t.amount, t.currency, rates), cur, rates), 0);
      return `💼 <b>${s.name}</b>: ${fmt(total, cur)} (${own.length} оп.)`;
    })
    .join('\n');
  return sendMessage(chatId, lines || 'Источников пока нет.', { reply_markup: MAIN_KEYBOARD });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true });
    return;
  }
  if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    res.status(401).end();
    return;
  }
  const update = req.body;
  try {
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
  } catch (e) {
    console.error(e);
  }
  res.status(200).json({ ok: true });
}