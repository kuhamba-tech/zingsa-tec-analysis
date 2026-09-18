import type { AudienceId } from "./types";

export interface NavigationNewsAudienceRole {
  id: AudienceId;
  role: string;
  title: string;
  description: string;
  icon: string;
}

/** Matches the Navigation News cards on the GNSS Intelligence page. */
export const NAVIGATION_NEWS_AUDIENCE_ROLES: NavigationNewsAudienceRole[] = [
  {
    id: "citizen",
    role: "Space enthusiast",
    title: "Space Weather & You",
    description: "General public, schools & community — how the Sun and ionosphere affect everyday GPS.",
    icon: "🌌",
  },
  {
    id: "farmer",
    role: "Farmer",
    title: "Farmer Brief",
    description: "Farmers, agronomists & smart-agri — tractor GPS, RTK, and planting windows.",
    icon: "🌱",
  },
  {
    id: "surveyor",
    role: "Surveyor",
    title: "Surveyor Brief",
    description: "Land surveyors, engineers & cadastral teams — cm-level GNSS under space weather.",
    icon: "📐",
  },
  {
    id: "driver",
    role: "Driver & motorist",
    title: "Driver & Fleet Brief",
    description: "Taxi, bus, courier & fleet operators — maps, dispatch & live location reliability.",
    icon: "🚕",
  },
  {
    id: "aviation",
    role: "Aviation",
    title: "Aviation Brief",
    description: "Pilots, ATC & drone operators — GNSS approach, RAIM & UAS operations.",
    icon: "✈️",
  },
  {
    id: "scientist",
    role: "Scientist",
    title: "Scientist Brief",
    description: "Researchers, geophysicists & GNSS analysts — TEC, CORS QC, EKF residuals & storm data.",
    icon: "🔬",
  },
];

export function audienceRoleFor(id: string): NavigationNewsAudienceRole | undefined {
  return NAVIGATION_NEWS_AUDIENCE_ROLES.find((r) => r.id === id);
}

export function audienceRoleLabel(id: string): string {
  return audienceRoleFor(id)?.role ?? id;
}
