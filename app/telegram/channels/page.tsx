"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Plus, RefreshCw, Search, Square, Trash2, Users } from "lucide-react";
import Modal from "@/components/telegram/Modal";
import StatusBadge from "@/components/telegram/StatusBadge";

type Group = { id: string; name: string; channel_count: number };

type Channel = {
  id: string;
  telegram_chat_id: number;
  username: string | null;
  title: string;
  type: string;
  photo_url: string | null;
  member_count: number | null;
  publishing_enabled: boolean;
  status: string;
  bot_is_admin: boolean;
  bot_permissions: { can_post_messages?: boolean };
  channel_group_id: string | null;
  channel_groups: { id: string; name: string } | null;
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [chatIdInput, setChatIdInput] = useState("");
  const [connectGroupId, setConnectGroupId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    const res = await fetch("/api/telegram/channel-groups");
    const data = await res.json();
    setGroups(data.groups ?? []);
  }, []);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (search.trim()) query.set("q", search.trim());
      if (activeGroup) query.set("group_id", activeGroup);

      const res = await fetch(`/api/telegram/channels?${query.toString()}`);
      const data = await res.json();
      setChannels(data.channels ?? []);
    } finally {
      setLoading(false);
    }
  }, [search, activeGroup]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const timeout = setTimeout(() => void loadChannels(), 200);
    return () => clearTimeout(timeout);
  }, [loadChannels]);

  const totalCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.channel_count, 0),
    [groups]
  );

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function connectChannel() {
    if (!chatIdInput.trim()) return;
    setConnecting(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/telegram/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegram_chat_id: chatIdInput.trim(),
          channel_group_id: connectGroupId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to connect channel.");

      setFeedback({ text: `Connected "${data.channel.title}".` });
      setConnectOpen(false);
      setChatIdInput("");
      setConnectGroupId("");
      await Promise.all([loadChannels(), loadGroups()]);
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Failed to connect channel.", error: true });
    } finally {
      setConnecting(false);
    }
  }

  async function testChannel(id: string) {
    setTestingId(id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/telegram/channels/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed.");
      setFeedback({ text: `"${data.channel.title}" is ${data.channel.status}.` });
      await loadChannels();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Test failed.", error: true });
    } finally {
      setTestingId(null);
    }
  }

  async function togglePublishing(channel: Channel) {
    const res = await fetch("/api/telegram/channels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: channel.id, publishing_enabled: !channel.publishing_enabled }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ text: data.error ?? "Failed to update channel.", error: true });
      return;
    }
    await loadChannels();
  }

  async function removeChannel(id: string) {
    if (!confirm("Remove this channel from the dashboard? It will no longer receive posts.")) return;
    const res = await fetch(`/api/telegram/channels?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ text: data.error ?? "Failed to remove channel.", error: true });
      return;
    }
    await Promise.all([loadChannels(), loadGroups()]);
  }

  async function bulkSetPublishing(enabled: boolean) {
    await Promise.all(
      [...selected].map((id) =>
        fetch("/api/telegram/channels", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, publishing_enabled: enabled }),
        })
      )
    );
    setSelected(new Set());
    await loadChannels();
  }

  async function bulkRemove() {
    if (!confirm(`Remove ${selected.size} channel(s) from the dashboard?`)) return;
    await Promise.all(
      [...selected].map((id) => fetch(`/api/telegram/channels?id=${id}`, { method: "DELETE" }))
    );
    setSelected(new Set());
    await Promise.all([loadChannels(), loadGroups()]);
  }

  return (
    <div className="flex flex-col gap-7">
      <section className="panel flex flex-wrap items-center justify-between gap-4" style={{ padding: "22px" }}>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Telegram</span>
          <h1 className="display text-2xl font-semibold tracking-tight">Channels</h1>
          <p className="text-sm text-[#9aa3c7] max-w-2xl">
            Manage the channels your publishing bot posts to.
          </p>
        </div>
        <button type="button" className="btn flex items-center gap-2" onClick={() => setConnectOpen(true)}>
          <Plus size={15} /> Connect Channel
        </button>
      </section>

      {feedback && (
        <div className={feedback.error ? "panel-error" : "rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#f5f6fa]"}>
          {feedback.text}
        </div>
      )}

      <div className="panel flex flex-col gap-4" style={{ padding: "22px" }}>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64708f]" />
          <input
            className="input"
            style={{ paddingLeft: "34px" }}
            placeholder="Search channels..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`platform-pill ${!activeGroup ? "active" : ""}`}
            onClick={() => setActiveGroup(null)}
          >
            All Channels ({totalCount})
          </button>
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`platform-pill ${activeGroup === group.id ? "active" : ""}`}
              onClick={() => setActiveGroup(group.id)}
            >
              {group.name} ({group.channel_count})
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <div className="panel-alt flex flex-wrap items-center justify-between gap-3" style={{ padding: "12px" }}>
            <span className="text-xs text-[#9aa3c7]">{selected.size} selected</span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => void bulkSetPublishing(true)}>
                Enable
              </button>
              <button type="button" className="btn-secondary" onClick={() => void bulkSetPublishing(false)}>
                Disable
              </button>
              <button type="button" className="btn-ghost text-[#ef4444]" onClick={() => void bulkRemove()}>
                Remove
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {!loading && channels.length === 0 && (
            <div className="empty-state">
              No channels connected yet. Click &quot;Connect Channel&quot; to add your first one.
            </div>
          )}

          {loading && <div className="text-sm text-[#8b8fa3]">Loading channels...</div>}

          {channels.map((channel) => (
            <div key={channel.id} className="panel-alt flex flex-col gap-3" style={{ padding: "16px" }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    style={{ padding: "4px" }}
                    onClick={() => toggleSelected(channel.id)}
                    aria-label="Select channel"
                  >
                    {selected.has(channel.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>

                  {channel.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={channel.photo_url}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-app object-cover border border-white/10"
                    />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-app border border-white/10 bg-white/5">
                      <Users size={15} className="text-[#64708f]" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">{channel.title || "Untitled"}</span>
                      <StatusBadge status={channel.status} />
                      {!channel.publishing_enabled && <span className="badge badge-regular">disabled</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#8b8fa3]">
                      {channel.username && <span>@{channel.username}</span>}
                      <span className="mono">{channel.telegram_chat_id}</span>
                      {channel.member_count !== null && <span>{channel.member_count.toLocaleString()} members</span>}
                      {channel.channel_groups && <span className="badge badge-info">{channel.channel_groups.name}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1.5"
                    onClick={() => void testChannel(channel.id)}
                    disabled={testingId === channel.id}
                  >
                    <RefreshCw size={13} className={testingId === channel.id ? "animate-spin" : ""} />
                    Test
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => void togglePublishing(channel)}>
                    {channel.publishing_enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-[#ef4444]"
                    onClick={() => void removeChannel(channel.id)}
                    aria-label="Remove channel"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {channel.status === "permission_issue" && (
                <div className="text-xs text-[#fbbf24]">
                  The bot is in this chat but can&apos;t post messages. Grant it &quot;Post Messages&quot; permission.
                </div>
              )}
              {channel.status === "disconnected" && (
                <div className="text-xs text-[#ef4444]">
                  The bot is not an administrator here anymore.
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {connectOpen && (
        <Modal title="Connect Channel" onClose={() => setConnectOpen(false)}>
          <div className="flex flex-col gap-3 text-sm text-[#9aa3c7]">
            <p>
              Add the publishing bot as an administrator to your channel first (Settings has the
              full walkthrough), then paste its numeric chat ID below.
            </p>
            <div>
              <label className="field-label">Telegram chat ID</label>
              <input
                className="input mono"
                placeholder="-1001234567890"
                value={chatIdInput}
                onChange={(e) => setChatIdInput(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">Category (optional)</label>
              <select className="input" value={connectGroupId} onChange={(e) => setConnectGroupId(e.target.value)}>
                <option value="">No category</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => void connectChannel()}
              disabled={connecting || !chatIdInput.trim()}
            >
              {connecting ? "Connecting..." : "Connect"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
