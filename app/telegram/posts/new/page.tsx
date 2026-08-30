"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bold, Code, FileText, Image as ImageIcon, Italic, Link2, Plus, Strikethrough, Trash2, Underline, Video } from "lucide-react";
import ChannelSelector from "@/components/telegram/ChannelSelector";
import { sanitizeTelegramHtml } from "@/lib/telegram/formatting";

type MediaState = { mediaType: "photo" | "video" | "document"; storageKey: string; publicUrl: string; name: string } | null;

type ButtonRow = { label: string; url: string };

export default function NewPostPage() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState("");
  const [media, setMedia] = useState<MediaState>(null);
  const [uploading, setUploading] = useState(false);
  const [buttons, setButtons] = useState<ButtonRow[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [publishMode, setPublishMode] = useState<"now" | "schedule">("now");
  const [scheduledAtLocal, setScheduledAtLocal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  function wrapSelection(openTag: string, closeTag: string) {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = text.slice(0, start);
    const selected = text.slice(start, end);
    const after = text.slice(end);

    const next = `${before}${openTag}${selected}${closeTag}${after}`;
    setText(next);

    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + openTag.length, start + openTag.length + selected.length);
    });
  }

  function insertLink() {
    const url = prompt("Link URL (https://...)");
    if (!url) return;
    wrapSelection(`<a href="${url}">`, "</a>");
  }

  async function uploadFile(file: File, mediaType: "photo" | "video" | "document") {
    setUploading(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("media_type", mediaType);

      const res = await fetch("/api/telegram/media/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");

      setMedia({ mediaType: data.media_type, storageKey: data.storage_key, publicUrl: data.public_url, name: file.name });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Upload failed.", error: true });
    } finally {
      setUploading(false);
    }
  }

  function addButton() {
    setButtons((prev) => [...prev, { label: "", url: "" }]);
  }

  function updateButton(index: number, field: "label" | "url", value: string) {
    setButtons((prev) => prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)));
  }

  function removeButton(index: number) {
    setButtons((prev) => prev.filter((_, i) => i !== index));
  }

  function buildPayload(overrides: { draft?: boolean; publishNow?: boolean }) {
    const scheduledAtIso =
      publishMode === "schedule" && scheduledAtLocal ? new Date(scheduledAtLocal).toISOString() : null;

    return {
      text,
      media: media ? { media_type: media.mediaType, storage_key: media.storageKey } : null,
      buttons: buttons
        .filter((b) => b.label.trim() && b.url.trim())
        .map((b, index) => ({ label: b.label.trim(), url: b.url.trim(), row_index: index, position: 0 })),
      destination_channel_ids: [...selectedChannels],
      draft: overrides.draft ?? false,
      publish_now: overrides.publishNow ?? false,
      scheduled_at: overrides.draft ? null : scheduledAtIso,
    };
  }

  async function submit(mode: "draft" | "publish") {
    setSubmitting(true);
    setFeedback(null);

    try {
      if (mode === "publish") {
        if (selectedChannels.size === 0) throw new Error("Select at least one destination channel.");
        if (publishMode === "schedule" && !scheduledAtLocal) throw new Error("Pick a schedule date/time.");
      }

      const payload = buildPayload({
        draft: mode === "draft",
        publishNow: mode === "publish" && publishMode === "now",
      });

      const res = await fetch("/api/telegram/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save post.");

      router.push(`/telegram/posts/${data.post.id}`);
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Failed to save post.", error: true });
    } finally {
      setSubmitting(false);
    }
  }

  const previewHtml = sanitizeTelegramHtml(text || "<i>Nothing to preview yet.</i>").replace(/\n/g, "<br/>");

  return (
    <div className="flex flex-col gap-7">
      <section className="panel" style={{ padding: "22px" }}>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Telegram</span>
          <h1 className="display text-2xl font-semibold tracking-tight">New Post</h1>
        </div>
      </section>

      {feedback && <div className="panel-error">{feedback.text}</div>}

      <div className="grid gap-6" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="flex flex-col gap-6">
          <div className="panel flex flex-col gap-3" style={{ padding: "20px" }}>
            <div className="flex items-center gap-1.5">
              <button type="button" className="btn-ghost" onClick={() => wrapSelection("<b>", "</b>")} aria-label="Bold">
                <Bold size={15} />
              </button>
              <button type="button" className="btn-ghost" onClick={() => wrapSelection("<i>", "</i>")} aria-label="Italic">
                <Italic size={15} />
              </button>
              <button type="button" className="btn-ghost" onClick={() => wrapSelection("<u>", "</u>")} aria-label="Underline">
                <Underline size={15} />
              </button>
              <button type="button" className="btn-ghost" onClick={() => wrapSelection("<s>", "</s>")} aria-label="Strikethrough">
                <Strikethrough size={15} />
              </button>
              <button type="button" className="btn-ghost" onClick={() => wrapSelection("<code>", "</code>")} aria-label="Code">
                <Code size={15} />
              </button>
              <button type="button" className="btn-ghost" onClick={insertLink} aria-label="Link">
                <Link2 size={15} />
              </button>
            </div>

            <textarea
              ref={textareaRef}
              className="input"
              style={{ minHeight: "180px", fontFamily: "inherit" }}
              placeholder="Write your Telegram post..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />

            <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
              <span className="field-label">Media (one image, video, or file)</span>
              {media ? (
                <div className="panel-alt flex items-center justify-between gap-3" style={{ padding: "10px" }}>
                  <span className="text-xs text-[#9aa3c7] truncate">
                    {media.mediaType} · {media.name}
                  </span>
                  <button type="button" className="btn-ghost text-[#ef4444]" onClick={() => setMedia(null)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <label className="btn-secondary flex items-center gap-2 cursor-pointer">
                    <ImageIcon size={14} /> Upload Image
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      disabled={uploading}
                      onChange={(e) => e.target.files?.[0] && void uploadFile(e.target.files[0], "photo")}
                    />
                  </label>
                  <label className="btn-secondary flex items-center gap-2 cursor-pointer">
                    <Video size={14} /> Upload Video
                    <input
                      type="file"
                      accept="video/*"
                      hidden
                      disabled={uploading}
                      onChange={(e) => e.target.files?.[0] && void uploadFile(e.target.files[0], "video")}
                    />
                  </label>
                  <label className="btn-secondary flex items-center gap-2 cursor-pointer">
                    <FileText size={14} /> Upload File
                    <input
                      type="file"
                      hidden
                      disabled={uploading}
                      onChange={(e) => e.target.files?.[0] && void uploadFile(e.target.files[0], "document")}
                    />
                  </label>
                </div>
              )}
              {uploading && <span className="text-xs text-[#8b8fa3]">Uploading...</span>}
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <span className="field-label">Inline URL buttons</span>
                <button type="button" className="btn-ghost flex items-center gap-1.5" onClick={addButton}>
                  <Plus size={13} /> Add Button
                </button>
              </div>
              {buttons.map((button, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    className="input"
                    placeholder="Button label"
                    value={button.label}
                    onChange={(e) => updateButton(index, "label", e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="https://example.com"
                    value={button.url}
                    onChange={(e) => updateButton(index, "url", e.target.value)}
                  />
                  <button type="button" className="btn-ghost text-[#ef4444] shrink-0" onClick={() => removeButton(index)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="panel flex flex-col gap-2" style={{ padding: "20px" }}>
            <span className="field-label">Preview</span>
            <div
              className="panel-alt text-sm leading-relaxed"
              style={{ padding: "14px" }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
            {media && <div className="text-xs text-[#64708f]">+ {media.mediaType} attachment</div>}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="panel flex flex-col gap-3" style={{ padding: "20px" }}>
            <span className="text-sm font-semibold">Destinations</span>
            <ChannelSelector selected={selectedChannels} onChange={setSelectedChannels} />
          </div>

          <div className="panel flex flex-col gap-3" style={{ padding: "20px" }}>
            <span className="text-sm font-semibold">Publishing</span>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" checked={publishMode === "now"} onChange={() => setPublishMode("now")} />
              Send Now
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" checked={publishMode === "schedule"} onChange={() => setPublishMode("schedule")} />
              Schedule
            </label>

            {publishMode === "schedule" && (
              <input
                type="datetime-local"
                className="input"
                value={scheduledAtLocal}
                onChange={(e) => setScheduledAtLocal(e.target.value)}
              />
            )}

            <div className="flex flex-col gap-2 pt-2">
              <button type="button" className="btn" onClick={() => void submit("publish")} disabled={submitting}>
                {submitting ? "Working..." : publishMode === "now" ? "Publish" : "Schedule Post"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => void submit("draft")} disabled={submitting}>
                Save as Draft
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
