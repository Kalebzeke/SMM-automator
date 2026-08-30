import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import {
  getActiveBotToken,
  getBotChatMembership,
  getChat,
  getChatMemberCount,
  processTelegramError,
} from "@/lib/telegram/bot-api";
import { deriveChannelStatus } from "@/lib/telegram/webhook-service";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const groupId = searchParams.get("group_id");
  const status = searchParams.get("status");
  const publishingEnabled = searchParams.get("publishing_enabled");

  const supabase = supabaseAdmin();
  let query = supabase
    .from("telegram_channels")
    .select("*, channel_groups(id, name)")
    .order("created_at", { ascending: false });

  if (q) query = query.or(`title.ilike.%${q}%,username.ilike.%${q}%`);
  if (groupId) query = query.eq("channel_group_id", groupId);
  if (status) query = query.eq("status", status);
  if (publishingEnabled !== null && publishingEnabled !== undefined && publishingEnabled !== "") {
    query = query.eq("publishing_enabled", publishingEnabled === "true");
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ channels: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  try {
    const body = await req.json();
    const rawChatId = body.telegram_chat_id;
    const chatId = typeof rawChatId === "string" ? Number(rawChatId.trim()) : Number(rawChatId);

    if (!Number.isFinite(chatId) || chatId === 0) {
      return NextResponse.json(
        { error: "A valid numeric telegram_chat_id is required, e.g. -1001234567890." },
        { status: 400 }
      );
    }

    const { bot, token } = await getActiveBotToken();
    if (!bot.telegram_bot_id) {
      return NextResponse.json({ error: "Bot is not verified yet. Test the connection in Settings first." }, { status: 400 });
    }

    const chat = await getChat(token, chatId);

    if (chat.type !== "channel" && chat.type !== "supergroup") {
      return NextResponse.json(
        { error: `Unsupported chat type "${chat.type}". Connect a channel or supergroup.` },
        { status: 400 }
      );
    }

    const membership = await getBotChatMembership(token, chatId, Number(bot.telegram_bot_id));
    const { botIsAdmin, status } = deriveChannelStatus(membership);

    let memberCount: number | null = null;
    try {
      memberCount = await getChatMemberCount(token, chatId);
    } catch {
      memberCount = null;
    }

    const supabase = supabaseAdmin();
    const { data: upserted, error } = await supabase
      .from("telegram_channels")
      .upsert(
        {
          telegram_chat_id: chatId,
          username: chat.username ?? null,
          title: chat.title ?? "",
          type: chat.type,
          member_count: memberCount,
          publishing_enabled: true,
          status,
          bot_is_admin: botIsAdmin,
          bot_permissions: {
            can_post_messages: Boolean(membership.can_post_messages),
            can_edit_messages: Boolean(membership.can_edit_messages),
            can_delete_messages: Boolean(membership.can_delete_messages),
          },
          channel_group_id: typeof body.channel_group_id === "string" ? body.channel_group_id : null,
          last_verified_at: new Date().toISOString(),
        },
        { onConflict: "telegram_chat_id" }
      )
      .select("*, channel_groups(id, name)")
      .single();

    if (error) throw error;

    if (chat.photo) {
      await supabase
        .from("telegram_channels")
        .update({ photo_url: `/api/telegram/channels/${upserted.id}/photo` })
        .eq("id", upserted.id);
    }

    return NextResponse.json({ ok: true, channel: upserted });
  } catch (error) {
    const normalized = processTelegramError(error);
    return NextResponse.json(
      { error: normalized.description || "Failed to connect channel." },
      { status: 400 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const body = await req.json();
  const { id, ...rest } = body;
  if (typeof id !== "string") {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof rest.publishing_enabled === "boolean") update.publishing_enabled = rest.publishing_enabled;
  if (rest.channel_group_id === null || typeof rest.channel_group_id === "string") {
    update.channel_group_id = rest.channel_group_id;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("telegram_channels")
    .update(update)
    .eq("id", id)
    .select("*, channel_groups(id, name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, channel: data });
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const supabase = supabaseAdmin();
  const { error } = await supabase.from("telegram_channels").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
