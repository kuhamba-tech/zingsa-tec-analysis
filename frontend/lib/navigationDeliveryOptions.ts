export type NavigationLanguage = "en" | "sn" | "nd";
export type NavigationAccessibility = "standard" | "deaf" | "blind";

export const NAVIGATION_LANGUAGES: { id: NavigationLanguage; label: string }[] = [
  { id: "en", label: "English" },
  { id: "sn", label: "ChiShona" },
  { id: "nd", label: "isiNdebele" },
];

export const NAVIGATION_ACCESSIBILITY: { id: NavigationAccessibility; label: string }[] = [
  { id: "standard", label: "Standard text" },
  { id: "deaf", label: "Deaf / hard of hearing (visual brief)" },
  { id: "blind", label: "Blind / low vision (screen-reader brief)" },
];

export function languageLabel(id: string): string {
  return NAVIGATION_LANGUAGES.find((l) => l.id === id)?.label ?? id;
}

export function accessibilityLabel(id: string): string {
  return NAVIGATION_ACCESSIBILITY.find((a) => a.id === id)?.label ?? id;
}
