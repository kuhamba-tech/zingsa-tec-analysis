import sites from "./southAfricaCorsCatalog.json";
import type { TrigNetResponse } from "./types";

/** Public single-base positions only; never seed calculated values or online flags. */
export const TRIGNET_CATALOG: TrigNetResponse = {
  source: "TrigNet station catalog", source_url: "http://trignet.co.za/", caster: "",
  rinex_day: null, station_count: sites.length, tec_ready: 0, gg_ready: 0,
  note: "Station locations loaded. Checking live connections and calculated TEC.",
  stations: sites.map(site => ({ ...site, connected: false, streaming: false,
    stream_configured: false, vtec: null, gg_vtec: null, vtec_time: null, samples: 0 })),
};
