/** What a NOAA bulletin means over Zimbabwe. The bureau text stays unchanged. */

export type SwpcBulletin = {
  code?: string | null;
  serial?: string | null;
  kind?: string | null;
  headline?: string | null;
  issue_time?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  condition?: string | null;
  noaa_scale?: string | null;
  continuation_of?: string | null;
  extension_to?: string | null;
  impacts?: string | null;
};

export function bulletinZimbabweReading(bulletin: SwpcBulletin): { meaning: string; explanation: string } {
  const code = (bulletin.code || "").toUpperCase();
  const scale = (bulletin.noaa_scale || "").replace(/\s+/g, " ").trim();
  const named = (bulletin.headline || "").match(/\b([GRS][1-5])\b/i);
  const window = [bulletin.valid_from, bulletin.valid_to].filter(Boolean).join(" to ");
  const windowBit = window ? ` The stated window is ${window}.` : "";
  const scaleBit = scale
    ? ` The bureau scale on this product is ${scale}.`
    : named
      ? ` The headline names ${named[1].toUpperCase()}.`
      : "";
  const kMatch = (bulletin.headline || "").match(/K-index of (\d+)/i);
  const kBit = kMatch ? ` Planetary K ${kMatch[1]}.` : "";
  const cancelled = /cancel/i.test(`${bulletin.kind || ""} ${bulletin.headline || ""}`);
  if (cancelled) {
    return {
      meaning: `NOAA has cancelled an earlier storm watch.${scaleBit}`,
      explanation: "Over Zimbabwe, take that watch out of the planning window. Keep reading TEC and S4 on the CORS network for whatever warning is still in force.",
    };
  }
  if (code.startsWith("ALTEF")) {
    return {
      meaning: "This is a radiation-belt alert. The >2 MeV electron flux has passed 1,000 pfu at GOES.",
      explanation: "Over Zimbabwe the GNSS check is extra noise on the satellite links while the flux stays above that line. It is a satellite-environment note. Confirm it on TEC and S4 only if the same hours also show a local change.",
    };
  }
  if (code.startsWith("SUM10")) {
    return {
      meaning: "This is a short 10 cm solar radio burst. It lasts minutes.",
      explanation: "While Zimbabwe is in daylight the burst can raise noise on sunlit radio links for that short interval. Pair any TEC change with the flare and Bz records before calling it a storm.",
    };
  }
  if (code.startsWith("SUMXM") || code.startsWith("ALTXM")) {
    return {
      meaning: `This is a flare-radiation product.${scaleBit}`,
      explanation: "The X-ray effect is on the sunlit ionosphere, including Zimbabwe when the country is in daylight. HF links can fade for minutes. An Earth-directed CME is a separate product. Check TEC if the same minutes show a dayside rise.",
    };
  }
  if (code.startsWith("ALTTP")) {
    return {
      meaning: "This is a solar radio emission. Type II marks a shock leaving the Sun. Type IV marks continuum emission after a flare.",
      explanation: "The speed in a Type II product is the shock speed at the Sun. Arrival at Earth is the later solar-wind measurement. Over Zimbabwe, the GNSS check starts when the wind and Bz change, then on TEC and S4 from the CORS network.",
    };
  }
  if (/^(WARK|ALTK)04$/.test(code)) {
    return {
      meaning: `Planetary K has reached, or is expected to reach, 4. That is active conditions, below the G1 line at K = 5.${windowBit}`,
      explanation: "Over Zimbabwe the GNSS check is TEC and S4 on the CORS network. At K = 4 the local change is usually small. Call it a disturbance only if those local series move in the same window.",
    };
  }
  if (/^(WARK|ALTK)0[5-9]$/.test(code) || code.startsWith("WATA")) {
    return {
      meaning: `This product is at or above the G1 line.${kBit}${scaleBit}${windowBit}`,
      explanation: "A G1 or stronger interval can disturb TEC over Zimbabwe enough to matter for GNSS. Read the arrival on TEC and S4 from the CORS network, together with southward IMF Bz.",
    };
  }
  if (code.startsWith("WARSUD") || code.startsWith("SUMSUD")) {
    return {
      meaning: "This is a sudden impulse in the ground magnetic field, the signature of a solar-wind shock.",
      explanation: "Over Zimbabwe, watch the next hours of TEC and S4. A shock can arrive before the K-index rises. The GNSS impact is the TEC and S4 change in those hours.",
    };
  }
  return {
    meaning: "This is one NOAA alert, watch or warning. The code, serial and validity are the bureau's own fields.",
    explanation: "Read it against Zimbabwe TEC and S4 before treating it as a GNSS warning for the CORS network.",
  };
}

export function zimbabweBulletinNote(code: string | null | undefined): string {
  const reading = bulletinZimbabweReading({ code });
  return `${reading.meaning} ${reading.explanation}`;
}
