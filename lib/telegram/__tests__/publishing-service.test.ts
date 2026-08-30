import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestDb, makeTestSupabase } from "./testSupabase";

let db: TestDb;

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: () => makeTestSupabase(db),
}));

const {
  createDeliveriesForPost,
  retryFailedDeliveries,
  updatePublishedPost,
  deletePublishedPost,
  duplicatePost,
} = await import("../publishing-service");

beforeEach(() => {
  db = new TestDb();
});

describe("createDeliveriesForPost", () => {
  it("creates one pending send delivery per destination channel", async () => {
    db.seed("post_destinations", [
      { post_id: "post-1", channel_id: "chan-1" },
      { post_id: "post-1", channel_id: "chan-2" },
    ]);

    await createDeliveriesForPost("post-1");

    const deliveries = db.rows("post_deliveries");
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === "pending" && d.pending_operation === "send")).toBe(true);
  });

  it("never creates a duplicate delivery for the same post+channel", async () => {
    db.seed("post_destinations", [{ post_id: "post-1", channel_id: "chan-1" }]);

    await createDeliveriesForPost("post-1");
    await createDeliveriesForPost("post-1"); // simulates an overlapping cron tick / retry click

    expect(db.rows("post_deliveries")).toHaveLength(1);
  });
});

describe("retryFailedDeliveries", () => {
  it("only re-queues deliveries that failed, leaving successful ones untouched", async () => {
    db.seed("post_deliveries", [
      { id: "d1", post_id: "post-1", channel_id: "chan-1", status: "failed", pending_operation: null },
      { id: "d2", post_id: "post-1", channel_id: "chan-2", status: "sent", pending_operation: null, telegram_message_id: 42 },
    ]);
    db.seed("posts", [{ id: "post-1", status: "sent" }]);

    const count = await retryFailedDeliveries("post-1");

    expect(count).toBe(1);
    const [d1, d2] = db.rows("post_deliveries");
    expect(d1.status).toBe("pending");
    expect(d1.pending_operation).toBe("send");
    expect(d2.status).toBe("sent");
    expect(d2.pending_operation).toBeNull();
    expect(d2.telegram_message_id).toBe(42); // never touched, never reposted
  });

  it("returns 0 and does nothing when there is nothing to retry", async () => {
    db.seed("post_deliveries", [
      { id: "d1", post_id: "post-1", channel_id: "chan-1", status: "sent", pending_operation: null },
    ]);

    expect(await retryFailedDeliveries("post-1")).toBe(0);
  });
});

describe("updatePublishedPost (Edit Everywhere)", () => {
  it("queues an edit only for deliveries that already sent, preserving telegram_message_id", async () => {
    db.seed("post_deliveries", [
      { id: "d1", post_id: "post-1", channel_id: "chan-1", status: "sent", pending_operation: null, telegram_message_id: 111 },
      { id: "d2", post_id: "post-1", channel_id: "chan-2", status: "failed", pending_operation: null, telegram_message_id: null },
    ]);

    const count = await updatePublishedPost("post-1");

    expect(count).toBe(1);
    const [d1, d2] = db.rows("post_deliveries");
    expect(d1.pending_operation).toBe("edit");
    expect(d1.telegram_message_id).toBe(111);
    expect(d2.pending_operation).toBeNull(); // never sent, nothing to edit
  });
});

describe("deletePublishedPost (Delete Everywhere)", () => {
  it("queues a delete only for deliveries that already sent", async () => {
    db.seed("post_deliveries", [
      { id: "d1", post_id: "post-1", channel_id: "chan-1", status: "sent", pending_operation: null, telegram_message_id: 111 },
      { id: "d2", post_id: "post-1", channel_id: "chan-2", status: "pending", pending_operation: "send" },
    ]);

    const count = await deletePublishedPost("post-1");

    expect(count).toBe(1);
    const [d1, d2] = db.rows("post_deliveries");
    expect(d1.pending_operation).toBe("delete");
    expect(d2.pending_operation).toBe("send"); // untouched
  });
});

describe("duplicatePost", () => {
  it("copies content and destinations as a fresh draft without deliveries or message IDs", async () => {
    db.seed("posts", [{ id: "post-1", text: "Bitcoin is moving", parse_mode: "HTML", status: "sent" }]);
    db.seed("post_media", [{ post_id: "post-1", media_type: "photo", storage_key: "2024/img.jpg", position: 0 }]);
    db.seed("post_buttons", [{ post_id: "post-1", label: "Visit", url: "https://example.com", row_index: 0, position: 0 }]);
    db.seed("post_destinations", [{ post_id: "post-1", channel_id: "chan-1" }]);
    db.seed("post_deliveries", [
      { id: "d1", post_id: "post-1", channel_id: "chan-1", status: "sent", telegram_message_id: 999 },
    ]);

    const newPostId = await duplicatePost("post-1");
    expect(newPostId).not.toBe("post-1");

    const newPost = db.rows("posts").find((p) => p.id === newPostId);
    expect(newPost?.status).toBe("draft");
    expect(newPost?.text).toBe("Bitcoin is moving");

    expect(db.rows("post_media").filter((m) => m.post_id === newPostId)).toHaveLength(1);
    expect(db.rows("post_buttons").filter((b) => b.post_id === newPostId)).toHaveLength(1);
    expect(db.rows("post_destinations").filter((d) => d.post_id === newPostId)).toHaveLength(1);
    // No deliveries copied — the duplicate must never reuse a Telegram message ID.
    expect(db.rows("post_deliveries").filter((d) => d.post_id === newPostId)).toHaveLength(0);
  });
});
