import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Assistant — ZGIIS",
  description: "Ask questions about TEC, space weather, and ionospheric science.",
};

export default function AiAssistantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
