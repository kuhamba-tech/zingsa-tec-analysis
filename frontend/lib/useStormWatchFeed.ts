"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getEkfAlertLog,
  getEkfStatus,
  getSolarActivity,
  getSpaceWeather,
  getStormAlertStatus,
} from "@/lib/api";
import type {
  EkfAlert,
  EkfStatus,
  SolarActivityFull,
  SpaceWeatherCurrent,
  StormAlertStatus,
} from "@/lib/types";

const POLL_MS = 120_000;

export function useStormWatchFeed(hours = 168) {
  const [alerts, setAlerts] = useState<EkfAlert[]>([]);
  const [sw, setSw] = useState<SpaceWeatherCurrent | null>(null);
  const [stormStatus, setStormStatus] = useState<StormAlertStatus | null>(null);
  const [ekf, setEkf] = useState<EkfStatus | null>(null);
  const [solar, setSolar] = useState<SolarActivityFull | null>(null);
  const [solarError, setSolarError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [alertsR, swR, statusR, ekfR, solarR] = await Promise.allSettled([
      getEkfAlertLog(hours),
      getSpaceWeather(),
      getStormAlertStatus(),
      getEkfStatus(),
      getSolarActivity(false, true),
    ]);

    if (alertsR.status === "fulfilled") setAlerts(alertsR.value);
    if (swR.status === "fulfilled") setSw(swR.value);
    if (statusR.status === "fulfilled") setStormStatus(statusR.value);
    if (ekfR.status === "fulfilled") setEkf(ekfR.value);
    if (solarR.status === "fulfilled") {
      setSolar(solarR.value);
      setSolarError(false);
    } else {
      setSolarError(true);
    }
    setNow(Date.now());
    setLoading(false);
  }, [hours]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  return {
    alerts,
    setAlerts,
    sw,
    stormStatus,
    ekf,
    solar,
    solarError,
    now,
    loading,
    reload: load,
  };
}
