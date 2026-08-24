"use client";

import { useEffect, useState } from "react";

/** True only after the browser has mounted — avoids SSR/localStorage hydration mismatches. */
export function useClientMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
