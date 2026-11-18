export const KP_BIN_MS = 3 * 60 * 60 * 1000;

export function alignKpSeriesToDomain(
  sourceEpochs: (number | null)[] | null,
  series: {
    observed: (number | null)[];
    estimated: (number | null)[];
    predicted: (number | null)[];
  },
  domain: { min: number; max: number },
) {
  if (!Number.isFinite(domain.min) || !Number.isFinite(domain.max) || domain.max <= domain.min) {
    return { epochs: [] as number[], observed: [], estimated: [], predicted: [] };
  }
  const binCount = Math.ceil((domain.max - domain.min) / KP_BIN_MS);
  const epochs = Array.from({ length: binCount + 1 }, (_, index) =>
    Math.min(domain.max, domain.min + index * KP_BIN_MS),
  );
  const align = (values: (number | null)[]) => {
    const aligned: (number | null)[] = Array.from({ length: epochs.length }, () => null);
    if (!sourceEpochs) return aligned;
    sourceEpochs.forEach((time, sourceIndex) => {
      const value = values[sourceIndex];
      if (time == null || !Number.isFinite(time) || time < domain.min || time >= domain.max
        || value == null || !Number.isFinite(value)) return;
      const bin = Math.round((time - domain.min) / KP_BIN_MS);
      if (bin < 0 || bin >= binCount || Math.abs(epochs[bin] - time) > KP_BIN_MS / 2) return;
      aligned[bin] = value;
    });
    return aligned;
  };
  return {
    epochs,
    observed: align(series.observed),
    estimated: align(series.estimated),
    predicted: align(series.predicted),
  };
}
