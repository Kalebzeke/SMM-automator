"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Send, Users, XCircle } from "lucide-react";

type Stats = {
  connectedChannels: number;
  postsThisMonth: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  scheduledPosts: number;
  recentPosts: Array<{ id: string; text: string; status: string; created_at: string }>;
  recentFailures: Array<{
    id: string;
    last_error: string | null;
    posts: { id: string; text: string } | null;
    telegram_channels: { title: string } | null;
  }>;
};

export default function TelegramDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/telegram/stats");
        const data = await res.json();
        setStats(data);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-7">
      <section className="panel flex flex-wrap items-center justify-between gap-4" style={{ padding: "22px" }}>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Telegram</span>
          <h1 className="display text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-[#9aa3c7] max-w-2xl">
            Publishing overview across all connected channels.
          </p>
        </div>
        <Link href="/telegram/posts/new" className="btn flex items-center gap-2">
          <Send size={15} /> New Post
        </Link>
      </section>

      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-[#22d3ee]">
            <Users size={14} />
            <span className="text-xs">Connected channels</span>
          </div>
          <span className="display text-2xl font-semibold">{loading ? "..." : stats?.connectedChannels}</span>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-[#a78bfa]">
            <Send size={14} />
            <span className="text-xs">Posts this month</span>
          </div>
          <span className="display text-2xl font-semibold">{loading ? "..." : stats?.postsThisMonth}</span>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-[#2ecc71]">
            <CheckCircle2 size={14} />
            <span className="text-xs">Successful deliveries</span>
          </div>
          <span className="display text-2xl font-semibold">{loading ? "..." : stats?.successfulDeliveries}</span>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-[#ef4444]">
            <XCircle size={14} />
            <span className="text-xs">Failed deliveries</span>
          </div>
          <span className="display text-2xl font-semibold">{loading ? "..." : stats?.failedDeliveries}</span>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-[#fbbf24]">
            <Clock size={14} />
            <span className="text-xs">Scheduled posts</span>
          </div>
          <span className="display text-2xl font-semibold">{loading ? "..." : stats?.scheduledPosts}</span>
        </div>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel flex flex-col gap-3" style={{ padding: "20px" }}>
          <span className="text-sm font-semibold">Recent posts</span>
          {!loading && (stats?.recentPosts.length ?? 0) === 0 && <div className="empty-state">No posts yet.</div>}
          {stats?.recentPosts.map((post) => (
            <Link
              key={post.id}
              href={`/telegram/posts/${post.id}`}
              className="panel-alt flex items-center justify-between gap-3 hover:border-[#22d3ee]/40"
              style={{ padding: "10px 12px" }}
            >
              <span className="text-sm truncate">{post.text || "(no text)"}</span>
              <span className="badge badge-info shrink-0">{post.status}</span>
            </Link>
          ))}
        </div>

        <div className="panel flex flex-col gap-3" style={{ padding: "20px" }}>
          <span className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle size={14} className="text-[#ef4444]" /> Recent failures
          </span>
          {!loading && (stats?.recentFailures.length ?? 0) === 0 && (
            <div className="empty-state">No delivery failures. 🎉</div>
          )}
          {stats?.recentFailures.map((failure) => (
            <Link
              key={failure.id}
              href={failure.posts ? `/telegram/posts/${failure.posts.id}` : "#"}
              className="panel-alt flex flex-col gap-1 hover:border-[#ef4444]/40"
              style={{ padding: "10px 12px" }}
            >
              <span className="text-xs text-[#9aa3c7]">{failure.telegram_channels?.title ?? "Unknown channel"}</span>
              <span className="text-xs text-[#ef4444] truncate">{failure.last_error ?? "Unknown error"}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
