import { after, NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { createPost } from "@/lib/telegram/publishing-service";
import { runDeliveryWorker } from "@/lib/telegram/delivery-worker";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const parsedLimit = Number(searchParams.get("limit") ?? "25");
  const parsedPage = Number(searchParams.get("page") ?? "1");
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 100)) : 25;
  const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const supabase = supabaseAdmin();
  let query = supabase
    .from("posts")
    .select("*, post_destinations(count), post_deliveries(status)", { count: "exact" })
    .order("created_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const posts = (data ?? []).map((post) => {
    const deliveries = (post.post_deliveries ?? []) as Array<{ status: string }>;
    return {
      ...post,
      post_deliveries: undefined,
      destination_count: post.post_destinations?.[0]?.count ?? deliveries.length,
      sent_count: deliveries.filter((d) => d.status === "sent").length,
      failed_count: deliveries.filter((d) => d.status === "failed").length,
    };
  });

  return NextResponse.json({
    posts,
    page,
    limit,
    total: count ?? 0,
    hasPrev: page > 1,
    hasNext: from + (data?.length ?? 0) < (count ?? 0),
  });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  try {
    const body = await req.json();

    const text = typeof body.text === "string" ? body.text : "";
    const destinationChannelIds: string[] = Array.isArray(body.destination_channel_ids)
      ? body.destination_channel_ids.filter((id: unknown) => typeof id === "string")
      : [];
    const publishNow = body.publish_now === true;
    const scheduledAt = typeof body.scheduled_at === "string" ? body.scheduled_at : null;
    const isDraft = body.draft === true;

    const media =
      body.media && typeof body.media.storage_key === "string" && typeof body.media.media_type === "string"
        ? { mediaType: body.media.media_type, storageKey: body.media.storage_key }
        : null;

    const buttons = Array.isArray(body.buttons)
      ? body.buttons
          .filter((b: unknown) => b && typeof (b as { label?: unknown }).label === "string")
          .map((b: { label: string; url: string; row_index?: number; position?: number }, index: number) => ({
            label: b.label,
            url: b.url,
            row_index: b.row_index ?? 0,
            position: b.position ?? index,
          }))
      : [];

    if (isDraft) {
      const post = await createPost({
        text,
        media,
        buttons,
        destinationChannelIds,
        publishNow: false,
        scheduledAt: null,
      });
      return NextResponse.json({ ok: true, post });
    }

    if (destinationChannelIds.length === 0) {
      return NextResponse.json({ error: "Select at least one destination channel." }, { status: 400 });
    }

    if (!publishNow && !scheduledAt) {
      return NextResponse.json({ error: "Choose Send Now or a schedule time." }, { status: 400 });
    }

    const post = await createPost({
      text,
      media,
      buttons,
      destinationChannelIds,
      publishNow,
      scheduledAt,
    });

    if (publishNow) {
      after(async () => {
        try {
          await runDeliveryWorker();
        } catch (error) {
          console.error("Telegram delivery worker failed after publish:", error);
        }
      });
    }

    return NextResponse.json({ ok: true, post, queued: publishNow });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create post." },
      { status: 400 }
    );
  }
}
