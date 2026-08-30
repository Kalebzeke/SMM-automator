import { supabaseAdmin } from "@/lib/supabase";
import { deletePost, editPost, getActiveBotToken, processTelegramError, sendPost } from "./bot-api";
import { ButtonSpec } from "./formatting";
import { PostDeliveryRow } from "./types";

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_SECONDS = 5;
const MAX_BACKOFF_SECONDS = 300;
const BATCH_LIMIT = 20;
const INTER_CALL_DELAY_MS = 60;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computeBackoffSeconds(attempts: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * 2 ** attempts);
}

type DueDelivery = PostDeliveryRow & {
  posts: { text: string; parse_mode: string } | null;
  telegram_channels: { telegram_chat_id: number; title: string } | null;
};

async function loadPostMedia(postId: string) {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from("post_media")
    .select("media_type, storage_key")
    .eq("post_id", postId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const { data: publicUrlData } = supabase.storage
    .from("telegram-media")
    .getPublicUrl(data.storage_key);

  return { type: data.media_type as "photo" | "video" | "document", url: publicUrlData.publicUrl };
}

async function loadPostButtons(postId: string): Promise<ButtonSpec[]> {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from("post_buttons")
    .select("label, url, row_index, position")
    .eq("post_id", postId)
    .order("row_index", { ascending: true })
    .order("position", { ascending: true });

  return data ?? [];
}

async function markDelivery(id: string, patch: Record<string, unknown>) {
  const supabase = supabaseAdmin();
  await supabase
    .from("post_deliveries")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
}

async function refreshPostStatus(postId: string) {
  const supabase = supabaseAdmin();
  const { data: deliveries } = await supabase
    .from("post_deliveries")
    .select("status, pending_operation")
    .eq("post_id", postId);

  if (!deliveries || deliveries.length === 0) return;

  const stillWorking = deliveries.some(
    (d) => d.pending_operation !== null || d.status === "pending" || d.status === "queued" || d.status === "processing" || d.status === "retrying"
  );

  if (stillWorking) return;

  const anySent = deliveries.some((d) => d.status === "sent");
  const nextStatus = anySent ? "sent" : "failed";

  await supabase
    .from("posts")
    .update({ status: nextStatus, sent_at: anySent ? new Date().toISOString() : null })
    .eq("id", postId)
    .in("status", ["sending", "scheduled", "draft"]);
}

async function processSend(delivery: DueDelivery, token: string) {
  if (!delivery.telegram_channels) {
    await markDelivery(delivery.id, {
      status: "failed",
      pending_operation: null,
      last_error: "Destination channel no longer exists.",
    });
    return;
  }

  try {
    const [media, buttons] = await Promise.all([
      loadPostMedia(delivery.post_id),
      loadPostButtons(delivery.post_id),
    ]);

    const result = await sendPost({
      token,
      chatId: delivery.telegram_channels.telegram_chat_id,
      text: delivery.posts?.text ?? "",
      media,
      buttons,
    });

    await markDelivery(delivery.id, {
      status: "sent",
      pending_operation: null,
      telegram_message_id: result.messageId,
      sent_at: new Date().toISOString(),
      last_error: null,
      attempts: delivery.attempts + 1,
    });
  } catch (error) {
    await handleSendFailure(delivery, error);
  }
}

async function handleSendFailure(delivery: DueDelivery, error: unknown) {
  const normalized = processTelegramError(error);
  const attempts = delivery.attempts + 1;

  console.error(
    `[telegram] send failed post=${delivery.post_id} channel=${delivery.channel_id} delivery=${delivery.id} code=${normalized.code} attempts=${attempts}: ${normalized.description}`
  );

  if (normalized.retryAfter) {
    await markDelivery(delivery.id, {
      status: "retrying",
      attempts,
      next_attempt_at: new Date(Date.now() + normalized.retryAfter * 1000).toISOString(),
      last_error: normalized.description,
    });
    return;
  }

  if (normalized.isPermanent || attempts >= MAX_ATTEMPTS) {
    await markDelivery(delivery.id, {
      status: "failed",
      pending_operation: null,
      attempts,
      last_error: normalized.description,
    });
    return;
  }

  await markDelivery(delivery.id, {
    status: "retrying",
    attempts,
    next_attempt_at: new Date(Date.now() + computeBackoffSeconds(attempts) * 1000).toISOString(),
    last_error: normalized.description,
  });
}

async function processEdit(delivery: DueDelivery, token: string) {
  if (!delivery.telegram_channels || !delivery.telegram_message_id) {
    await markDelivery(delivery.id, { pending_operation: null, last_error: "Nothing to edit." });
    return;
  }

  try {
    const [media, buttons] = await Promise.all([
      loadPostMedia(delivery.post_id),
      loadPostButtons(delivery.post_id),
    ]);

    await editPost({
      token,
      chatId: delivery.telegram_channels.telegram_chat_id,
      messageId: delivery.telegram_message_id,
      text: delivery.posts?.text ?? "",
      hasMedia: Boolean(media),
      buttons,
    });

    await markDelivery(delivery.id, {
      pending_operation: null,
      edited_at: new Date().toISOString(),
      last_error: null,
    });
  } catch (error) {
    const normalized = processTelegramError(error);
    const attempts = delivery.attempts + 1;

    console.error(
      `[telegram] edit failed post=${delivery.post_id} channel=${delivery.channel_id} delivery=${delivery.id} code=${normalized.code}: ${normalized.description}`
    );

    if (!normalized.isPermanent && !normalized.retryAfter && attempts < MAX_ATTEMPTS) {
      await markDelivery(delivery.id, {
        attempts,
        next_attempt_at: new Date(
          Date.now() + (normalized.retryAfter ?? computeBackoffSeconds(attempts)) * 1000
        ).toISOString(),
        last_error: normalized.description,
      });
      return;
    }

    // Edit failures never flip a live delivery's status — the original
    // message is still on Telegram, just not updated.
    await markDelivery(delivery.id, {
      attempts,
      pending_operation: null,
      last_error: normalized.description,
    });
  }
}

const ALREADY_GONE_PATTERN = /message to delete not found|message can't be deleted|message not found/i;

async function processDelete(delivery: DueDelivery, token: string) {
  if (!delivery.telegram_channels || !delivery.telegram_message_id) {
    await markDelivery(delivery.id, { status: "deleted", pending_operation: null, deleted_at: new Date().toISOString() });
    return;
  }

  try {
    await deletePost(token, delivery.telegram_channels.telegram_chat_id, delivery.telegram_message_id);
    await markDelivery(delivery.id, {
      status: "deleted",
      pending_operation: null,
      deleted_at: new Date().toISOString(),
      last_error: null,
    });
  } catch (error) {
    const normalized = processTelegramError(error);
    const attempts = delivery.attempts + 1;

    console.error(
      `[telegram] delete failed post=${delivery.post_id} channel=${delivery.channel_id} delivery=${delivery.id} code=${normalized.code}: ${normalized.description}`
    );

    if (ALREADY_GONE_PATTERN.test(normalized.description)) {
      await markDelivery(delivery.id, {
        status: "deleted",
        pending_operation: null,
        deleted_at: new Date().toISOString(),
        last_error: null,
      });
      return;
    }

    if (!normalized.isPermanent && !normalized.retryAfter && attempts < MAX_ATTEMPTS) {
      await markDelivery(delivery.id, {
        attempts,
        next_attempt_at: new Date(Date.now() + computeBackoffSeconds(attempts) * 1000).toISOString(),
        last_error: normalized.description,
      });
      return;
    }

    await markDelivery(delivery.id, {
      attempts,
      pending_operation: null,
      last_error: normalized.description,
    });
  }
}

export async function runDeliveryWorker(limit = BATCH_LIMIT): Promise<{ processed: number }> {
  const supabase = supabaseAdmin();
  const { data: due, error } = await supabase
    .from("post_deliveries")
    .select("*, posts(text, parse_mode), telegram_channels(telegram_chat_id, title)")
    .not("pending_operation", "is", null)
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  if (!due || due.length === 0) return { processed: 0 };

  let token: string;
  try {
    ({ token } = await getActiveBotToken());
  } catch {
    // No bot configured — leave rows queued rather than failing them.
    return { processed: 0 };
  }

  const affectedPostIds = new Set<string>();

  for (const delivery of due as DueDelivery[]) {
    affectedPostIds.add(delivery.post_id);

    if (delivery.status === "pending" || delivery.status === "queued") {
      await markDelivery(delivery.id, { status: "processing" });
    }

    if (delivery.pending_operation === "send") {
      await processSend(delivery, token);
    } else if (delivery.pending_operation === "edit") {
      await processEdit(delivery, token);
    } else if (delivery.pending_operation === "delete") {
      await processDelete(delivery, token);
    }

    await sleep(INTER_CALL_DELAY_MS);
  }

  await Promise.all([...affectedPostIds].map(refreshPostStatus));

  return { processed: due.length };
}
