const OK_STATUSES = new Set(["connected", "sent", "published"]);
const WARN_STATUSES = new Set([
  "permission_issue",
  "pending",
  "queued",
  "processing",
  "retrying",
  "scheduled",
  "sending",
  "draft",
]);
const ERR_STATUSES = new Set(["disconnected", "failed", "invalid", "canceled", "deleted"]);

export default function StatusBadge({ status }: { status: string }) {
  const cls = OK_STATUSES.has(status)
    ? "badge-ok"
    : ERR_STATUSES.has(status)
      ? "badge-err"
      : WARN_STATUSES.has(status)
        ? "badge-warn"
        : "badge-info";

  return <span className={`badge ${cls}`}>{status.replace(/_/g, " ")}</span>;
}
