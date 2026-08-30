import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isAdminRequest } from "../auth";

function requestWithCookie(cookie?: string) {
  return new NextRequest("http://localhost/api/telegram/bots", {
    headers: cookie ? { cookie } : {},
  });
}

describe("isAdminRequest", () => {
  it("allows a request carrying the admin cookie", () => {
    expect(isAdminRequest(requestWithCookie("panelist_admin=1"))).toBe(true);
  });

  it("rejects a request with no cookie", () => {
    expect(isAdminRequest(requestWithCookie())).toBe(false);
  });

  it("rejects a request with the wrong cookie value", () => {
    expect(isAdminRequest(requestWithCookie("panelist_admin=0"))).toBe(false);
  });

  it("rejects an unrelated cookie", () => {
    expect(isAdminRequest(requestWithCookie("some_other_cookie=1"))).toBe(false);
  });
});
