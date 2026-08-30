import { supabaseAdmin } from "@/lib/supabase";

export type CreatePostInput = {
  text: string;
  media?: { mediaType: "photo" | "video" | "document"; storageKey: string } | null;
  buttons?: Array<{ label: string; url: string; row_index: number; position: number }>;
  destinationChannelIds: string[];
  publishNow: boolean;
  scheduledAt?: string | null;
};

export async function createPost(input: CreatePostInput) {
  const supabase = supabaseAdmin();

  if (input.destinationChannelIds.length === 0) {
    throw new Error("Select at least one destination channel.");
  }

  if (!input.text.trim() && !input.media) {
    throw new Error("Post needs text or media.");
  }

  const status = input.publishNow ? "sending" : input.scheduledAt ? "scheduled" : "draft";

  const { data: post, error: postErr } = await supabase
    .from("posts")
    .insert({
      text: input.text,
      parse_mode: "HTML",
      status,
      scheduled_at: input.scheduledAt ?? null,
    })
    .select()
    .single();

  if (postErr) throw postErr;

  if (input.media) {
    const { error } = await supabase.from("post_media").insert({
      post_id: post.id,
      media_type: input.media.mediaType,
      storage_key: input.media.storageKey,
      position: 0,
    });
    if (error) throw error;
  }

  if (input.buttons && input.buttons.length > 0) {
    const { error } = await supabase.from("post_buttons").insert(
      input.buttons.map((b) => ({
        post_id: post.id,
        label: b.label,
        url: b.url,
        row_index: b.row_index,
        position: b.position,
      }))
    );
    if (error) throw error;
  }

  const { error: destErr } = await supabase.from("post_destinations").insert(
    input.destinationChannelIds.map((channelId) => ({ post_id: post.id, channel_id: channelId }))
  );
  if (destErr) throw destErr;

  if (input.publishNow) {
    await createDeliveriesForPost(post.id);
  }

  return post;
}

// Creates (or ensures) one queued "send" delivery per destination channel.
// Safe to call more than once for the same post — existing rows are left
// alone via the unique(post_id, channel_id) constraint, so a retry or a
// re-triggered scheduler tick can never send a duplicate message.
export async function createDeliveriesForPost(postId: string): Promise<void> {
  const supabase = supabaseAdmin();

  const { data: destinations, error } = await supabase
    .from("post_destinations")
    .select("channel_id")
    .eq("post_id", postId);

  if (error) throw error;
  if (!destinations || destinations.length === 0) return;

  const { error: insertErr } = await supabase.from("post_deliveries").upsert(
    destinations.map((d) => ({
      post_id: postId,
      channel_id: d.channel_id,
      status: "pending" as const,
      pending_operation: "send" as const,
      next_attempt_at: new Date().toISOString(),
    })),
    { onConflict: "post_id,channel_id", ignoreDuplicates: true }
  );

  if (insertErr) throw insertErr;
}

export async function publishPost(postId: string): Promise<void> {
  const supabase = supabaseAdmin();
  const { data: post, error } = await supabase
    .from("posts")
    .select("status")
    .eq("id", postId)
    .single();

  if (error || !post) throw new Error("Post not found.");
  if (post.status === "sent" || post.status === "sending") {
    throw new Error("Post is already published or sending.");
  }

  await supabase
    .from("posts")
    .update({ status: "sending", scheduled_at: null })
    .eq("id", postId);

  await createDeliveriesForPost(postId);
}

export async function cancelScheduledPost(postId: string): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from("posts")
    .update({ status: "canceled" })
    .eq("id", postId)
    .eq("status", "scheduled");

  if (error) throw error;
}

export async function retryFailedDeliveries(postId: string): Promise<number> {
  const supabase = supabaseAdmin();
  const { data: failed, error } = await supabase
    .from("post_deliveries")
    .select("id")
    .eq("post_id", postId)
    .eq("status", "failed");

  if (error) throw error;
  if (!failed || failed.length === 0) return 0;

  await supabase
    .from("post_deliveries")
    .update({ status: "pending", pending_operation: "send", next_attempt_at: new Date().toISOString(), last_error: null })
    .in("id", failed.map((d) => d.id));

  await supabase.from("posts").update({ status: "sending" }).eq("id", postId);

  return failed.length;
}

// Edit Everywhere: the caller updates the post's text/media/buttons first,
// then this queues an `edit` operation for every delivery that actually
// reached Telegram — the original telegram_message_id is preserved so the
// same message gets edited, not reposted.
export async function updatePublishedPost(postId: string): Promise<number> {
  const supabase = supabaseAdmin();
  const { data: sent, error } = await supabase
    .from("post_deliveries")
    .select("id")
    .eq("post_id", postId)
    .eq("status", "sent");

  if (error) throw error;
  if (!sent || sent.length === 0) return 0;

  await supabase
    .from("post_deliveries")
    .update({ pending_operation: "edit", next_attempt_at: new Date().toISOString(), last_error: null })
    .in("id", sent.map((d) => d.id));

  return sent.length;
}

export async function deletePublishedPost(postId: string): Promise<number> {
  const supabase = supabaseAdmin();
  const { data: sent, error } = await supabase
    .from("post_deliveries")
    .select("id")
    .eq("post_id", postId)
    .eq("status", "sent");

  if (error) throw error;
  if (!sent || sent.length === 0) return 0;

  await supabase
    .from("post_deliveries")
    .update({ pending_operation: "delete", next_attempt_at: new Date().toISOString(), last_error: null })
    .in("id", sent.map((d) => d.id));

  return sent.length;
}

export async function duplicatePost(postId: string): Promise<string> {
  const supabase = supabaseAdmin();

  const [{ data: original, error: postErr }, { data: media }, { data: buttons }, { data: destinations }] =
    await Promise.all([
      supabase.from("posts").select("text, parse_mode").eq("id", postId).single(),
      supabase.from("post_media").select("media_type, storage_key, position").eq("post_id", postId),
      supabase.from("post_buttons").select("label, url, row_index, position").eq("post_id", postId),
      supabase.from("post_destinations").select("channel_id").eq("post_id", postId),
    ]);

  if (postErr || !original) throw new Error("Post not found.");

  const { data: copy, error: copyErr } = await supabase
    .from("posts")
    .insert({ text: original.text, parse_mode: original.parse_mode, status: "draft" })
    .select()
    .single();

  if (copyErr) throw copyErr;

  if (media && media.length > 0) {
    await supabase.from("post_media").insert(media.map((m) => ({ ...m, post_id: copy.id })));
  }
  if (buttons && buttons.length > 0) {
    await supabase.from("post_buttons").insert(buttons.map((b) => ({ ...b, post_id: copy.id })));
  }
  if (destinations && destinations.length > 0) {
    await supabase
      .from("post_destinations")
      .insert(destinations.map((d) => ({ ...d, post_id: copy.id })));
  }

  return copy.id;
}

// Scheduler: called by the cron worker to move due scheduled posts into the
// send queue. Idempotent — createDeliveriesForPost() no-ops on rows that
// already exist, so a post is never double-queued even if the cron tick
// overlaps a manual "publish now" click.
export async function dispatchDuePosts(): Promise<number> {
  const supabase = supabaseAdmin();
  const { data: due, error } = await supabase
    .from("posts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString());

  if (error) throw error;
  if (!due || due.length === 0) return 0;

  for (const post of due) {
    await publishPost(post.id);
  }

  return due.length;
}
