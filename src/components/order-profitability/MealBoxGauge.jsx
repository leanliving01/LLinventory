import React, { useId } from 'react';
import { fillFraction, isOverflowing, tierMeta } from '@/lib/profitVisual';

/**
 * MealBoxGauge — the signature "how profitable is this?" visual.
 *
 * A takeaway meal box that fills with liquid proportional to the margin: 50%
 * margin ≈ half full, a thin margin barely covers the base, and a thriving
 * margin bubbles up and spills over the rim. Colour ramps red → amber → green.
 *
 * Props:
 *   margin   number   profit margin % (drives fill height + colour)
 *   size     number   svg width in px (default 150)
 *   label    string   caption under the box (e.g. "30-Meal Pack")
 *   value    string   value line under the caption (e.g. "R 12 300 profit")
 *   showPct  bool     render the % inside the box (default true)
 */
export default function MealBoxGauge({ margin = 0, size = 150, label, value, showPct = true }) {
  const uid = useId().replace(/:/g, '');
  const tier = tierMeta(margin);
  const frac = fillFraction(margin);
  const overflow = isOverflowing(margin);

  // Box interior geometry (slight trapezoid, like a food container).
  const TOP = 34;      // liquid can rise to just under the lid
  const BOTTOM = 112;
  const surfaceY = BOTTOM - frac * (BOTTOM - TOP);

  const clipId = `mbg-clip-${uid}`;
  const liqId = `mbg-liq-${uid}`;
  const glowId = `mbg-glow-${uid}`;

  // One wave period = 120 user units; path spans -120..480 so the visible
  // 0..120 strip stays covered across the -120px loop translate.
  const wave = (amp) =>
    `M-120,0 q30,${-amp} 60,0 t60,0 t60,0 t60,0 t60,0 t60,0 t60,0 t60,0 t60,0 t60,0 L480,140 L-120,140 Z`;

  const h = Math.round(size * 1.16);

  return (
    <div className="flex flex-col items-center select-none" style={{ width: size }}>
      <svg width={size} height={(size * 130) / 120} viewBox="0 0 120 130" role="img"
        aria-label={`${Math.round(margin)} percent margin`}>
        <defs>
          <clipPath id={clipId}>
            <path d="M20,32 H100 L93,112 Q93,116 89,116 H31 Q27,116 27,112 Z" />
          </clipPath>
          <linearGradient id={liqId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tier.glow} stopOpacity="0.95" />
            <stop offset="100%" stopColor={tier.color} stopOpacity="1" />
          </linearGradient>
          <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Empty box backdrop */}
        <path d="M20,32 H100 L93,112 Q93,116 89,116 H31 Q27,116 27,112 Z"
          fill="hsl(var(--muted))" opacity="0.45" />

        {/* Liquid (clipped to box interior) */}
        <g clipPath={`url(#${clipId})`}>
          {frac > 0 && (
            <g style={{ transform: `translateY(${surfaceY}px)`, transition: 'transform 900ms cubic-bezier(.4,0,.2,1)' }}>
              <rect x="0" y="0" width="120" height="160" fill={`url(#${liqId})`} />
              <path className="profit-wave" d={wave(5)} fill={tier.glow} opacity="0.55" />
              <path className="profit-wave-2" d={wave(4)} fill={tier.glow} opacity="0.35" />
            </g>
          )}
          {/* Rising bubbles when there's a meaningful fill */}
          {frac > 0.18 &&
            [{ x: 42, d: '0s', r: 1.8 }, { x: 60, d: '0.9s', r: 2.4 }, { x: 76, d: '1.7s', r: 1.6 }].map((b, i) => (
              <circle key={i} className="profit-bubble" cx={b.x} cy="108" r={b.r}
                fill="#fff" opacity="0.5" style={{ animationDelay: b.d }} />
            ))}
        </g>

        {/* Overflow droplets spilling over the rim */}
        {overflow && (
          <g className="profit-overflow-glow" filter={`url(#${glowId})`}>
            <path d="M24,34 q-4,8 -1,14 q4,-3 3,-9 z" fill={tier.color} opacity="0.9" />
            <path d="M96,34 q4,8 1,14 q-4,-3 -3,-9 z" fill={tier.color} opacity="0.9" />
            <circle cx="22" cy="52" r="2" fill={tier.glow} />
            <circle cx="98" cy="50" r="1.8" fill={tier.glow} />
          </g>
        )}

        {/* Lid */}
        <rect x="17" y="22" width="86" height="11" rx="3.5"
          fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth="1.2" />
        <rect x="52" y="18" width="16" height="6" rx="2" fill="hsl(var(--muted-foreground))" opacity="0.5" />

        {/* Box outline on top for crisp edges */}
        <path d="M20,32 H100 L93,112 Q93,116 89,116 H31 Q27,116 27,112 Z"
          fill="none" stroke="hsl(var(--border))" strokeWidth="1.6" />

        {/* Margin % inside the box */}
        {showPct && (
          <text x="60" y="78" textAnchor="middle" fontWeight="800"
            fontSize="20" fill="#fff" style={{ paintOrder: 'stroke', textShadow: '0 1px 3px rgba(0,0,0,.35)' }}>
            {Math.round(margin)}%
          </text>
        )}
      </svg>

      {(label || value) && (
        <div className="text-center mt-0.5 -mt-1">
          {label && <p className="text-xs font-semibold text-foreground leading-tight">{label}</p>}
          {value && <p className="text-[11px] text-muted-foreground tabular-nums leading-tight">{value}</p>}
          <p className="text-[10px] font-medium mt-0.5" style={{ color: tier.color }}>
            {tier.emoji} {tier.label}
          </p>
        </div>
      )}
    </div>
  );
}
