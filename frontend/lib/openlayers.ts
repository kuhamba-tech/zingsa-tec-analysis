/**
 * Single OpenLayers entry for the app.
 *
 * Import this module dynamically once (`loadOpenLayers()` / `import("@/lib/openlayers")`)
 * instead of many parallel `import("ol/…")` calls. Webpack otherwise emits one
 * chunk per submodule; those race under Next.js HMR and produce ChunkLoadError
 * in the browser even when the URLs return 200 from curl.
 */
import "ol/ol.css";
import Map from "ol/Map";
import View from "ol/View";
import Overlay from "ol/Overlay";
import Feature from "ol/Feature";
import { fromLonLat } from "ol/proj";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import ImageLayer from "ol/layer/Image";
import VectorSource from "ol/source/Vector";
import XYZ from "ol/source/XYZ";
import ImageCanvas from "ol/source/ImageCanvas";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import { Style, Circle, Fill, Stroke, Text, RegularShape } from "ol/style";

export {
  Map,
  View,
  Overlay,
  Feature,
  fromLonLat,
  TileLayer,
  VectorLayer,
  ImageLayer,
  VectorSource,
  XYZ,
  ImageCanvas,
  Point,
  LineString,
  Style,
  Circle,
  Fill,
  Stroke,
  Text,
  RegularShape,
};

export type OpenLayersApi = typeof import("@/lib/openlayers");
