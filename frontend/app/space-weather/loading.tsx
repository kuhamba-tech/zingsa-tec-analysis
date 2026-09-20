import SpaceWeatherTitleIcon from "@/components/spaceWeather/SpaceWeatherTitleIcon";

export default function SpaceWeatherLoading() {
  return (
    <div className="page-stack space-weather-page">
      <h1 className="page-title">
        <span className="sw-page-title-mark" aria-hidden>
          <SpaceWeatherTitleIcon />
        </span>
        <span className="sw-page-title-text">Space Weather Monitoring</span>
      </h1>
      <p className="page-subtitle" style={{ color: "var(--text-muted)" }}>
        Loading live solar and geomagnetic indices…
      </p>
    </div>
  );
}
