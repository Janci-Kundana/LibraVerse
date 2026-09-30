import { useId, useState } from 'react';

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Single-series bar chart: one hue (brand crimson, validated against the dark
 * surface), recessive grid, a 2px gap between bars, 4px rounded data ends on
 * the baseline, a hover tooltip per bar, and a table view for screen readers.
 */
export function BarChart({
  title,
  data,
  format = String,
  tickEvery = 1,
  height = 180,
  minScale = 1,
  integer = false,
}: {
  title: string;
  data: BarDatum[];
  format?: (v: number) => string;
  tickEvery?: number;
  height?: number;
  /** smallest top of the axis, so an all-zero series still gets sensible ticks */
  minScale?: number;
  /** counts: keep every tick a whole number */
  integer?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const W = 600;
  const pad = { top: 12, right: 8, bottom: 22, left: 48 };
  const plotW = W - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(minScale, integer ? 2 : 0, ...data.map((d) => d.value));
  let niceMax = niceCeil(max);
  if (integer && niceMax % 2 !== 0) niceMax += 1;
  const step = plotW / Math.max(1, data.length);
  const gap = 2;
  const barW = Math.max(1, step - gap);
  const y = (v: number) => pad.top + plotH - (v / niceMax) * plotH;
  const ticks = [0, niceMax / 2, niceMax];

  return (
    <figure
      className="rounded-xl border border-gray-800 bg-gray-900 p-4"
      aria-labelledby={`${id}-t`}
    >
      <figcaption id={`${id}-t`} className="mb-2 text-sm font-medium text-gray-200">
        {title}
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={W - pad.right}
                y1={y(t)}
                y2={y(t)}
                stroke="#1f2937"
                strokeWidth={1}
              />
              <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.left + i * step + gap / 2;
            const h = Math.max(0, pad.top + plotH - y(d.value));
            const r = Math.min(4, barW / 2, h);
            return (
              <g
                key={d.label}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
              >
                {/* hit target: the whole column, larger than the mark */}
                <rect
                  x={pad.left + i * step}
                  y={pad.top}
                  width={step}
                  height={plotH}
                  fill="transparent"
                />
                {h > 0 && (
                  <path
                    d={`M${x},${pad.top + plotH} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
                    fill="#c0263a"
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                )}
                {i % tickEvery === 0 && (
                  <text
                    x={x + barW / 2}
                    y={height - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#9ca3af"
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hover !== null && data[hover] && (
          <div
            role="tooltip"
            className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 shadow"
            style={{ left: `${((pad.left + hover * step + step / 2) / W) * 100}%`, top: 0 }}
          >
            <span className="text-gray-400">{data[hover].label}: </span>
            {format(data[hover].value)}
          </div>
        )}
      </div>
      <details className="mt-2 text-xs text-gray-400">
        <summary className="cursor-pointer">Show as table</summary>
        <table className="mt-2 w-full">
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td className="py-0.5">{d.label}</td>
                <td className="text-right text-gray-200">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function niceCeil(v: number) {
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

export function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${tone === 'warn' ? 'text-yellow-300' : 'text-gray-100'}`}
      >
        {value}
      </p>
    </div>
  );
}
