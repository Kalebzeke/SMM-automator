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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const { id } = await params;
  const supabase = supabaseAdmin();

  const { data: channel, error: channelErr } = await supabase
    .from("telegram_channels")
    .select("*")
    .eq("id", id)
    .single();

  if (channelErr || !channel) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }

  try {
    const { bot, token } = await getActiveBotToken();
    if (!bot.telegram_bot_id) {
      throw new Error("Bot is not verified yet.");
    }

    const membership = await getBotChatMembership(token, channel.telegram_chat_id, Number(bot.telegram_bot_id));
    const { botIsAdmin, status } = deriveChannelStatus(membership);

    let memberCount = channel.member_count as number | null;
    try {
      memberCount = await getChatMemberCount(token, channel.telegram_chat_id);
    } catch {
      // keep last known count
    }

    let title = channel.title as string;
    let username = channel.username as string | null;
    try {
      const chat = await getChat(token, channel.telegram_chat_id);
      title = chat.title ?? title;
      username = chat.username ?? username;
    } catch {
      // chat lookup can fail if the bot was removed; permission check above already reflects that
    }

    const { data: updated, error: updateErr } = await supabase
      .from("telegram_channels")
      .update({
        bot_is_admin: botIsAdmin,
        status,
        title,
        username,
        member_count: memberCount,
        bot_permissions: {
          can_post_messages: Boolean(membership.can_post_messages),
          can_edit_messages: Boolean(membership.can_edit_messages),
          can_delete_messages: Boolean(membership.can_delete_messages),
        },
        last_verified_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*, channel_groups(id, name)")
      .single();

    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true, channel: updated });
  } catch (error) {
    const normalized = processTelegramError(error);

    await supabase
      .from("telegram_channels")
      .update({ status: "disconnected", last_verified_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json(
      { error: normalized.description || "Channel test failed." },
      { status: 400 }
    );
  }
}
