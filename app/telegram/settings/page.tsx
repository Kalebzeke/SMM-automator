"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Link2, RefreshCw, XCircle } from "lucide-react";

type BotInfo = {
  id: string;
  telegram_bot_id: string | null;
  username: string | null;
  status: string;
  is_active: boolean;
  last_verified_at: string | null;
  token_preview: string | null;
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "connected" ? "badge-ok" : status === "invalid" ? "badge-err" : "badge-warn";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export default function TelegramSettingsPage() {
  const [bot, setBot] = useState<BotInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  const loadBot = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/telegram/bots");
      const data = await res.json();
      const active = (data.bots ?? []).find((b: BotInfo) => b.is_active) ?? null;
      setBot(active);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBot();
  }, [loadBot]);

  async function connectBot() {
    if (!token.trim()) return;
    setConnecting(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/telegram/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Failed to connect bot.");

      setToken("");
      setFeedback({ text: `Connected to @${data.bot.username ?? "bot"}.` });
      await loadBot();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Failed to connect bot.", error: true });
    } finally {
      setConnecting(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/telegram/bots/test", { method: "POST" });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Connection test failed.");

      setFeedback({ text: `Bot is reachable: @${data.username ?? "bot"}.` });
      await loadBot();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Connection test failed.", error: true });
    } finally {
      setTesting(false);
    }
  }

  async function disconnectBot() {
    if (!bot) return;
    if (!confirm("Disconnect this bot? Channels will stop receiving new posts until you connect another.")) {
      return;
    }

    setFeedback(null);
    try {
      const res = await fetch(`/api/telegram/bots?id=${bot.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to disconnect bot.");
      await loadBot();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Failed to disconnect bot.", error: true });
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <section className="panel" style={{ padding: "22px" }}>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Telegram</span>
          <h1 className="display text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-[#9aa3c7] max-w-2xl">
            Connect the Telegram bot that publishes to your channels. Create one with{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              className="text-[#a78bfa] hover:underline"
            >
              @BotFather
            </a>{" "}
            and paste its token below.
          </p>
        </div>
      </section>

      {feedback && (
        <div className={feedback.error ? "panel-error" : "rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#f5f6fa]"}>
          {feedback.text}
        </div>
      )}

      <div className="panel flex flex-col gap-4" style={{ padding: "22px" }}>
        <div className="text-sm font-semibold">Publishing bot</div>

        {loading ? (
          <div className="text-sm text-[#8b8fa3]">Loading...</div>
        ) : bot ? (
          <div className="panel-alt flex flex-col gap-3" style={{ padding: "16px" }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-semibold">@{bot.username ?? "unknown"}</span>
                <StatusBadge status={bot.status} />
              </div>
              <span className="mono text-xs text-[#64708f]">
                {bot.last_verified_at
                  ? `Verified ${new Date(bot.last_verified_at).toLocaleString()}`
                  : "Never verified"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-[#8b8fa3]">
              <span>Bot ID: {bot.telegram_bot_id}</span>
              <span>Token: {bot.token_preview}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary flex items-center gap-2"
                onClick={() => void testConnection()}
                disabled={testing}
              >
                <RefreshCw size={14} className={testing ? "animate-spin" : ""} />
                {testing ? "Testing..." : "Test Connection"}
              </button>

              <button type="button" className="btn-ghost" onClick={() => void disconnectBot()}>
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state">No bot connected yet.</div>
        )}

        <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
          <label className="field-label">
            {bot ? "Replace bot token" : "Bot token"}
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              className="input"
              placeholder="123456789:AA...your bot token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              type="button"
              className="btn flex items-center gap-2 shrink-0"
              onClick={() => void connectBot()}
              disabled={connecting || !token.trim()}
            >
              <Link2 size={14} />
              {connecting ? "Connecting..." : "Connect"}
            </button>
          </div>
        </div>
      </div>

      <div className="panel flex flex-col gap-3" style={{ padding: "22px" }}>
        <div className="text-sm font-semibold">Adding the bot to a channel</div>
        <ol className="flex flex-col gap-2 text-sm text-[#9aa3c7] list-decimal pl-5">
          <li>Open your Telegram channel or supergroup → Administrators → Add Administrator.</li>
          <li>
            Search for <span className="mono">@{bot?.username ?? "your_bot"}</span> and add it.
          </li>
          <li>
            Grant at least <strong>Post Messages</strong>. Recommended: also grant{" "}
            <strong>Edit Messages</strong> and <strong>Delete Messages</strong> so Edit/Delete
            Everywhere work.
          </li>
          <li>
            Go to <span className="mono">Telegram → Channels → Connect Channel</span> and register
            it by its numeric chat ID or by forwarding a message from the channel to the bot.
          </li>
        </ol>
        <div className="flex items-center gap-2 text-xs text-[#8b8fa3]">
          {bot?.status === "connected" ? (
            <CheckCircle2 size={13} className="text-[#2ecc71]" />
          ) : (
            <XCircle size={13} className="text-[#ef4444]" />
          )}
          <span>
            {bot?.status === "connected"
              ? "Bot is connected and ready."
              : "Connect a bot above before adding channels."}
          </span>
        </div>
      </div>
    </div>
  );
}
