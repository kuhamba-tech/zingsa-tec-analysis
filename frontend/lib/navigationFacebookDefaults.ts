import type { NavigationFacebookStatus } from "./types";

/** ZINGSA official Facebook Page — used when API status is unavailable. */
export const ZINGSA_FACEBOOK_PAGE_URL =
  "https://www.facebook.com/profile.php?id=61562022072713";

export const DEFAULT_FACEBOOK_STATUS: NavigationFacebookStatus = {
  enabled: true,
  configured: false,
  dry_run: true,
  page_id: "61562022072713",
  page_url: ZINGSA_FACEBOOK_PAGE_URL,
};

/** Minimum digit count for WhatsApp numbers (country code + local number). */
export function normalizeWhatsappInput(raw: string): string {
  return raw.replace(/\D/g, "");
}
export function validateWhatsappInput(raw: string): string | null {
  const digits = normalizeWhatsappInput(raw);
  if (digits.length < 8) {
    return "Enter a valid WhatsApp number (at least 8 digits, e.g. 263771234567).";
  }
  if (digits.length > 20) {
    return "WhatsApp number is too long.";
  }
  return null;
}
