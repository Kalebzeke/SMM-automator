import { describe, expect, it } from "vitest";
import { buildInlineKeyboard, escapeHtml, sanitizeTelegramHtml } from "../formatting";

describe("escapeHtml", () => {
  it("escapes the three HTML-significant characters", () => {
    expect(escapeHtml("5 < 10 & 10 > 5")).toBe("5 &lt; 10 &amp; 10 &gt; 5");
  });
});

describe("sanitizeTelegramHtml", () => {
  it("passes through whitelisted formatting tags", () => {
    expect(sanitizeTelegramHtml("<b>bold</b> and <i>italic</i>")).toBe(
      "<b>bold</b> and <i>italic</i>"
    );
  });

  it("escapes stray angle brackets typed as plain text", () => {
    expect(sanitizeTelegramHtml("5 < 10 and 10 > 5")).toBe("5 &lt; 10 and 10 &gt; 5");
  });

  it("escapes unknown/unsafe tags instead of passing them through", () => {
    expect(sanitizeTelegramHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("keeps a safe http(s) link", () => {
    expect(sanitizeTelegramHtml('<a href="https://example.com">go</a>')).toBe(
      '<a href="https://example.com">go</a>'
    );
  });

  it("drops an unsafe link protocol and never emits a live <a> tag for it", () => {
    const input = '<a href="javascript:alert(1)">go</a>';
    const result = sanitizeTelegramHtml(input);
    expect(result).not.toMatch(/<a\s/);
    expect(result).not.toContain("</a>"); // the closing tag has no live opener, so it's escaped too
    expect(result).toContain("&lt;a");
  });

  it("never emits an unbalanced closing tag for a bare </b> with no opener", () => {
    expect(sanitizeTelegramHtml("hello </b> world")).toBe("hello &lt;/b&gt; world");
  });

  it("escapes an unrecognized tag's closing counterpart too", () => {
    expect(sanitizeTelegramHtml("<div>text</div>")).toBe("&lt;div&gt;text&lt;/div&gt;");
  });
});

describe("buildInlineKeyboard", () => {
  it("returns undefined for no valid buttons", () => {
    expect(buildInlineKeyboard([])).toBeUndefined();
    expect(buildInlineKeyboard([{ label: "", url: "https://x.com", row_index: 0, position: 0 }])).toBeUndefined();
  });

  it("groups buttons by row_index in order", () => {
    const keyboard = buildInlineKeyboard([
      { label: "B", url: "https://b.com", row_index: 1, position: 0 },
      { label: "A1", url: "https://a1.com", row_index: 0, position: 0 },
      { label: "A2", url: "https://a2.com", row_index: 0, position: 1 },
    ]);

    expect(keyboard).toEqual({
      inline_keyboard: [
        [
          { text: "A1", url: "https://a1.com" },
          { text: "A2", url: "https://a2.com" },
        ],
        [{ text: "B", url: "https://b.com" }],
      ],
    });
  });

  it("drops buttons with unsafe URLs", () => {
    const keyboard = buildInlineKeyboard([
      { label: "Bad", url: "javascript:alert(1)", row_index: 0, position: 0 },
      { label: "Good", url: "https://good.com", row_index: 0, position: 1 },
    ]);

    expect(keyboard?.inline_keyboard).toEqual([[{ text: "Good", url: "https://good.com" }]]);
  });
});
