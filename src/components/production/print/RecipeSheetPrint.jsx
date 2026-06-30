import React from 'react';
import { format } from 'date-fns';
import { GROUP_ORDER } from '@/lib/productionSheets';

const exact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' };

// Group → sheet title + accent (matches the Excel "Total X Production" tabs).
const GROUP_META = {
  Protein: { title: 'TOTAL PROTEIN PRODUCTION', hex: '#b91c1c' },
  Starch:  { title: 'TOTAL STARCH PRODUCTION',  hex: '#a16207' },
  Veg:     { title: 'TOTAL VEG PRODUCTION',     hex: '#15803d' },
  Sauce:   { title: 'TOTAL SAUCE PRODUCTION',   hex: '#6d28d9' },
  Other:   { title: 'TOTAL OTHER PRODUCTION',   hex: '#334155' },
};

/** One bulk recipe = a compact, self-contained block (Ingredient · UOM · Total). */
function RecipeBlock({ recipe, hex }) {
  return (
    <div className="break-inside-avoid mb-2 border border-gray-300 rounded overflow-hidden"
         style={{ breakInside: 'avoid' }}>
      <div className="px-2 py-1 text-white text-xs font-bold leading-tight"
           style={{ backgroundColor: hex, ...exact }}>
        {recipe.name}
        {recipe.sku && <span className="font-mono font-normal opacity-80 ml-1">{recipe.sku}</span>}
      </div>
      <table className="w-full border-collapse text-[11px]">
        <tbody>
          {recipe.ingredients.length === 0 && (
            <tr><td className="px-2 py-1 text-gray-400">No recipe / Cook BOM</td></tr>
          )}
          {recipe.ingredients.map((ing, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="px-2 py-0.5">{ing.name}</td>
              <td className="px-1 py-0.5 text-right tabular-nums font-semibold whitespace-nowrap">{ing.value}</td>
              <td className="px-1 py-0.5 text-gray-500 w-7">{ing.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupPage({ run, group, recipes }) {
  const meta = GROUP_META[group];
  const runDate = run?.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '';
  return (
    <section className="print-page">
      <div className="flex justify-between items-center mb-3 border-b-2 pb-2" style={{ borderColor: meta.hex }}>
        <h1 className="text-lg font-extrabold tracking-tight" style={{ color: meta.hex }}>{meta.title}</h1>
        <p className="text-[11px] text-gray-600">
          {runDate}{runDate ? ' · ' : ''}{run?.run_number || ''} · {recipes.length} recipes
        </p>
      </div>
      {/* Newspaper-style columns so 8–12 recipes fit per page */}
      <div style={{ columnCount: 3, columnGap: '10px' }}>
        {recipes.map(r => <RecipeBlock key={r.sku || r.name} recipe={r} hex={meta.hex} />)}
      </div>
    </section>
  );
}

export default function RecipeSheetPrint({ run, recipes }) {
  if (!recipes) return null;
  const groups = GROUP_ORDER.filter(g => (recipes[g] || []).length > 0);
  if (groups.length === 0) {
    return <p className="text-sm text-gray-500 py-8 text-center">No bulk recipes for this run.</p>;
  }
  return (
    <div className="print-root text-gray-900">
      {groups.map(g => <GroupPage key={g} run={run} group={g} recipes={recipes[g]} />)}
    </div>
  );
}
