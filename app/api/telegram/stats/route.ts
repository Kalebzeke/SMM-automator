import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const supabase = supabaseAdmin();

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [
    { count: connectedChannels },
    { count: postsThisMonth },
    { count: successfulDeliveries },
    { count: failedDeliveries },
    { count: scheduledPosts },
    { data: recentPosts },
    { data: recentFailures },
  ] = await Promise.all([
    supabase
      .from("telegram_channels")
      .select("id", { count: "exact", head: true })
      .eq("status", "connected"),
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfMonth.toISOString()),
    supabase
      .from("post_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent"),
    supabase
      .from("post_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "scheduled"),
    supabase
      .from("posts")
      .select("id, text, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("post_deliveries")
      .select("id, last_error, updated_at, posts(id, text), telegram_channels(title)")
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  return NextResponse.json({
    connectedChannels: connectedChannels ?? 0,
    postsThisMonth: postsThisMonth ?? 0,
    successfulDeliveries: successfulDeliveries ?? 0,
    failedDeliveries: failedDeliveries ?? 0,
    scheduledPosts: scheduledPosts ?? 0,
    recentPosts: recentPosts ?? [],
    recentFailures: recentFailures ?? [],
  });
}
