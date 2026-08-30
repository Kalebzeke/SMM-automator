// Telegram HTML parse_mode helpers.
// https://core.telegram.org/bots/api#html-style

const ALLOWED_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "ins",
  "s",
  "strike",
  "del",
  "code",
  "pre",
  "a",
]);

// Matches any HTML-like tag: `<b>`, `</b>`, or `<a href="...">`.
const TAG_PATTERN = /<\/?([a-zA-Z]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*>/g;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "tg:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// Whitelist-sanitizes a post's stored `text` (which our own composer toolbar
// wrote with a small set of formatting tags) before it is sent with
// parse_mode "HTML". Anything that isn't one of our recognized tags —
// including stray `<`/`>`/`&` typed by the user, or an unsafe href — is
// escaped as plain text instead of being passed through to Telegram.
export function sanitizeTelegramHtml(input: string): string {
  let output = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // Tracks tags we've actually emitted as real open tags, so a rejected or
  // unmatched closing tag never slips through unbalanced (Telegram's HTML
  // parser rejects unbalanced markup outright).
  const openTagStack: string[] = [];

  TAG_PATTERN.lastIndex = 0;
  while ((match = TAG_PATTERN.exec(input)) !== null) {
    const [fullMatch, tagNameRaw, attrs] = match;
    const tagName = tagNameRaw.toLowerCase();
    const isClosing = fullMatch.startsWith("</");

    output += escapeHtml(input.slice(lastIndex, match.index));
    lastIndex = match.index + fullMatch.length;

    if (!ALLOWED_TAGS.has(tagName)) {
      output += escapeHtml(fullMatch);
      continue;
    }

    if (isClosing) {
      const openIndex = openTagStack.lastIndexOf(tagName);
      if (openIndex === -1) {
        // No matching open tag was actually emitted — escape instead of
        // passing through an unbalanced closing tag.
        output += escapeHtml(fullMatch);
        continue;
      }
      openTagStack.splice(openIndex, 1);
      output += `</${tagName}>`;
      continue;
    }

    if (tagName === "a") {
      const hrefMatch = /href="([^"]*)"/.exec(attrs);
      const href = hrefMatch ? hrefMatch[1] : "";

      if (!href || !isSafeUrl(href)) {
        // Drop the tag but keep it from silently vanishing user text.
        output += escapeHtml(fullMatch);
        continue;
      }

      output += `<a href="${escapeAttribute(href)}">`;
      openTagStack.push(tagName);
      continue;
    }

    output += `<${tagName}>`;
    openTagStack.push(tagName);
  }

  output += escapeHtml(input.slice(lastIndex));

  // Auto-close anything still open so Telegram never sees unbalanced markup.
  while (openTagStack.length > 0) {
    output += `</${openTagStack.pop()}>`;
  }

  return output;
}

export type ButtonSpec = {
  label: string;
  url: string;
  row_index: number;
  position: number;
};

export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; url: string }>>;
};

export function buildInlineKeyboard(buttons: ButtonSpec[]): InlineKeyboard | undefined {
  const validButtons = buttons.filter((b) => b.label.trim() && isSafeUrl(b.url));
  if (validButtons.length === 0) return undefined;

  const rows = new Map<number, ButtonSpec[]>();
  for (const button of validButtons) {
    const existing = rows.get(button.row_index) ?? [];
    existing.push(button);
    rows.set(button.row_index, existing);
  }

  const orderedRowKeys = [...rows.keys()].sort((a, b) => a - b);

  return {
    inline_keyboard: orderedRowKeys.map((rowKey) =>
      rows
        .get(rowKey)!
        .sort((a, b) => a.position - b.position)
        .map((b) => ({ text: b.label.trim(), url: b.url.trim() }))
    ),
  };
}
