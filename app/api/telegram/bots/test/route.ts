import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { getActiveBotToken, processTelegramError, validateBotToken } from "@/lib/telegram/bot-api";
import { isRateLimited, requestIp } from "@/lib/telegram/rate-limit";

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  if (isRateLimited(`bot-test:${requestIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  try {
    const { bot, token } = await getActiveBotToken();
    const me = await validateBotToken(token);

    const supabase = supabaseAdmin();
    const { error } = await supabase
      .from("telegram_bots")
      .update({
        status: "connected",
        last_verified_at: new Date().toISOString(),
        telegram_bot_id: String(me.id),
        username: me.username,
      })
      .eq("id", bot.id);

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      username: me.username,
      telegram_bot_id: me.id,
    });
  } catch (error) {
    const normalized = processTelegramError(error);

    // Mark the bot invalid if Telegram flatly rejected the stored token.
    if (normalized.code === 401 || normalized.code === 404) {
      const supabase = supabaseAdmin();
      await supabase
        .from("telegram_bots")
        .update({ status: "invalid" })
        .eq("is_active", true);
    }

    return NextResponse.json(
      { error: normalized.description || "Bot connection test failed." },
      { status: 400 }
    );
  }
}
