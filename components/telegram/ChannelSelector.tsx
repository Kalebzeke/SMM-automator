"use client";

import { useEffect, useState } from "react";
import { CheckSquare, Square } from "lucide-react";

type Group = { id: string; name: string; channel_count: number };
type Channel = {
  id: string;
  title: string;
  username: string | null;
  publishing_enabled: boolean;
  status: string;
  channel_group_id: string | null;
};

export default function ChannelSelector({
  selected,
  onChange,
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [channelsRes, groupsRes] = await Promise.all([
          fetch("/api/telegram/channels?publishing_enabled=true"),
          fetch("/api/telegram/channel-groups"),
        ]);
        const channelsData = await channelsRes.json();
        const groupsData = await groupsRes.json();
        setChannels(channelsData.channels ?? []);
        setGroups(groupsData.groups ?? []);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const publishable = channels.filter((c) => c.status === "connected");

  function toggleChannel(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function toggleAll() {
    if (selected.size === publishable.length) {
      onChange(new Set());
    } else {
      onChange(new Set(publishable.map((c) => c.id)));
    }
  }

  function toggleGroup(groupId: string) {
    const groupChannelIds = publishable.filter((c) => c.channel_group_id === groupId).map((c) => c.id);
    const allSelected = groupChannelIds.every((id) => selected.has(id));
    const next = new Set(selected);

    if (allSelected) {
      groupChannelIds.forEach((id) => next.delete(id));
    } else {
      groupChannelIds.forEach((id) => next.add(id));
    }

    onChange(next);
  }

  if (loading) {
    return <div className="text-sm text-[#8b8fa3]">Loading channels...</div>;
  }

  if (publishable.length === 0) {
    return (
      <div className="empty-state">
        No connected channels with publishing enabled yet. Add one in Telegram → Channels.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className="flex items-center gap-2 text-sm font-medium"
        onClick={toggleAll}
      >
        {selected.size === publishable.length ? (
          <CheckSquare size={16} className="text-[#22d3ee]" />
        ) : (
          <Square size={16} className="text-[#64708f]" />
        )}
        All Channels ({publishable.length})
      </button>

      {groups.map((group) => {
        const groupChannels = publishable.filter((c) => c.channel_group_id === group.id);
        if (groupChannels.length === 0) return null;
        const allSelected = groupChannels.every((c) => selected.has(c.id));

        return (
          <div key={group.id} className="flex flex-col gap-1.5 pl-1">
            <button
              type="button"
              className="flex items-center gap-2 text-sm text-[#9aa3c7]"
              onClick={() => toggleGroup(group.id)}
            >
              {allSelected ? (
                <CheckSquare size={15} className="text-[#22d3ee]" />
              ) : (
                <Square size={15} className="text-[#64708f]" />
              )}
              {group.name} ({groupChannels.length})
            </button>

            <div className="flex flex-col gap-1 pl-6">
              {groupChannels.map((channel) => (
                <label key={channel.id} className="flex items-center gap-2 text-xs text-[#8b8fa3] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(channel.id)}
                    onChange={() => toggleChannel(channel.id)}
                  />
                  {channel.title}
                  {channel.username && <span className="text-[#64708f]">@{channel.username}</span>}
                </label>
              ))}
            </div>
          </div>
        );
      })}

      {(() => {
        const uncategorized = publishable.filter((c) => !c.channel_group_id);
        if (uncategorized.length === 0) return null;
        return (
          <div className="flex flex-col gap-1 pl-6">
            <span className="text-xs text-[#64708f]">Uncategorized</span>
            {uncategorized.map((channel) => (
              <label key={channel.id} className="flex items-center gap-2 text-xs text-[#8b8fa3] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(channel.id)}
                  onChange={() => toggleChannel(channel.id)}
                />
                {channel.title}
                {channel.username && <span className="text-[#64708f]">@{channel.username}</span>}
              </label>
            ))}
          </div>
        );
      })()}

      <div className="text-xs text-[#9aa3c7] pt-1 border-t border-white/10">
        {selected.size} channel{selected.size === 1 ? "" : "s"} selected
      </div>
    </div>
  );
}
