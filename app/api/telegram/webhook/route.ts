import { after, NextRequest, NextResponse } from "next/server";
import { processUpdate, TelegramUpdate } from "@/lib/telegram/webhook-service";

export async function POST(req: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const provided = req.headers.get("x-telegram-bot-api-secret-token");

  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!update || typeof update.update_id !== "number") {
    return NextResponse.json({ error: "Invalid Telegram update." }, { status: 400 });
  }

  // Telegram expects a fast 2xx ack; process after responding.
  after(async () => {
    try {
      await processUpdate(update);
    } catch (error) {
      console.error("Telegram webhook processing failed:", error);
    }
  });

  return NextResponse.json({ ok: true });
}
