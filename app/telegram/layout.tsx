"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/telegram", label: "Dashboard" },
  { href: "/telegram/channels", label: "Channels" },
  { href: "/telegram/channel-groups", label: "Channel Groups" },
  { href: "/telegram/posts/new", label: "New Post" },
  { href: "/telegram/posts/scheduled", label: "Scheduled" },
  { href: "/telegram/posts/history", label: "History" },
  { href: "/telegram/settings", label: "Settings" },
];

export default function TelegramLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-6">
      <nav className="panel flex flex-wrap gap-2" style={{ padding: "12px" }}>
        {links.map((link) => {
          const active =
            link.href === "/telegram" ? pathname === link.href : pathname.startsWith(link.href);

          return (
            <Link key={link.href} href={link.href} className={`nav-pill ${active ? "active" : ""}`}>
              {link.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
