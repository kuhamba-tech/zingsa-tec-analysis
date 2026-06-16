import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "ZGIIS — Zimbabwe GNSS Ionospheric Information System",
  description: "Real-time TEC monitoring, processing, and space weather for Zimbabwe CORS network",
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
