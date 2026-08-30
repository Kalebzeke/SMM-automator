"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Send, X } from "lucide-react";

type Post = {
  id: string;
  text: string;
  scheduled_at: string | null;
  destination_count: number;
};

export default function ScheduledPostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/telegram/posts?status=scheduled&limit=100");
      const data = await res.json();
      const sorted = [...(data.posts ?? [])].sort((a: Post, b: Post) =>
        (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "")
      );
      setPosts(sorted);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function publishNow(id: string) {
    setBusyId(id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/telegram/posts/${id}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to publish.");
      setFeedback({ text: "Publishing queued." });
      await load();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Failed to publish.", error: true });
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(id: string) {
    if (!confirm("Cancel this scheduled post?")) return;
    setBusyId(id);
    try {
      await fetch(`/api/telegram/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: null }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <section className="panel" style={{ padding: "22px" }}>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Telegram</span>
          <h1 className="display text-2xl font-semibold tracking-tight">Scheduled Posts</h1>
        </div>
      </section>

      {feedback && (
        <div className={feedback.error ? "panel-error" : "rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#f5f6fa]"}>
          {feedback.text}
        </div>
      )}

      <div className="panel flex flex-col gap-3" style={{ padding: "22px" }}>
        {!loading && posts.length === 0 && <div className="empty-state">Nothing scheduled.</div>}
        {loading && <div className="text-sm text-[#8b8fa3]">Loading...</div>}

        {posts.map((post) => (
          <div key={post.id} className="panel-alt flex flex-col gap-3" style={{ padding: "16px" }}>
            <div className="flex items-center gap-2 text-xs text-[#22d3ee]">
              <Clock size={13} />
              {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : "No time set"}
            </div>

            <Link href={`/telegram/posts/${post.id}`} className="text-sm text-[#f5f6fa] hover:text-[#a78bfa] line-clamp-2">
              {post.text || <span className="text-[#64708f]">(no text)</span>}
            </Link>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[#8b8fa3]">
                {post.destination_count} destination{post.destination_count === 1 ? "" : "s"}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary flex items-center gap-1.5"
                  onClick={() => void publishNow(post.id)}
                  disabled={busyId === post.id}
                >
                  <Send size={13} /> Publish Now
                </button>
                <button
                  type="button"
                  className="btn-ghost text-[#ef4444] flex items-center gap-1.5"
                  onClick={() => void cancel(post.id)}
                  disabled={busyId === post.id}
                >
                  <X size={13} /> Cancel
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
