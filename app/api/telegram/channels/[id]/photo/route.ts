import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getActiveBotToken, getChat, getFileDownloadUrl } from "@/lib/telegram/bot-api";

// Proxies a channel's profile photo through the server so the raw Telegram
// file URL — which embeds the full bot token — is never sent to the browser.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = supabaseAdmin();

  const { data: channel } = await supabase
    .from("telegram_channels")
    .select("telegram_chat_id")
    .eq("id", id)
    .single();

  if (!channel) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }

  try {
    const { token } = await getActiveBotToken();
    const chat = await getChat(token, channel.telegram_chat_id);

    if (!chat.photo) {
      return NextResponse.json({ error: "No photo available." }, { status: 404 });
    }

    const fileUrl = await getFileDownloadUrl(token, chat.photo.small_file_id);
    const fileRes = await fetch(fileUrl);

    if (!fileRes.ok || !fileRes.body) {
      return NextResponse.json({ error: "Failed to fetch photo from Telegram." }, { status: 502 });
    }

    return new NextResponse(fileRes.body, {
      headers: {
        "Content-Type": fileRes.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to load photo." }, { status: 502 });
  }
}
