export type TelegramBotStatus = "unverified" | "connected" | "invalid" | "disconnected";

export type TelegramChannelType = "channel" | "supergroup";

export type TelegramChannelStatus = "connected" | "disconnected" | "permission_issue";

export type TelegramPostStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "canceled";

export type TelegramDeliveryStatus =
  | "pending"
  | "queued"
  | "processing"
  | "sent"
  | "failed"
  | "retrying"
  | "deleted";

export type TelegramMediaType = "photo" | "video" | "document";

export type TelegramDeliveryOperation = "send" | "edit" | "delete";

export type TelegramBotRow = {
  id: string;
  telegram_bot_id: string | null;
  username: string | null;
  encrypted_token: string;
  status: TelegramBotStatus;
  is_active: boolean;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TelegramChannelRow = {
  id: string;
  telegram_chat_id: number;
  username: string | null;
  title: string;
  type: TelegramChannelType;
  photo_url: string | null;
  member_count: number | null;
  publishing_enabled: boolean;
  status: TelegramChannelStatus;
  bot_is_admin: boolean;
  bot_permissions: Record<string, boolean>;
  channel_group_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_verified_at: string | null;
};

export type ChannelGroupRow = {
  id: string;
  name: string;
  created_at: string;
};

export type PostRow = {
  id: string;
  text: string;
  parse_mode: string;
  status: TelegramPostStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PostMediaRow = {
  id: string;
  post_id: string;
  media_type: TelegramMediaType;
  storage_key: string;
  position: number;
};

export type PostButtonRow = {
  id: string;
  post_id: string;
  label: string;
  url: string;
  row_index: number;
  position: number;
};

export type PostDeliveryRow = {
  id: string;
  post_id: string;
  channel_id: string;
  telegram_message_id: number | null;
  status: TelegramDeliveryStatus;
  pending_operation: TelegramDeliveryOperation | null;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  sent_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

// Errors from processTelegramError() that the worker treats as permanent
// (no point retrying — the bot lacks permission, the chat is gone, etc.)
export const PERMANENT_TELEGRAM_ERROR_CODES = new Set([
  400, // bad request (e.g. chat not found, message not modified)
  403, // forbidden (bot kicked, not an admin, blocked)
]);
