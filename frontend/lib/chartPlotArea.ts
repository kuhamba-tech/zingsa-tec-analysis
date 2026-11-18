import { layouts, Scale, type Chart, type ChartType, type Plugin } from "chart.js";

export type PlotArea = { left: number; right: number; top: number; bottom: number };
export type PlotBounds = Pick<PlotArea, "left" | "right">;
export type PlotAreaReporter = (
  area: PlotArea,
  align: (bounds: PlotBounds) => void,
  redraw: () => void,
  readArea: () => PlotArea | null,
) => void;

export function reportPlotAreaPlugin<T extends ChartType>(onChange?: PlotAreaReporter): Plugin<T> {
  return {
    id: "reportPlotArea",
    afterLayout(chart) {
      const { canvas, width, height } = chart;
      if (!onChange || !chart.chartArea || !width || !height) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const sx = rect.width / width;
      const measure = (position: DOMRect): PlotArea => {
        const scaleX = position.width / chart.width, scaleY = position.height / chart.height;
        return {
          left: position.left + chart.chartArea.left * scaleX,
          right: position.left + chart.chartArea.right * scaleX,
          top: position.top + chart.chartArea.top * scaleY,
          bottom: position.top + chart.chartArea.bottom * scaleY,
        };
      };
      const natural = measure(rect);
      onChange(natural, bounds => {
        let left = Math.max(0, (bounds.left - natural.left) / sx);
        let right = Math.max(0, (natural.right - bounds.right) / sx);
        if (Math.max(left, right) < .25 || bounds.right <= bounds.left) return;

        // Fit axes and labels using the shared horizontal plot space before datasets update.
        const layout = chart.options?.layout;
        if (!layout) return;
        // Chart.js wraps resolved object options in proxies. Restore the raw
        // configuration so subsequent layouts cannot wrap the same proxy again.
        const original = chart.config.options?.layout?.padding;
        const resolved = layout.padding;
        const padding = typeof resolved === "number"
          ? { left: resolved, right: resolved, top: resolved, bottom: resolved }
          : typeof resolved === "object" && "x" in resolved
            ? { left: resolved.x ?? 0, right: resolved.x ?? 0, top: resolved.y ?? 0, bottom: resolved.y ?? 0 }
            : { left: 0, right: 0, top: 0, bottom: 0, ...resolved };
        try {
          // Tick labels can change their margins after the first fit.
          for (let pass = 0; pass < 3; pass++) {
            layout.padding = { ...padding, left: padding.left + left, right: padding.right + right };
            layouts.update(chart as unknown as Chart, width, height);
            const fitted = measure(rect);
            const leftError = (bounds.left - fitted.left) / sx;
            const rightError = (fitted.right - bounds.right) / sx;
            if (Math.max(Math.abs(leftError), Math.abs(rightError)) < .25) break;
            left = Math.max(0, left + leftError);
            right = Math.max(0, right + rightError);
          }
          chart.boxes.forEach(box => { if (box instanceof Scale) box.configure(); });
        } finally {
          if (original === undefined) {
            delete layout.padding;
            // The resolver can write to a layout object it creates on demand.
            delete chart.config.options?.layout?.padding;
          } else {
            layout.padding = original;
          }
        }
      }, () => { if (chart.canvas?.isConnected) chart.update("none"); }, () => {
        if (!chart.canvas?.isConnected) return null;
        const current = chart.canvas.getBoundingClientRect();
        if (!current.width || !current.height || !chart.width || !chart.height) return null;
        return measure(current);
      });
    },
  };
}
