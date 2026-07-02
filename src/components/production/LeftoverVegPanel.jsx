import React from 'react';
import { Leaf, Plus, X, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

/**
 * Leftover-veg burn-down panel — Phase 2 of the 2026-07-01 planning logic.
 *
 * Manual: pick a raw veg + kg to use up + the meal to burn it into, and the
 * engine over-produces that meal (above par) to consume the veg. Each row shows
 * the units it works out to. The parent turns entries → burnDownMap (via
 * computeBurnDown) and feeds the engine; the per-meal max ceiling still caps it,
 * so a row can show "capped — X kg left" when the ceiling bites (mash-and-hold).
 *
 * @param {Array}    rawVeg       - [{id, sku, name}] raw veg that has a meal home
 * @param {object}   vegToMealMap - { vegId: [{ mealId, mealName, mealSku, vegKgPerUnit }] }
 * @param {Array}    entries      - [{ vegId, kg, mealId }]
 * @param {function} onChange     - (entries) => void
 * @param {object}   [recoMap]    - engine result per meal, to show what was actually made
 */
export default function LeftoverVegPanel({ rawVeg = [], vegToMealMap = {}, entries = [], onChange, recoMap = {} }) {
  if (!rawVeg.length) return null;

  const update = (i, patch) => onChange(entries.map((e, idx) => idx === i ? { ...e, ...patch } : e));
  const remove = (i) => onChange(entries.filter((_, idx) => idx !== i));
  const add = () => onChange([...entries, { vegId: '', kg: '', mealId: '' }]);

  const vegOptions = rawVeg
    .filter(v => (vegToMealMap[v.id] || []).length > 0)
    .map(v => ({ value: v.id, label: v.name, keywords: [v.sku] }));

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
          <Leaf className="w-4 h-4 text-emerald-600" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm">Use up leftover veg</h3>
          <p className="text-xs text-muted-foreground">Burn raw veg into a meal — produces above par to consume it.</p>
        </div>
        <Button size="sm" variant="outline" onClick={add} className="gap-1.5 h-8">
          <Plus className="w-3.5 h-3.5" /> Add veg
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="px-5 py-4 text-xs text-muted-foreground">No leftover veg to use up. Add a row to burn surplus into a meal.</p>
      ) : (
        <div className="divide-y divide-border">
          {entries.map((e, i) => {
            const homes = vegToMealMap[e.vegId] || [];
            const home = (e.mealId && homes.find(h => h.mealId === e.mealId)) || homes[0] || null;
            const kg = Math.max(0, Number(e.kg) || 0);
            const units = home && home.vegKgPerUnit > 0 ? Math.floor(kg / home.vegKgPerUnit) : 0;
            // What the engine actually made for that meal (may be ceiling-capped below `units`).
            const made = home ? (recoMap[home.mealId]?.recommended ?? null) : null;
            const capped = made != null && units > 0 && made < units;
            const mealOptions = homes.map(h => ({
              value: h.mealId,
              label: h.mealName || h.mealSku,
              keywords: [h.mealSku],
              node: (
                <span className="flex items-center justify-between w-full gap-2">
                  <span className="truncate">{h.mealName || h.mealSku}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{Math.round(h.vegKgPerUnit * 1000)} g/ea</span>
                </span>
              ),
            }));
            return (
              <div key={i} className="px-5 py-3 flex items-center gap-2 flex-wrap">
                <SearchableSelect
                  value={e.vegId}
                  onValueChange={(v) => update(i, { vegId: v, mealId: '' })}
                  options={vegOptions}
                  placeholder="Raw veg…"
                  triggerClassName="w-48 h-9"
                />
                <div className="flex items-center gap-1">
                  <Input
                    type="number" min="0" step="0.1" value={e.kg}
                    onChange={ev => update(i, { kg: ev.target.value })}
                    className="w-24 h-9 text-right" placeholder="kg"
                  />
                  <span className="text-xs text-muted-foreground">kg</span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                <SearchableSelect
                  value={home?.mealId || ''}
                  onValueChange={(v) => update(i, { mealId: v })}
                  options={mealOptions}
                  placeholder="Into meal…"
                  triggerClassName="w-64 h-9"
                  disabled={!e.vegId}
                />
                <div className="flex-1 min-w-[120px] text-right text-xs tabular-nums">
                  {home && units > 0 ? (
                    <span className={capped ? 'text-amber-600' : 'text-foreground'}>
                      <span className="font-semibold">{capped ? made : units}</span> units
                      {capped && <span className="text-[11px]"> (capped at max — {Math.max(0, Math.round((units - made) * home.vegKgPerUnit))} kg left)</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                <button onClick={() => remove(i)} className="text-muted-foreground hover:text-foreground p-1 shrink-0" title="Remove">
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
