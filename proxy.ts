import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PATHS = ["/services", "/comments", "/providers", "/telegram"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PATHS.some((path) =>
    pathname.startsWith(path)
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  const adminCookie = req.cookies.get("panelist_admin")?.value;

  if (adminCookie === "1") {
    return NextResponse.next();
  }

  const loginUrl = new URL("/admin-login", req.url);
  loginUrl.searchParams.set("next", pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/services/:path*", "/comments/:path*", "/providers/:path*", "/telegram/:path*"],
};