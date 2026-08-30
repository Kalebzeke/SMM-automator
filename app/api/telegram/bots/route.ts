import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { encryptToken, tokenPreview, decryptToken } from "@/lib/telegram/crypto";
import { processTelegramError, validateBotToken } from "@/lib/telegram/bot-api";
import { isRateLimited, requestIp } from "@/lib/telegram/rate-limit";
import { TelegramBotRow } from "@/lib/telegram/types";

function toSafeBot(bot: TelegramBotRow) {
  let preview: string | null = null;
  try {
    preview = tokenPreview(decryptToken(bot.encrypted_token));
  } catch {
    preview = null;
  }

  return {
    id: bot.id,
    telegram_bot_id: bot.telegram_bot_id,
    username: bot.username,
    status: bot.status,
    is_active: bot.is_active,
    last_verified_at: bot.last_verified_at,
    created_at: bot.created_at,
    token_preview: preview,
  };
}

export async function GET() {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("telegram_bots")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    bots: (data as TelegramBotRow[]).map(toSafeBot),
  });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  if (isRateLimited(`bot-connect:${requestIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const token = typeof body.token === "string" ? body.token.trim() : "";

    if (!token) {
      return NextResponse.json({ error: "Bot token is required." }, { status: 400 });
    }

    const me = await validateBotToken(token);
    const supabase = supabaseAdmin();

    // Single active publishing bot for now; keep prior bots around
    // (deactivated) rather than deleting, in case deliveries reference them.
    await supabase.from("telegram_bots").update({ is_active: false }).eq("is_active", true);

    const { data, error } = await supabase
      .from("telegram_bots")
      .insert({
        telegram_bot_id: String(me.id),
        username: me.username,
        encrypted_token: encryptToken(token),
        status: "connected",
        is_active: true,
        last_verified_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, bot: toSafeBot(data as TelegramBotRow) });
  } catch (error) {
    const normalized = processTelegramError(error);
    return NextResponse.json(
      { error: normalized.description || "Failed to connect bot." },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from("telegram_bots")
    .update({ is_active: false, status: "disconnected" })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
