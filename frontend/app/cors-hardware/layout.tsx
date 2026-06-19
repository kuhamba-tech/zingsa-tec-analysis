import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CORS Hardware — ZGIIS",
  description: "Reference station receiver, antenna, and architecture details for the Zimbabwe CORS network.",
};

export default function CorsHardwareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
