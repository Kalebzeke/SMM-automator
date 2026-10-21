import { describe, expect, it } from "vitest";
import { isXBroadcastLink } from "../place-order";

describe("isXBroadcastLink", () => {
  it("recognizes X broadcast links", () => {
    expect(isXBroadcastLink("https://x.com/i/broadcasts/1lJQRWbneWMxE")).toBe(true);
    expect(isXBroadcastLink("https://www.x.com/i/broadcasts/abc123/?s=20")).toBe(true);
  });

  it("recognizes legacy Twitter broadcast links", () => {
    expect(isXBroadcastLink("https://twitter.com/i/broadcasts/abc123")).toBe(true);
  });

  it("does not classify ordinary X links or other hosts as broadcasts", () => {
    expect(isXBroadcastLink("https://x.com/example/status/123")).toBe(false);
    expect(isXBroadcastLink("https://x.com/i/broadcasts/")).toBe(false);
    expect(isXBroadcastLink("https://not-x.com/i/broadcasts/abc123")).toBe(false);
    expect(isXBroadcastLink("not a url")).toBe(false);
  });
});
