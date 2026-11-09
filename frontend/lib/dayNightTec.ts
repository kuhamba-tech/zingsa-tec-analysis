export type DayNightRegion = "network" | "northern" | "central" | "southern";

export type DayNightSeries = Record<DayNightRegion, (number | null)[]>;

export interface DayNightComparison {
  date: string;
  region: DayNightRegion;
  day_mean: number | null;
  night_mean: number | null;
  day_hours: number;
  night_hours: number;
}

export interface DayNightTec {
  available: boolean;
  message?: string;
  generated_at: string;
  today: string;
  yesterday: string;
  clock: string;
  day_hours: string;
  night_hours: string;
  source: string;
  excluded: string[];
  vtec_rule: string;
  elevation_min_deg: number;
  regions: Record<string, string>;
  weighting: string;
  labels_24h: string[];
  labels_day: string[];
  labels_night: string[];
  profile_24h: DayNightSeries;
  daytime: { yesterday: DayNightSeries; today: DayNightSeries };
  nighttime: {
    previous_night: { evening_date: string; morning_date: string; series: DayNightSeries };
    last_night: { evening_date: string; morning_date: string; series: DayNightSeries };
  };
  seven_day: ({ date: string } & DayNightSeries)[];
  regional_comparison: DayNightComparison[];
  coverage: {
    stations: string[];
    station_count: number;
    observations: number;
    observations_above_50: number;
    first: string | null;
    last: string | null;
  };
}
