import Script from "next/script";

/**
 * Loads /zgiis-sw-boot.js before the app bundle (Next beforeInteractive).
 * Avoid a client <script> whose props flip on hydrate — that becomes a
 * HostHoistable fiber and triggers null.removeChild on client navigations.
 */
export default function SpaceWeatherBootScript() {
  return <Script id="zgiis-sw-boot" src="/zgiis-sw-boot.js" strategy="beforeInteractive" />;
}
