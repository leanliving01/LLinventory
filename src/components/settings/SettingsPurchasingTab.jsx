import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, Save, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_MATCH_TOLERANCES, MATCH_SETTING_KEYS } from '@/lib/threeWayMatch';
import { useUnsavedChanges } from '@/lib/navigationGuard';

const FIELDS = [
  {
    key: MATCH_SETTING_KEYS.pricePct,
    label: 'Price tolerance (%)',
    help: 'How far the invoiced unit cost may differ from the PO unit cost before a line is flagged.',
    def: DEFAULT_MATCH_TOLERANCES.pricePct,
    suffix: '%',
    step: '0.5',
  },
  {
    key: MATCH_SETTING_KEYS.qtyOverPct,
    label: 'Over-billing tolerance (%)',
    help: 'How far the invoiced quantity may exceed the received quantity. 0 = you never pay for more than arrived.',
    def: DEFAULT_MATCH_TOLERANCES.qtyOverPct,
    suffix: '%',
    step: '0.5',
  },
  {
    key: MATCH_SETTING_KEYS.valueAbs,
    label: 'Value rounding allowance (R)',
    help: 'Small rand differences below this are ignored, so cent-level rounding never blocks an otherwise-clean invoice.',
    def: DEFAULT_MATCH_TOLERANCES.valueAbs,
    suffix: 'R',
    step: '0.01',
  },
];

export default function SettingsPurchasingTab() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({});

  const { data: settings = [] } = useQuery({
    queryKey: ['settings-purchasing'],
    queryFn: () => base44.entities.Setting.filter({ group: 'purchasing' }, 'key', 50),
  });

  useEffect(() => {
    const next = {};
    FIELDS.forEach((f) => {
      const s = settings.find((x) => x.key === f.key);
      next[f.key] = s ? String(s.value) : String(f.def);
    });
    setValues(next);
  }, [settings]);

  const saveSetting = async (key, value, label) => {
    const existing = settings.find((s) => s.key === key);
    if (existing) {
      await base44.entities.Setting.update(existing.id, { value });
    } else {
      await base44.entities.Setting.create({ key, value, group: 'purchasing', label });
    }
  };

  const handleSave = async () => {
    for (const f of FIELDS) {
      const n = parseFloat(values[f.key]);
      if (!Number.isFinite(n) || n < 0) { toast.error(`${f.label} must be a non-negative number`); return; }
    }
    setSaving(true);
    try {
      for (const f of FIELDS) {
        await saveSetting(f.key, String(parseFloat(values[f.key])), f.label);
      }
      queryClient.invalidateQueries({ queryKey: ['settings-purchasing'] });
      queryClient.invalidateQueries({ queryKey: ['match-tolerances'] });
      toast.success('Three-way match tolerances saved');
      return true;
    } catch (err) {
      toast.error('Failed to save: ' + (err?.message || 'Unknown error'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Dirty = any field's typed value differs from its loaded setting (or default),
  // reconstructing the baseline exactly as the seed effect does (String(s.value) || String(f.def)).
  const hasUnsavedChanges = FIELDS.some((f) => {
    const s = settings.find((x) => x.key === f.key);
    const baseline = s ? String(s.value) : String(f.def);
    return (values[f.key] ?? '') !== baseline;
  });
  useUnsavedChanges(hasUnsavedChanges, {
    message: 'You have unsaved match tolerances. Leave without saving?',
    onSave: handleSave,
  });

  const resetDefaults = () => {
    const next = {};
    FIELDS.forEach((f) => { next[f.key] = String(f.def); });
    setValues(next);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h3 className="text-base font-bold">Three-Way Match Tolerances</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          A supplier invoice is matched against its purchase order (price) and goods-received note (quantity).
          An invoice can only be approved for payment when every line is within these tolerances — otherwise a
          manager PIN is required to override. Tighter values catch more discrepancies but flag more invoices for review.
        </p>

        <div className="space-y-4 pt-1">
          {FIELDS.map((f) => (
            <div key={f.key} className="grid grid-cols-1 sm:grid-cols-[1fr,9rem] sm:items-center gap-1.5 sm:gap-4">
              <div>
                <label className="text-sm font-medium">{f.label}</label>
                <p className="text-xs text-muted-foreground mt-0.5">{f.help}</p>
              </div>
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  step={f.step}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="text-right pr-7"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{f.suffix}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Tolerances
          </Button>
          <Button variant="outline" onClick={resetDefaults} disabled={saving} className="gap-2">
            <CheckCircle2 className="w-4 h-4" /> Reset to recommended
          </Button>
        </div>
      </div>
    </div>
  );
}
