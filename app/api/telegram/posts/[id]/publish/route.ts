import { after, NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { publishPost } from "@/lib/telegram/publishing-service";
import { runDeliveryWorker } from "@/lib/telegram/delivery-worker";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const { id } = await params;

  try {
    await publishPost(id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to publish post." },
      { status: 400 }
    );
  }

  after(async () => {
    try {
      await runDeliveryWorker();
    } catch (error) {
      console.error("Telegram delivery worker failed after publish:", error);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}
