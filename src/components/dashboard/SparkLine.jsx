import React from 'react';

/**
 * Inline SVG sparkline for KPI trend visualization.
 * Accepts `data` as array of numbers or `[{date, value}]` objects.
 */
export default function SparkLine({ data = [], width = 60, height = 24, color = 'currentColor', className = '' }) {
  const values = data.map(d => (typeof d === 'number' ? d : d.value ?? 0));
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const last = values[values.length - 1];
  const first = values[0];
  const lineColor = last >= first ? 'text-green-500' : 'text-red-400';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`${lineColor} ${className}`} aria-hidden>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
