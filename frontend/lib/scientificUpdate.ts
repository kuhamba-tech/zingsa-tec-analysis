import type { SolarActivityFull } from "./types";

function utcEpoch(value: string | null | undefined): number {
  return value ? Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`) : NaN;
}
export function utcLabel(value: string | null | undefined): string {
  const time = utcEpoch(value);
  return Number.isFinite(time) ? new Date(time).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC") : "Unavailable";
}

function measured(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

export function scientificSnapshot(solar: SolarActivityFull | null, now: number) {
  const valid = (key: string) => {
    const feed = solar?.feed_status?.[key];
    const stamp = utcEpoch(feed?.timestamp);
    return !!feed?.fresh && Number.isFinite(stamp) && now-stamp >= -60_000 && now-stamp <= 20*60_000;
  };
  const xray = valid("goes_xray") && measured(solar?.flux) && solar.flux > 0;
  const plasma = valid("solar_wind_plasma");
  const mag = valid("solar_wind_mag");
  const wind = solar?.solar_wind;
  return [
    {
      title: "Solar radiative conditions",
      source: "NOAA GOES / 0.1–0.8 nm",
      time: solar?.feed_status?.goes_xray?.timestamp,
      reading: xray
        ? `Latest flux ${solar.flux!.toExponential(2)} W/m², class ${solar.flare_class}.`
        : "No fresh GOES sample in the last 20 minutes.",
      meaning: "This card is the Sun's soft X-ray brightness at one sample time. It is the flare level seen on the sunlit side of Earth.",
      explanation: xray
        ? `Class ${solar.flare_class} is the level at this sample. Over Zimbabwe the flare matters while the country is in daylight: HF links can fade for minutes, and TEC can step up on the dayside. An Earth-directed CME is a separate product; check the CME list and the later solar-wind arrival.`
        : "A new GOES sample is required before a quiet-Sun or flare conclusion is drawn for Zimbabwe.",
    },
    {
      title: "Upstream solar wind",
      source: "NOAA real-time solar wind / plasma",
      time: solar?.feed_status?.solar_wind_plasma?.timestamp,
      reading: plasma && measured(wind?.speed)
        ? `Speed ${wind.speed.toFixed(0)} km/s${measured(wind.density) ? `; proton density ${wind.density.toFixed(1)} cm⁻³` : ""}${measured(wind.temperature) ? `; temperature ${wind.temperature.toExponential(2)} K` : ""}.`
        : "No fresh solar-wind plasma sample in the last 20 minutes.",
      meaning: "This card is the solar wind measured upstream of Earth, before it reaches the magnetosphere.",
      explanation: plasma && measured(wind?.speed)
        ? `${wind.speed.toFixed(0)} km/s is the bulk speed. Quiet wind is about 300–450 km/s, and 500 km/s is the fast-stream line. Name the driver from the official discussion: a coronal-hole stream, a shock, or a CME. Over Zimbabwe, pair this speed with Bz, then with TEC and S4.`
        : "Until a new plasma sample arrives, the wind driver for Zimbabwe TEC is not identified from this card.",
    },
    {
      title: "Interplanetary magnetic field",
      source: "NOAA real-time solar wind / magnetic field",
      time: solar?.feed_status?.solar_wind_mag?.timestamp,
      reading: mag && measured(wind?.bz)
        ? `Bz ${wind.bz.toFixed(1)} nT${measured(wind.bt) ? `; Bt ${wind.bt.toFixed(1)} nT` : ""}.${measured(wind.southward_duration_minutes) ? ` Continuous southward duration ${wind.southward_duration_minutes} min.` : " Southward duration awaits a continuous Bz series."}`
        : "No fresh IMF sample in the last 20 minutes.",
      meaning: "This card is Bz, the north–south part of the interplanetary field. Southward Bz is the direction that couples the solar wind to Earth's field.",
      explanation: mag && measured(wind?.bz)
        ? `The latest Bz is ${wind.bz.toFixed(1)} nT${wind.bz < 0 ? ", southward" : ", northward"}. A storm level comes from the K-index over the hours that follow this sample. Over Zimbabwe, a GNSS concern is southward Bz held together with Kp of 5 or more, checked on TEC and S4.`
        : "Until a new IMF sample arrives, the coupling direction for Zimbabwe is not known from this card.",
    },
  ];
}

export function scientificEvents(solar: SolarActivityFull | null, now: number) {
  const flares = (solar?.donki_flares ?? []).map(f => ({
    id:String(f.flrID ?? f.peakTime ?? f.beginTime ?? "flare"), time:String(f.peakTime ?? f.beginTime ?? ""),
    title:`Flare ${String(f.classType ?? "class unavailable")}`,
    detail:`${f.activeRegionNum ? `AR ${f.activeRegionNum}` : "Active region not established"}; ${f.sourceLocation && f.sourceLocation !== "GOES" ? String(f.sourceLocation) : "source position unavailable"}. Peak time shown when supplied; otherwise start time.`,
    source:solar?.event_feed_source ?? "Event catalogue", kind:"Catalogued observation",
  }));
  const cmes = (solar?.donki_cmes ?? []).map(c => {
    const analyses = Array.isArray(c.cmeAnalyses) ? c.cmeAnalyses as Record<string,unknown>[] : [];
    const analysis = analyses.find(a=>a.isMostAccurate===true) ?? analyses[0];
    return {id:String(c.activityID ?? c.startTime ?? "cme"),time:String(c.startTime ?? ""),title:"CME catalogue entry",
      detail:`${measured(analysis?.speed) ? `Catalogue speed ${analysis.speed} km/s.` : "Speed unavailable."} Earth arrival and impact are not inferred from cone width or linked events. Use explicit model guidance.`,
      source:solar?.event_feed_source ?? "Event catalogue",kind:"Catalogue / analysis"};
  });
  return [...flares,...cmes].filter(e=>now > 0 && Number.isFinite(utcEpoch(e.time)) && utcEpoch(e.time)<=now+60_000).sort((a,b)=>utcEpoch(b.time)-utcEpoch(a.time)).slice(0,8);
}
