import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Day–Night TEC — ZGIIS",
  description: "Daily day and night TEC from measured Zimbabwe CORS GOPI observations.",
};

export default function DayNightTecLayout({ children }: { children: React.ReactNode }) {
  return children;
}
