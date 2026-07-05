import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "ZGIIS — Zimbabwe GNSS Ionospheric Information System",
  description: "Real-time TEC monitoring, processing, and space weather for Zimbabwe CORS network",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
