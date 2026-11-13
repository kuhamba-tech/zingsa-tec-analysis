/** Scientific message selection; no WhatsApp calls or credentials in this module. */
export function inviteCode(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "chat.whatsapp.com") throw new Error("Use a WhatsApp group invitation link");
  const code = url.pathname.split("/").filter(Boolean)[0];
  if (!code || !/^[A-Za-z0-9_-]{16,64}$/.test(code)) throw new Error("Invalid group invitation code");
  return code;
}

export function apiUrl(base, route) {
  const url = new URL(base);
  if (url.hostname.endsWith(".vercel.app")) {
    url.pathname = route.startsWith("/gic/") ? "/api/core-router" : "/api/space-weather-router";
    url.search = "";
    url.searchParams.set("__zr", route);
  } else {
    url.pathname = `${url.pathname.replace(/\/$/, "")}${route}`;
  }
  return url;
}

function when(value) {
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? `${time.toISOString().replace("T", " ").slice(0, 19)} UTC` : "Unavailable";
}

function fresh(value, now, maxAgeMinutes) {
  const stamp = Date.parse(value ?? "");
  const age = now - stamp;
  return Number.isFinite(stamp) && age >= -300000 && age <= maxAgeMinutes * 60000;
}

export function selectAlerts(snapshot, gic, { now = Date.now(), maxAgeMinutes = 360 } = {}) {
  const result = [];
  for (const alert of snapshot?.active ?? []) {
    if (!["active", "watch"].includes(alert.status) || !alert.alert_id || !fresh(alert.observation_time, now, maxAgeMinutes)) continue;
    const experimental = alert.authority === "zingsa_experimental";
    const authority = experimental ? "ZINGSA experimental driver watch" : alert.authority === "official_noaa" ? "International reference / observed indices" : "Zimbabwe GNSS observation alert";
    const text = ["*ZINGSA SPACE WEATHER ALERT*", `${String(alert.severity).toUpperCase()} / ${authority}`, "",
      alert.title, alert.message, "",
      alert.observed_value != null ? `Observed: ${alert.observed_value}${alert.unit ? ` ${alert.unit}` : ""}` : "",
      `Observation: ${when(alert.observation_time)}`, `Source: ${alert.source ?? "Not supplied"}`,
      experimental ? "Driver risk only; this does not confirm a geomagnetic storm or GNSS outage." : "Local operational impacts require independent confirmation.",
      "https://zingsa-gnss-tec.vercel.app/storm-watch/"].filter(Boolean).join("\n");
    result.push({ key: `early:${alert.alert_id}:${alert.severity}:${alert.status}`, text });
  }
  for (const station of gic?.stations ?? []) {
    for (const alert of station.observed_alerts ?? []) {
      if (!alert.fresh || !alert.engineering_action_authorized || alert.provisional || !fresh(alert.time, now, maxAgeMinutes)) continue;
      const text = ["*ZINGSA OBSERVED GIC FLAG*", `${station.name} / ${station.station_id}`,
        `Measured signed current: ${alert.current_a} A (${alert.polarity})`,
        `Observation: ${when(alert.time)}`, `Transformer: ${station.configuration?.transformer_id ?? "Not documented"}`,
        `Observed threshold intervals: ${alert.duration_seconds == null ? "Unknown" : `${alert.duration_seconds} seconds; gaps excluded`}`,
        "Observed current flag under recorded site policy. No universal transformer-damage threshold or prediction warning is asserted.",
        "https://zingsa-gnss-tec.vercel.app/gic-monitor/"].join("\n");
      result.push({ key: `gic:${station.station_id}:${alert.time}:${alert.current_a}`, text });
    }
  }
  return result;
}

export function isGroupId(id) { return typeof id === "string" && /^[0-9-]+@g\.us$/.test(id); }

export async function sendPending(alerts, state, { groupId, send, persist, now = Date.now() }) {
  if (!isGroupId(groupId)) throw new Error("Delivery target must be a genuine WhatsApp group ID");
  state.messages ??= {};
  for (const alert of alerts) {
    const key = `${groupId}:${alert.key}`;
    if (state.messages[key] && state.messages[key].ack !== -1) continue;
    const message = await send(groupId, alert.text);
    const id = message?.id?._serialized;
    if (!id) throw new Error("WhatsApp did not return an accepted message identifier");
    state.messages[key] = { id, accepted_at: new Date(now).toISOString(), ack: message.ack ?? 0 };
    await persist(state);
  }
  return state;
}
