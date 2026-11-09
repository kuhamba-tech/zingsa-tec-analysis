/**
 * Loads /zgiis-sw-boot.js from the server layout.
 * A client-rendered <script> is ignored by React 19 and logs a console error.
 */
export default function SpaceWeatherBootScript() {
  return <script id="zgiis-sw-boot" src="/zgiis-sw-boot.js" />;
}
