import { after, NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { deletePublishedPost } from "@/lib/telegram/publishing-service";
import { runDeliveryWorker } from "@/lib/telegram/delivery-worker";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const { id } = await params;

  let queued: number;
  try {
    queued = await deletePublishedPost(id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to queue deletions." },
      { status: 400 }
    );
  }

  if (queued === 0) {
    return NextResponse.json({ ok: true, queued: 0, message: "No sent deliveries to delete." });
  }

  after(async () => {
    try {
      await runDeliveryWorker();
    } catch (error) {
      console.error("Telegram delivery worker failed after delete-everywhere:", error);
    }
  });

  return NextResponse.json({ ok: true, queued });
}
