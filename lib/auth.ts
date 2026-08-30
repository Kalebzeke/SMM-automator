import { NextRequest } from "next/server";

// The app's only auth mechanism today is the "panelist_admin" cookie set by
// /api/admin-login (see proxy.ts). Existing API routes don't check it, but
// Telegram bot tokens and publishing actions are sensitive enough to gate.
export function isAdminRequest(req: NextRequest): boolean {
  return req.cookies.get("panelist_admin")?.value === "1";
}

export function unauthorizedResponse() {
  return Response.json({ error: "Unauthorized." }, { status: 401 });
}
