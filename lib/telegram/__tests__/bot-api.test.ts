import { describe, expect, it } from "vitest";
import { processTelegramError, TelegramApiError } from "../bot-api";

describe("TelegramApiError.isPermanent", () => {
  it("treats 403 (forbidden) with no retry_after as permanent", () => {
    expect(new TelegramApiError(403, "bot was kicked").isPermanent).toBe(true);
  });

  it("treats 400 (bad request) with no retry_after as permanent", () => {
    expect(new TelegramApiError(400, "chat not found").isPermanent).toBe(true);
  });

  it("treats a 429 flood-control response as transient, not permanent", () => {
    const error = new TelegramApiError(429, "Too Many Requests", 30);
    expect(error.isPermanent).toBe(false);
    expect(error.retryAfter).toBe(30);
  });

  it("does not treat an unrelated 5xx as permanent", () => {
    expect(new TelegramApiError(500, "internal error").isPermanent).toBe(false);
  });

  it("a retry_after always wins over the permanent code list", () => {
    expect(new TelegramApiError(403, "temporarily rate limited?", 5).isPermanent).toBe(false);
  });
});

describe("processTelegramError", () => {
  it("normalizes a TelegramApiError without leaking anything beyond code/description/retryAfter", () => {
    const normalized = processTelegramError(new TelegramApiError(403, "Forbidden: bot was kicked"));
    expect(normalized).toEqual({
      code: 403,
      description: "Forbidden: bot was kicked",
      retryAfter: undefined,
      isPermanent: true,
    });
  });

  it("falls back gracefully for a non-Telegram error", () => {
    const normalized = processTelegramError(new Error("network blip"));
    expect(normalized.code).toBe(0);
    expect(normalized.isPermanent).toBe(false);
    expect(normalized.description).toBe("network blip");
  });

  it("falls back gracefully for a thrown non-Error value", () => {
    const normalized = processTelegramError("boom");
    expect(normalized.code).toBe(0);
    expect(normalized.isPermanent).toBe(false);
  });
});
