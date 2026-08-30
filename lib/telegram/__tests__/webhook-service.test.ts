import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestDb, makeTestSupabase } from "./testSupabase";

let db: TestDb;

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: () => makeTestSupabase(db),
}));

const { deriveChannelStatus, handleMyChatMember } = await import("../webhook-service");

beforeEach(() => {
  db = new TestDb();
});


describe("deriveChannelStatus", () => {
  it("marks an administrator that can post as connected", () => {
    expect(deriveChannelStatus({ status: "administrator", can_post_messages: true })).toEqual({
      botIsAdmin: true,
      status: "connected",
    });
  });

  it("marks an administrator without post permission as permission_issue", () => {
    expect(deriveChannelStatus({ status: "administrator", can_post_messages: false })).toEqual({
      botIsAdmin: true,
      status: "permission_issue",
    });
  });

  it("marks a demoted-to-member bot as permission_issue, not admin", () => {
    expect(deriveChannelStatus({ status: "member" })).toEqual({
      botIsAdmin: false,
      status: "permission_issue",
    });
  });

  it("marks a removed/kicked bot as disconnected", () => {
    expect(deriveChannelStatus({ status: "kicked" })).toEqual({
      botIsAdmin: false,
      status: "disconnected",
    });
    expect(deriveChannelStatus({ status: "left" })).toEqual({
      botIsAdmin: false,
      status: "disconnected",
    });
  });
});

describe("handleMyChatMember", () => {
  it("updates an existing channel's status from a my_chat_member update", async () => {
    db.seed("telegram_channels", [
      {
        id: "chan-1",
        telegram_chat_id: -1001234567890,
        status: "connected",
        bot_is_admin: true,
        title: "Old Title",
        username: null,
      },
    ]);

    await handleMyChatMember({
      chat: { id: -1001234567890, title: "New Title", type: "channel" },
      new_chat_member: { status: "kicked" },
    });

    const [channel] = db.rows("telegram_channels");
    expect(channel.status).toBe("disconnected");
    expect(channel.bot_is_admin).toBe(false);
    expect(channel.title).toBe("New Title");
  });

  it("is a no-op for a chat that was never registered as a channel", async () => {
    await handleMyChatMember({
      chat: { id: -999, title: "Unregistered", type: "channel" },
      new_chat_member: { status: "administrator", can_post_messages: true },
    });

    expect(db.rows("telegram_channels")).toHaveLength(0);
  });
});
