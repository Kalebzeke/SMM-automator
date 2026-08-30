"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

type Group = { id: string; name: string; channel_count: number };

export default function ChannelGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/telegram/channel-groups");
      const data = await res.json();
      setGroups(data.groups ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function createGroup() {
    if (!name.trim()) return;
    setCreating(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/telegram/channel-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create category.");
      setName("");
      await load();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Failed to create category.", error: true });
    } finally {
      setCreating(false);
    }
  }

  async function saveRename(id: string) {
    if (!editingName.trim()) return;
    const res = await fetch("/api/telegram/channel-groups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: editingName.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ text: data.error ?? "Failed to rename category.", error: true });
      return;
    }
    setEditingId(null);
    await load();
  }

  async function removeGroup(id: string) {
    if (!confirm("Delete this category? Channels in it will become uncategorized.")) return;
    const res = await fetch(`/api/telegram/channel-groups?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ text: data.error ?? "Failed to delete category.", error: true });
      return;
    }
    await load();
  }

  return (
    <div className="flex flex-col gap-7">
      <section className="panel" style={{ padding: "22px" }}>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Telegram</span>
          <h1 className="display text-2xl font-semibold tracking-tight">Channel Groups</h1>
          <p className="text-sm text-[#9aa3c7] max-w-2xl">
            Organize channels into categories like Crypto, News, or VIP so you can target them at
            once from the composer.
          </p>
        </div>
      </section>

      {feedback && <div className="panel-error">{feedback.text}</div>}

      <div className="panel flex flex-col gap-4" style={{ padding: "22px" }}>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="New category name, e.g. Crypto"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createGroup()}
          />
          <button type="button" className="btn flex items-center gap-2 shrink-0" onClick={() => void createGroup()} disabled={creating || !name.trim()}>
            <Plus size={14} /> {creating ? "Adding..." : "Add category"}
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {!loading && groups.length === 0 && <div className="empty-state">No categories yet.</div>}
          {loading && <div className="text-sm text-[#8b8fa3]">Loading...</div>}

          {groups.map((group) => (
            <div key={group.id} className="panel-alt flex items-center justify-between gap-3" style={{ padding: "14px" }}>
              {editingId === group.id ? (
                <input
                  className="input"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveRename(group.id)}
                  autoFocus
                />
              ) : (
                <span className="text-sm font-medium">
                  {group.name} <span className="text-xs text-[#64708f]">({group.channel_count})</span>
                </span>
              )}

              <div className="flex items-center gap-2 shrink-0">
                {editingId === group.id ? (
                  <button type="button" className="btn-secondary" onClick={() => void saveRename(group.id)}>
                    Save
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setEditingId(group.id);
                      setEditingName(group.name);
                    }}
                    aria-label="Rename"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                <button type="button" className="btn-ghost text-[#ef4444]" onClick={() => void removeGroup(group.id)} aria-label="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
