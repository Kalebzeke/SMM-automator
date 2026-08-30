import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";

export async function GET() {
  const supabase = supabaseAdmin();
  const { data: groups, error } = await supabase
    .from("channel_groups")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withCounts = await Promise.all(
    (groups ?? []).map(async (group) => {
      const { count } = await supabase
        .from("telegram_channels")
        .select("id", { count: "exact", head: true })
        .eq("channel_group_id", group.id);

      return { ...group, channel_count: count ?? 0 };
    })
  );

  return NextResponse.json({ groups: withCounts });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Group name is required." }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("channel_groups")
    .insert({ name })
    .select()
    .single();

  if (error) {
    const message = error.code === "23505" ? "A group with this name already exists." : error.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, group: data });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const body = await req.json();
  const { id, name } = body;
  if (typeof id !== "string" || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "id and name are required." }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("channel_groups")
    .update({ name: name.trim() })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, group: data });
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const supabase = supabaseAdmin();
  const { error } = await supabase.from("channel_groups").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
