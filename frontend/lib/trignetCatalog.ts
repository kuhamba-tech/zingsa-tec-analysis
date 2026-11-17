import sites from "./southAfricaCorsCatalog.json";
import westAfrica from "./westAfricaCorsCatalog.json";
import type { TrigNetResponse } from "./types";

/** Public single-base positions only; never seed calculated values or online flags. */
export const TRIGNET_CATALOG: TrigNetResponse = {
  source: "TrigNet station catalog", source_url: "http://trignet.co.za/", caster: "",
  rinex_day: null, station_count: sites.length + 1 + westAfrica.length, tec_ready: 0, gg_ready: 0,
  note: "Station locations loaded. Checking live connections and calculated TEC.",
  stations: [...sites.map(site => ({ ...site, connected: false, streaming: false,
    stream_configured: false, vtec: null, gg_vtec: null, vtec_time: null, samples: 0 })),
    { code: "GHANZIBW1", name: "Ghanzi, Botswana", lat: -21.74, lon: 21.7,
      mountpoint: "GHANZIBW1", country: "BWA", network: "botswana", format: "RTCM",
      constellations: [], connected: false, streaming: false, stream_configured: false,
      vtec: null, gg_vtec: null, vtec_time: null, samples: 0 },
    ...westAfrica.map(site => ({ ...site, connected: false, streaming: false,
      stream_configured: false, vtec: null, gg_vtec: null, vtec_time: null, samples: 0 }))],
};
