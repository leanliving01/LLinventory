import React from 'react';

/**
 * Renders a labelled key/value grid. `items` is an array of { label, value }.
 * Falsy values render an em-dash. Multi-line values (e.g. addresses) wrap.
 */
export default function InfoGrid({ items = [], columns = 2 }) {
  const visible = items.filter(Boolean);
  if (visible.length === 0) return null;
  return (
    <dl className={`grid grid-cols-1 ${columns === 2 ? 'sm:grid-cols-2' : ''} gap-x-8 gap-y-2.5 text-sm`}>
      {visible.map((it, i) => (
        <div key={i} className="flex flex-col">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{it.label}</dt>
          <dd className="text-slate-700 whitespace-pre-line break-words">
            {it.value !== undefined && it.value !== null && it.value !== '' ? it.value : '—'}
          </dd>
        </div>
      ))}
    </dl>
  );
}
