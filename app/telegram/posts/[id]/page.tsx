"use client";

import { useCallback, useEffect, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pencil, RefreshCw, Send, Trash2 } from "lucide-react";
import ChannelSelector from "@/components/telegram/ChannelSelector";
import StatusBadge from "@/components/telegram/StatusBadge";
import { sanitizeTelegramHtml } from "@/lib/telegram/formatting";

type Post = {
  id: string;
  text: string;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
};

type Delivery = {
  id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  telegram_channels: { id: string; title: string; username: string | null } | null;
};

type Destination = { channel_id: string; telegram_channels: { id: string; title: string } | null };

export default function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();

  const [post, setPost] = useState<Post | null>(null);
  const [buttons, setButtons] = useState<Array<{ label: string; url: string }>>([]);
  const [media, setMedia] = useState<{ media_type: string; public_url: string } | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editSelected, setEditSelected] = useState<Set<string>>(new Set());
  const [scheduledAtLocal, setScheduledAtLocal] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/posts/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Post not found.");

      setPost(data.post);
      setButtons(data.buttons ?? []);
      setMedia(data.media?.[0] ?? null);
      setDeliveries(data.deliveries ?? []);
      setDestinations(data.destinations ?? []);
      setEditText(data.post.text ?? "");
      setEditSelected(new Set((data.destinations ?? []).map((d: Destination) => d.channel_id)));
      setScheduledAtLocal(
        data.post.scheduled_at ? new Date(data.post.scheduled_at).toISOString().slice(0, 16) : ""
      );
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Failed to load post.", error: true });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function saveEdits() {
    setBusy(true);
    setFeedback(null);
    try {
      const body: Record<string, unknown> = { text: editText };
      if (post?.status === "draft" || post?.status === "scheduled") {
        body.destination_channel_ids = [...editSelected];
      }
      if (post?.status === "scheduled" && scheduledAtLocal) {
        body.scheduled_at = new Date(scheduledAtLocal).toISOString();
      }

      const res = await fetch(`/api/telegram/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save.");

      setEditing(false);
      await load();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Failed to save.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function publishNow() {
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function retryFailed() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/telegram/posts/${id}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Retry failed.");
      setFeedback({ text: data.message ?? `Retrying ${data.retried} channel(s).` });
      await load();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Retry failed.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function pushEditEverywhere() {
    if (!confirm("Push the current text/buttons to every channel this post was sent to?")) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/telegram/posts/${id}/edit-everywhere`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to queue updates.");
      setFeedback({ text: data.message ?? `Updating ${data.queued} channel(s).` });
      await load();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Failed to queue updates.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function deleteEverywhere() {
    if (!confirm("Delete this post from every Telegram channel it was sent to? This cannot be undone.")) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/telegram/posts/${id}/delete-everywhere`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to queue deletions.");
      setFeedback({ text: data.message ?? `Deleting from ${data.queued} channel(s).` });
      await load();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Failed to queue deletions.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function deleteFromDashboard() {
    if (!confirm("Remove this post from the dashboard? This does not delete it from Telegram.")) return;
    const res = await fetch(`/api/telegram/posts/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ text: data.error ?? "Failed to delete post.", error: true });
      return;
    }
    router.push("/telegram/posts/history");
  }

  async function duplicate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/telegram/posts/${id}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to duplicate.");
      router.push(`/telegram/posts/${data.postId}`);
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Failed to duplicate.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function cancelSchedule() {
    setBusy(true);
    try {
      const res = await fetch(`/api/telegram/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: null }),
      });
      if (!res.ok) throw new Error("Failed to cancel schedule.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-sm text-[#8b8fa3]">Loading...</div>;
  if (!post) return <div className="panel-error">Post not found.</div>;

  const sentCount = deliveries.filter((d) => d.status === "sent").length;
  const failedCount = deliveries.filter((d) => d.status === "failed").length;
  const total = deliveries.length;

  return (
    <div className="flex flex-col gap-7">
      <section className="panel flex flex-wrap items-center justify-between gap-4" style={{ padding: "22px" }}>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Telegram Post</span>
          <div className="flex items-center gap-2">
            <StatusBadge status={post.status} />
            <span className="text-xs text-[#64708f]">
              Created {new Date(post.created_at).toLocaleString()}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void duplicate()} disabled={busy}>
            <Copy size={14} /> Duplicate
          </button>
          {(post.status === "draft" || post.status === "scheduled") && (
            <button type="button" className="btn flex items-center gap-2" onClick={() => void publishNow()} disabled={busy}>
              <Send size={14} /> Publish Now
            </button>
          )}
          {post.status === "scheduled" && (
            <button type="button" className="btn-secondary" onClick={() => void cancelSchedule()} disabled={busy}>
              Cancel Schedule
            </button>
          )}
          {(post.status === "sent" || post.status === "failed") && failedCount > 0 && (
            <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void retryFailed()} disabled={busy}>
              <RefreshCw size={14} /> Retry Failed
            </button>
          )}
          {(post.status === "sent" || post.status === "failed") && sentCount > 0 && (
            <>
              <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void pushEditEverywhere()} disabled={busy || editing}>
                <Pencil size={14} /> Update Published Messages
              </button>
              <button type="button" className="btn-secondary text-[#ef4444] flex items-center gap-2" onClick={() => void deleteEverywhere()} disabled={busy}>
                <Trash2 size={14} /> Delete Everywhere
              </button>
            </>
          )}
          <button type="button" className="btn-ghost text-[#ef4444]" onClick={() => void deleteFromDashboard()}>
            Delete from Dashboard
          </button>
        </div>
      </section>

      {feedback && (
        <div className={feedback.error ? "panel-error" : "rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#f5f6fa]"}>
          {feedback.text}
        </div>
      )}

      <div className="grid gap-6" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
        <div className="panel flex flex-col gap-4" style={{ padding: "20px" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Content</span>
            {!editing ? (
              <button type="button" className="btn-ghost flex items-center gap-1.5" onClick={() => setEditing(true)}>
                <Pencil size={13} /> Edit Post
              </button>
            ) : (
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button type="button" className="btn" onClick={() => void saveEdits()} disabled={busy}>
                  Save
                </button>
              </div>
            )}
          </div>

          {editing ? (
            <textarea
              className="input"
              style={{ minHeight: "160px" }}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
            />
          ) : (
            <div
              className="panel-alt text-sm leading-relaxed"
              style={{ padding: "14px" }}
              dangerouslySetInnerHTML={{ __html: sanitizeTelegramHtml(post.text).replace(/\n/g, "<br/>") }}
            />
          )}

          {media && (
            <div className="text-xs text-[#8b8fa3]">Media: {media.media_type}</div>
          )}

          {buttons.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {buttons.map((b, i) => (
                <span key={i} className="badge badge-info">{b.label}</span>
              ))}
            </div>
          )}

          {editing && (post.status === "draft" || post.status === "scheduled") && (
            <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
              <span className="field-label">Destinations</span>
              <ChannelSelector selected={editSelected} onChange={setEditSelected} />
            </div>
          )}

          {editing && post.status === "scheduled" && (
            <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
              <span className="field-label">Scheduled for</span>
              <input
                type="datetime-local"
                className="input"
                value={scheduledAtLocal}
                onChange={(e) => setScheduledAtLocal(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="panel flex flex-col gap-3" style={{ padding: "20px" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Delivery status</span>
            {total > 0 && (
              <span className="text-xs text-[#9aa3c7]">
                {sentCount} / {total} sent successfully
              </span>
            )}
          </div>

          {total === 0 ? (
            <div className="empty-state">
              {destinations.length} destination{destinations.length === 1 ? "" : "s"} selected — not
              published yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {deliveries.map((delivery) => (
                <div key={delivery.id} className="panel-alt flex items-center justify-between gap-3" style={{ padding: "10px 12px" }}>
                  <span className="text-sm truncate">
                    {delivery.telegram_channels?.title ?? "Unknown channel"}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {delivery.last_error && (
                      <span className="text-xs text-[#ef4444] truncate max-w-[160px]" title={delivery.last_error}>
                        {delivery.last_error}
                      </span>
                    )}
                    <StatusBadge status={delivery.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
