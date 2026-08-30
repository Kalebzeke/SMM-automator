import { NextRequest, NextResponse } from "next/server";
import { dispatchDuePosts } from "@/lib/telegram/publishing-service";
import { runDeliveryWorker } from "@/lib/telegram/delivery-worker";

function isAuthorized(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${expected}`) return true;

  return new URL(req.url).searchParams.get("secret") === expected;
}

async function runWorker(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dispatchedPosts = await dispatchDuePosts();

  let totalProcessed = 0;
  // Drain the queue within one invocation, bounded so a busy queue can't
  // run past the serverless function's time budget.
  for (let i = 0; i < 10; i++) {
    const { processed } = await runDeliveryWorker();
    totalProcessed += processed;
    if (processed === 0) break;
  }

  return NextResponse.json({ ok: true, dispatchedPosts, deliveriesProcessed: totalProcessed });
}

export async function GET(req: NextRequest) {
  return runWorker(req);
}

export async function POST(req: NextRequest) {
  return runWorker(req);
}
