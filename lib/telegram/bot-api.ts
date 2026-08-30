import { supabaseAdmin } from "@/lib/supabase";
import { decryptToken } from "./crypto";
import { buildInlineKeyboard, ButtonSpec, sanitizeTelegramHtml } from "./formatting";
import { PERMANENT_TELEGRAM_ERROR_CODES, TelegramBotRow } from "./types";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export class TelegramApiError extends Error {
  code: number;
  retryAfter?: number;
  isPermanent: boolean;

  constructor(code: number, description: string, retryAfter?: number) {
    super(description);
    this.name = "TelegramApiError";
    this.code = code;
    this.retryAfter = retryAfter;
    this.isPermanent = PERMANENT_TELEGRAM_ERROR_CODES.has(code) && !retryAfter;
  }
}

type TelegramApiResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error_code: number; description: string; parameters?: { retry_after?: number } };

async function callTelegramApi<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch (error) {
    throw new TelegramApiError(
      0,
      error instanceof Error ? `Network error: ${error.message}` : "Network error"
    );
  }

  const data = (await res.json().catch(() => null)) as TelegramApiResponse<T> | null;

  if (!data) {
    throw new TelegramApiError(res.status, `Telegram returned a non-JSON response (HTTP ${res.status}).`);
  }

  if (!data.ok) {
    throw new TelegramApiError(
      data.error_code,
      data.description,
      data.parameters?.retry_after
    );
  }

  return data.result;
}

// processTelegramError() — normalizes any thrown error into a structured
// shape callers can log/store without ever touching the bot token.
export function processTelegramError(error: unknown): {
  code: number;
  description: string;
  retryAfter?: number;
  isPermanent: boolean;
} {
  if (error instanceof TelegramApiError) {
    return {
      code: error.code,
      description: error.message,
      retryAfter: error.retryAfter,
      isPermanent: error.isPermanent,
    };
  }

  return {
    code: 0,
    description: error instanceof Error ? error.message : "Unknown Telegram error.",
    isPermanent: false,
  };
}

export type TelegramMeInfo = {
  id: number;
  username: string | null;
  first_name: string;
};

export async function validateBotToken(rawToken: string): Promise<TelegramMeInfo> {
  const me = await callTelegramApi<{ id: number; username?: string; first_name: string; is_bot: boolean }>(
    rawToken,
    "getMe"
  );

  if (!me.is_bot) {
    throw new TelegramApiError(400, "This token does not belong to a bot account.");
  }

  return { id: me.id, username: me.username ?? null, first_name: me.first_name };
}

export async function getActiveBot(): Promise<TelegramBotRow | null> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("telegram_bots")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as TelegramBotRow | null) ?? null;
}

export async function getActiveBotToken(): Promise<{ bot: TelegramBotRow; token: string }> {
  const bot = await getActiveBot();
  if (!bot) {
    throw new Error("No Telegram bot is configured yet. Add one in Telegram → Settings.");
  }

  return { bot, token: decryptToken(bot.encrypted_token) };
}

export type TelegramChatInfo = {
  id: number;
  title?: string;
  username?: string;
  type: string;
  photo?: { small_file_id: string; big_file_id: string };
};

export async function getChat(token: string, chatId: number | string): Promise<TelegramChatInfo> {
  return callTelegramApi<TelegramChatInfo>(token, "getChat", { chat_id: chatId });
}

export async function getChatMemberCount(token: string, chatId: number | string): Promise<number> {
  return callTelegramApi<number>(token, "getChatMemberCount", { chat_id: chatId });
}

export type BotChatMember = {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  can_post_messages?: boolean;
  can_edit_messages?: boolean;
  can_delete_messages?: boolean;
};

export async function getBotChatMembership(
  token: string,
  chatId: number | string,
  botUserId: number
): Promise<BotChatMember> {
  return callTelegramApi<BotChatMember>(token, "getChatMember", {
    chat_id: chatId,
    user_id: botUserId,
  });
}

export async function getFileDownloadUrl(token: string, fileId: string): Promise<string> {
  const file = await callTelegramApi<{ file_path: string }>(token, "getFile", { file_id: fileId });
  return `${TELEGRAM_API_BASE}/file/bot${token}/${file.file_path}`;
}

export async function setWebhook(token: string, url: string, secretToken: string): Promise<void> {
  await callTelegramApi(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["my_chat_member", "message"],
  });
}

export type SendPostParams = {
  token: string;
  chatId: number | string;
  text: string;
  media?: { type: "photo" | "video" | "document"; url: string } | null;
  buttons?: ButtonSpec[];
};

const METHOD_BY_MEDIA_TYPE: Record<"photo" | "video" | "document", string> = {
  photo: "sendPhoto",
  video: "sendVideo",
  document: "sendDocument",
};

const MEDIA_FIELD_BY_TYPE: Record<"photo" | "video" | "document", string> = {
  photo: "photo",
  video: "video",
  document: "document",
};

export async function sendPost(params: SendPostParams): Promise<{ messageId: number }> {
  const safeText = sanitizeTelegramHtml(params.text);
  const replyMarkup = params.buttons?.length ? buildInlineKeyboard(params.buttons) : undefined;

  const body: Record<string, unknown> = {
    chat_id: params.chatId,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  };

  const method = params.media ? METHOD_BY_MEDIA_TYPE[params.media.type] : "sendMessage";

  if (params.media) {
    body[MEDIA_FIELD_BY_TYPE[params.media.type]] = params.media.url;
    body.caption = safeText;
  } else {
    body.text = safeText;
  }

  const result = await callTelegramApi<{ message_id: number }>(params.token, method, body);
  return { messageId: result.message_id };
}

export type EditPostParams = {
  token: string;
  chatId: number | string;
  messageId: number;
  text: string;
  hasMedia: boolean;
  buttons?: ButtonSpec[];
};

export async function editPost(params: EditPostParams): Promise<void> {
  const safeText = sanitizeTelegramHtml(params.text);
  const replyMarkup = params.buttons?.length ? buildInlineKeyboard(params.buttons) : undefined;

  const method = params.hasMedia ? "editMessageCaption" : "editMessageText";
  const body: Record<string, unknown> = {
    chat_id: params.chatId,
    message_id: params.messageId,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  };

  if (params.hasMedia) {
    body.caption = safeText;
  } else {
    body.text = safeText;
  }

  await callTelegramApi(params.token, method, body);
}

export async function deletePost(
  token: string,
  chatId: number | string,
  messageId: number
): Promise<void> {
  await callTelegramApi(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
}
