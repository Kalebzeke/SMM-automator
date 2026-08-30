import { randomBytes } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken, tokenPreview } from "../crypto";

beforeEach(() => {
  process.env.TELEGRAM_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("encryptToken / decryptToken", () => {
  it("round-trips a bot token", () => {
    const token = "123456789:AAFakeTokenValueForTestingOnly";
    const encrypted = encryptToken(token);

    expect(encrypted).not.toContain(token);
    expect(decryptToken(encrypted)).toBe(token);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const token = "123456789:AAFakeTokenValueForTestingOnly";
    expect(encryptToken(token)).not.toBe(encryptToken(token));
  });

  it("throws when the ciphertext has been tampered with", () => {
    const encrypted = encryptToken("123456789:AAFakeTokenValueForTestingOnly");
    const buffer = Buffer.from(encrypted, "base64");
    buffer[buffer.length - 1] ^= 0xff; // flip a byte in the ciphertext
    expect(() => decryptToken(buffer.toString("base64"))).toThrow();
  });
});

describe("tokenPreview", () => {
  it("shows only the last 4 characters", () => {
    expect(tokenPreview("123456789:AAFakeTokenValueForTestingOnly")).toBe("••••Only");
  });
});
