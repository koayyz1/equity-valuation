interface SparklineProps {
  /** Chronological values (oldest → newest). */
  values: number[];
  width?: number;
  height?: number;
  stroke: string;
}

/**
 * Tiny inline trend line for table rows. Hand-rolled SVG — far lighter than a
 * chart library instance per row. Renders nothing below 3 points.
 */
export function Sparkline({ values, width = 64, height = 18, stroke }: SparklineProps) {
  if (values.length < 3) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;

  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const [lastX, lastY] = pts[pts.length - 1];

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <polyline
        points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
      <circle cx={lastX} cy={lastY} r={2} fill={stroke} />
    </svg>
  );
}
