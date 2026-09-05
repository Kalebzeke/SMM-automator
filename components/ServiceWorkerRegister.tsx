"use client";

import { useEffect } from "react";

// Registered only in production builds — a service worker fighting Turbopack's
// fast refresh in `next dev` causes stale-chunk bugs that look like real
// breakage. Test PWA behavior with `next build && next start` instead.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  }, []);

  return null;
}
