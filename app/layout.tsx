import type { Metadata, Viewport } from "next";
import "./globals.css";
import Header from "@/components/Header";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "Panelist",
  description: "Automate SMM panel orders from your social posts",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.svg",
    
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050814",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegister />
        <div className="min-h-screen">
          <Header />
          <main className="mx-auto w-full max-w-[1500px] px-4 pb-8 pt-5 sm:px-6 lg:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
