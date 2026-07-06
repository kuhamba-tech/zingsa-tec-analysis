import type { NavigationFacebookStatus } from "./types";

/** Stellar Aspirations Facebook Page public URL. */
export const STELLAR_ASPIRATIONS_FACEBOOK_PAGE_URL =
  "https://www.facebook.com/profile.php?id=61562022072713";

/** Placeholder when the backend status API is unreachable — not real config. */
export const OFFLINE_FACEBOOK_STATUS: NavigationFacebookStatus = {
  enabled: false,
  configured: false,
  dry_run: true,
  page_id: "—",
  page_url: STELLAR_ASPIRATIONS_FACEBOOK_PAGE_URL,
};

/** @deprecated Use OFFLINE_FACEBOOK_STATUS when the API is down. */
export const DEFAULT_FACEBOOK_STATUS = OFFLINE_FACEBOOK_STATUS;

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
