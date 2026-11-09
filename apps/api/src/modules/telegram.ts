import { config } from '../config';
import { one, pool } from '../db';
import { telegramTexts } from './messages';

const api = (method: string) => `https://api.telegram.org/bot${config.telegram.token}/${method}`;

export const telegramEnabled = () => Boolean(config.telegram.token);

export async function sendTelegram(chatId: number | string, text: string) {
  const r = await fetch(api('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}: ${await r.text()}`);
}

/** /start <kod>: xodimning telegram_chat_id sini bog'lash. Mijozlarga bot xabar yubormaydi. */
export async function handleTelegramText(chatId: number, text: string) {
  const m = /^\/start(?:\s+(\S+))?/.exec(text.trim());
  if (!m || !m[1]) {
    await sendTelegram(chatId, `${telegramTexts.help.uz}\n\n${telegramTexts.help.ru}`);
    return;
  }
  const code = m[1].toUpperCase();
  const u = await one<{ id: number; language: 'uz' | 'ru' }>(
    pool,
    `UPDATE app_user SET telegram_chat_id = $1, telegram_link_code = NULL, telegram_link_expires_at = NULL
     WHERE telegram_link_code = $2 AND telegram_link_expires_at > now() AND active
     RETURNING id, language`,
    [chatId, code],
  ).catch(async (e) => {
    // Shu chat boshqa xodimga bog'langan bo'lsa (UNIQUE), avval uzib qayta bog'laymiz
    if (e.code === '23505') {
      await pool.query('UPDATE app_user SET telegram_chat_id = NULL WHERE telegram_chat_id = $1', [chatId]);
      return one<{ id: number; language: 'uz' | 'ru' }>(
        pool,
        `UPDATE app_user SET telegram_chat_id = $1, telegram_link_code = NULL, telegram_link_expires_at = NULL
         WHERE telegram_link_code = $2 AND telegram_link_expires_at > now() AND active RETURNING id, language`,
        [chatId, code],
      );
    }
    throw e;
  });
  if (!u) {
    await sendTelegram(chatId, `${telegramTexts.badCode.uz}\n\n${telegramTexts.badCode.ru}`);
    return;
  }
  await sendTelegram(chatId, telegramTexts.linked[u.language]);
}

let stopped = false;

/** Long polling (webhook uchun ochiq domen shart emas) */
export async function startTelegramPolling() {
  if (!telegramEnabled()) return;
  let offset = 0;
  console.log('Telegram bot: long polling boshlandi');
  while (!stopped) {
    try {
      const r = await fetch(api('getUpdates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset, timeout: 30, allowed_updates: ['message'] }),
        signal: AbortSignal.timeout(40000),
      });
      const data: any = await r.json();
      for (const upd of data.result ?? []) {
        offset = upd.update_id + 1;
        const msg = upd.message;
        if (msg?.chat?.type === 'private' && typeof msg.text === 'string') {
          await handleTelegramText(msg.chat.id, msg.text).catch((e) => console.error('Telegram:', e.message));
        }
      }
    } catch (e) {
      if (!stopped) {
        console.error('Telegram polling xatosi:', (e as Error).message);
        await new Promise((res) => setTimeout(res, 5000));
      }
    }
  }
}

export function stopTelegramPolling() {
  stopped = true;
}
