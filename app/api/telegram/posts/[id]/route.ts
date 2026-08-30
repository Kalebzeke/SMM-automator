import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = supabaseAdmin();

  const { data: post, error } = await supabase.from("posts").select("*").eq("id", id).single();
  if (error || !post) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  const [{ data: media }, { data: buttons }, { data: deliveries }, { data: destinations }] = await Promise.all([
    supabase
      .from("post_media")
      .select("id, media_type, storage_key, position")
      .eq("post_id", id)
      .order("position", { ascending: true }),
    supabase
      .from("post_buttons")
      .select("id, label, url, row_index, position")
      .eq("post_id", id)
      .order("row_index", { ascending: true })
      .order("position", { ascending: true }),
    supabase
      .from("post_deliveries")
      .select("*, telegram_channels(id, title, username, telegram_chat_id)")
      .eq("post_id", id),
    supabase
      .from("post_destinations")
      .select("channel_id, telegram_channels(id, title, username)")
      .eq("post_id", id),
  ]);

  const mediaWithUrls = (media ?? []).map((m) => ({
    ...m,
    public_url: supabase.storage.from("telegram-media").getPublicUrl(m.storage_key).data.publicUrl,
  }));

  return NextResponse.json({
    post,
    media: mediaWithUrls,
    buttons: buttons ?? [],
    deliveries: deliveries ?? [],
    destinations: destinations ?? [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const { id } = await params;
  const supabase = supabaseAdmin();
  const body = await req.json();

  const { data: existing, error: existingErr } = await supabase
    .from("posts")
    .select("status")
    .eq("id", id)
    .single();

  if (existingErr || !existing) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  const postUpdate: Record<string, unknown> = {};
  if (typeof body.text === "string") postUpdate.text = body.text;
  if (typeof body.scheduled_at === "string" || body.scheduled_at === null) {
    postUpdate.scheduled_at = body.scheduled_at;
  }

  if (Object.keys(postUpdate).length > 0) {
    const { error } = await supabase.from("posts").update(postUpdate).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (Array.isArray(body.buttons)) {
    await supabase.from("post_buttons").delete().eq("post_id", id);
    if (body.buttons.length > 0) {
      await supabase.from("post_buttons").insert(
        body.buttons.map((b: { label: string; url: string; row_index?: number; position?: number }, index: number) => ({
          post_id: id,
          label: b.label,
          url: b.url,
          row_index: b.row_index ?? 0,
          position: b.position ?? index,
        }))
      );
    }
  }

  if (body.media !== undefined) {
    await supabase.from("post_media").delete().eq("post_id", id);
    if (body.media && typeof body.media.storage_key === "string") {
      await supabase.from("post_media").insert({
        post_id: id,
        media_type: body.media.media_type,
        storage_key: body.media.storage_key,
        position: 0,
      });
    }
  }

  if (Array.isArray(body.destination_channel_ids)) {
    if (existing.status !== "draft" && existing.status !== "scheduled") {
      return NextResponse.json(
        { error: "Destinations can only be changed for drafts and scheduled posts." },
        { status: 400 }
      );
    }

    await supabase.from("post_destinations").delete().eq("post_id", id);
    if (body.destination_channel_ids.length > 0) {
      await supabase.from("post_destinations").insert(
        body.destination_channel_ids.map((channelId: string) => ({ post_id: id, channel_id: channelId }))
      );
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const { id } = await params;
  const supabase = supabaseAdmin();
  const { error } = await supabase.from("posts").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
