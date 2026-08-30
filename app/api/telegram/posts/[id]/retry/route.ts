import { after, NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { retryFailedDeliveries } from "@/lib/telegram/publishing-service";
import { runDeliveryWorker } from "@/lib/telegram/delivery-worker";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const { id } = await params;

  let retried: number;
  try {
    retried = await retryFailedDeliveries(id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to retry deliveries." },
      { status: 400 }
    );
  }

  if (retried === 0) {
    return NextResponse.json({ ok: true, retried: 0, message: "No failed deliveries to retry." });
  }

  after(async () => {
    try {
      await runDeliveryWorker();
    } catch (error) {
      console.error("Telegram delivery worker failed after retry:", error);
    }
  });

  return NextResponse.json({ ok: true, retried });
}
