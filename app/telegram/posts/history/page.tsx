"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Pencil, Trash2 } from "lucide-react";
import StatusBadge from "@/components/telegram/StatusBadge";

type Post = {
  id: string;
  text: string;
  status: string;
  sent_at: string | null;
  created_at: string;
  destination_count: number;
  sent_count: number;
  failed_count: number;
};

const FILTERS = ["all", "sent", "scheduled", "failed", "draft"];

export default function PostHistoryPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [hasPrev, setHasPrev] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [total, setTotal] = useState(0);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async (targetPage: number, status: string) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(targetPage), limit: "20", status });
      const res = await fetch(`/api/telegram/posts?${query.toString()}`);
      const data = await res.json();
      setPosts(data.posts ?? []);
      setPage(data.page ?? targetPage);
      setHasPrev(Boolean(data.hasPrev));
      setHasNext(Boolean(data.hasNext));
      setTotal(Number(data.total ?? 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(1, filter);
  }, [filter, load]);

  async function duplicate(id: string) {
    const res = await fetch(`/api/telegram/posts/${id}/duplicate`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ text: data.error ?? "Failed to duplicate.", error: true });
      return;
    }
    setFeedback({ text: "Duplicated as a new draft." });
    await load(page, filter);
  }

  async function deleteDashboard(id: string) {
    if (!confirm("Remove this post from the dashboard? This does not delete it from Telegram.")) return;
    const res = await fetch(`/api/telegram/posts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setFeedback({ text: "Failed to delete post.", error: true });
      return;
    }
    await load(page, filter);
  }

  return (
    <div className="flex flex-col gap-7">
      <section className="panel" style={{ padding: "22px" }}>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Telegram</span>
          <h1 className="display text-2xl font-semibold tracking-tight">Post History</h1>
        </div>
      </section>

      {feedback && (
        <div className={feedback.error ? "panel-error" : "rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#f5f6fa]"}>
          {feedback.text}
        </div>
      )}

      <div className="panel flex flex-col gap-4" style={{ padding: "22px" }}>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`platform-pill ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "draft" ? "Drafts" : f}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          {!loading && posts.length === 0 && <div className="empty-state">No posts for this filter.</div>}
          {loading && <div className="text-sm text-[#8b8fa3]">Loading...</div>}

          {posts.map((post) => (
            <div key={post.id} className="panel-alt flex flex-col gap-3" style={{ padding: "16px" }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={post.status} />
                  <span className="mono text-xs text-[#64708f]">
                    {post.sent_at
                      ? new Date(post.sent_at).toLocaleString()
                      : new Date(post.created_at).toLocaleString()}
                  </span>
                </div>
              </div>

              <Link href={`/telegram/posts/${post.id}`} className="text-sm text-[#f5f6fa] hover:text-[#a78bfa] line-clamp-2">
                {post.text || <span className="text-[#64708f]">(no text)</span>}
              </Link>

              <div className="flex flex-wrap items-center gap-2 text-xs text-[#8b8fa3]">
                <span>{post.destination_count} destination{post.destination_count === 1 ? "" : "s"}</span>
                {post.destination_count > 0 && (
                  <>
                    <span className="badge badge-ok">{post.sent_count} successful</span>
                    {post.failed_count > 0 && <span className="badge badge-err">{post.failed_count} failed</span>}
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Link href={`/telegram/posts/${post.id}`} className="btn-secondary">
                  View
                </Link>
                <button type="button" className="btn-secondary flex items-center gap-1.5" onClick={() => void duplicate(post.id)}>
                  <Copy size={13} /> Duplicate
                </button>
                {(post.status === "sent" || post.status === "failed") && post.sent_count > 0 && (
                  <Link href={`/telegram/posts/${post.id}`} className="btn-secondary flex items-center gap-1.5">
                    <Pencil size={13} /> Edit Everywhere
                  </Link>
                )}
                <button type="button" className="btn-ghost text-[#ef4444] flex items-center gap-1.5" onClick={() => void deleteDashboard(post.id)}>
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 pt-2">
            <span className="text-xs text-[#8b8fa3]">Page {page} · {total} total</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={!hasPrev || loading}
                onClick={() => void load(page - 1, filter)}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!hasNext || loading}
                onClick={() => void load(page + 1, filter)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
