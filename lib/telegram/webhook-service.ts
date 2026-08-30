import { supabaseAdmin } from "@/lib/supabase";

type ChatMemberStatus = "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";

type TelegramChatMemberUpdated = {
  chat: { id: number; title?: string; username?: string; type: string };
  new_chat_member: {
    status: ChatMemberStatus;
    can_post_messages?: boolean;
    can_edit_messages?: boolean;
    can_delete_messages?: boolean;
  };
};

export type TelegramUpdate = {
  update_id: number;
  my_chat_member?: TelegramChatMemberUpdated;
};

export function deriveChannelStatus(member: TelegramChatMemberUpdated["new_chat_member"]) {
  if (member.status === "creator" || member.status === "administrator") {
    return {
      botIsAdmin: true,
      status: member.can_post_messages ? ("connected" as const) : ("permission_issue" as const),
    };
  }

  if (member.status === "member" || member.status === "restricted") {
    return { botIsAdmin: false, status: "permission_issue" as const };
  }

  return { botIsAdmin: false, status: "disconnected" as const };
}

// Keeps a previously-connected channel's status in sync with Telegram's
// my_chat_member updates: bot added/promoted/removed/demoted, or posting
// permission revoked. Registration itself still happens explicitly via
// "Connect Channel" — this only updates channels that already exist.
export async function handleMyChatMember(update: TelegramChatMemberUpdated): Promise<void> {
  const { chat, new_chat_member: member } = update;
  const { botIsAdmin, status } = deriveChannelStatus(member);

  const supabase = supabaseAdmin();
  const { data: existing } = await supabase
    .from("telegram_channels")
    .select("id")
    .eq("telegram_chat_id", chat.id)
    .maybeSingle();

  if (!existing) return;

  await supabase
    .from("telegram_channels")
    .update({
      bot_is_admin: botIsAdmin,
      status,
      bot_permissions: {
        can_post_messages: Boolean(member.can_post_messages),
        can_edit_messages: Boolean(member.can_edit_messages),
        can_delete_messages: Boolean(member.can_delete_messages),
      },
      title: chat.title ?? undefined,
      username: chat.username ?? undefined,
      last_verified_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
}

export async function processUpdate(update: TelegramUpdate): Promise<void> {
  if (update.my_chat_member) {
    await handleMyChatMember(update.my_chat_member);
  }
}
