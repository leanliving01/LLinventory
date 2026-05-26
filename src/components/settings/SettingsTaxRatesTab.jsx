import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Percent, Star } from 'lucide-react';
import { toast } from 'sonner';

export default function SettingsTaxRatesTab() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('');
  const [newClaimable, setNewClaimable] = useState(true);

  const { data: taxRates = [], isLoading } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => base44.entities.TaxRate.list('name', 50),
    staleTime: 300000,
  });

  const handleSetDefault = async (rate) => {
    if (rate.is_default) return;
    setSaving(rate.id + '_default');
    // Clear default on all, set on this one
    for (const r of taxRates.filter(r => r.is_default)) {
      await base44.entities.TaxRate.update(r.id, { is_default: false });
    }
    await base44.entities.TaxRate.update(rate.id, { is_default: true });
    queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
    toast.success(`${rate.name} set as default`);
    setSaving(null);
  };

  const handleToggleActive = async (rate) => {
    setSaving(rate.id + '_active');
    await base44.entities.TaxRate.update(rate.id, { active: !rate.active });
    queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
    toast.success(`${rate.name} ${rate.active ? 'deactivated' : 'activated'}`);
    setSaving(null);
  };

  const handleAdd = async () => {
    if (!newName.trim()) { toast.error('Name is required'); return; }
    const rateVal = parseFloat(newRate);
    if (isNaN(rateVal) || rateVal < 0 || rateVal > 1) {
      toast.error('Rate must be a decimal between 0 and 1 (e.g. 0.15 for 15%)');
      return;
    }
    setAdding(true);
    await base44.entities.TaxRate.create({
      name: newName.trim(),
      rate: rateVal,
      is_default: false,
      applies_to_vat: newClaimable,
      active: true,
    });
    queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
    toast.success(`Tax rate "${newName.trim()}" added`);
    setNewName('');
    setNewRate('');
    setNewClaimable(true);
    setShowAddForm(false);
    setAdding(false);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Percent className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Tax Rates</h3>
            <Badge variant="outline" className="text-[10px]">{taxRates.length}</Badge>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAddForm(v => !v)}>
            <Plus className="w-3.5 h-3.5" />
            Add Rate
          </Button>
        </div>

        {showAddForm && (
          <div className="px-5 py-4 border-b border-border bg-muted/30 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">New Tax Rate</p>
            <div className="flex gap-2 flex-wrap items-end">
              <div className="flex-1 min-w-[160px] space-y-1">
                <label className="text-xs text-muted-foreground">Name</label>
                <Input
                  placeholder="e.g. Standard VAT (15%)"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
              </div>
              <div className="w-28 space-y-1">
                <label className="text-xs text-muted-foreground">Rate (decimal)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  placeholder="0.15"
                  value={newRate}
                  onChange={e => setNewRate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">VAT Claimable</label>
                <div className="flex items-center h-10">
                  <Switch checked={newClaimable} onCheckedChange={setNewClaimable} />
                </div>
              </div>
              <Button onClick={handleAdd} disabled={adding} className="gap-1.5">
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Save
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Rate: enter as decimal — 0.15 = 15%, 0.00 = 0%. Claimable = VAT can be reclaimed as input tax.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading tax rates...
          </div>
        ) : (
          <div className="divide-y divide-border">
            {taxRates.map(rate => (
              <div key={rate.id} className={`px-5 py-3.5 flex items-center justify-between gap-4 ${!rate.active ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{rate.name}</span>
                      {rate.is_default && (
                        <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200 gap-1">
                          <Star className="w-2.5 h-2.5" /> Default
                        </Badge>
                      )}
                      {!rate.active && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground font-mono">
                        {(rate.rate * 100).toFixed(2)}%
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${rate.applies_to_vat ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {rate.applies_to_vat ? 'VAT Claimable' : 'Not Claimable'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!rate.is_default && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 px-2 gap-1"
                      disabled={saving === rate.id + '_default'}
                      onClick={() => handleSetDefault(rate)}
                    >
                      {saving === rate.id + '_default'
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Star className="w-3 h-3" />}
                      Set Default
                    </Button>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{rate.active ? 'Active' : 'Inactive'}</span>
                    <Switch
                      checked={rate.active}
                      onCheckedChange={() => handleToggleActive(rate)}
                      disabled={saving === rate.id + '_active' || rate.is_default}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 space-y-1">
        <p className="font-semibold">How tax rates work on purchases:</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>All costs are entered EXCLUDING VAT. VAT is added on top.</li>
          <li><strong>VAT Claimable</strong> — inventory value uses the EXCLUDING VAT cost (e.g. Standard VAT 15%, Zero-Rated 0%).</li>
          <li><strong>Not Claimable</strong> — inventory value uses the INCLUDING VAT cost, since the VAT cannot be reclaimed (e.g. VAT Exempt, No VAT).</li>
          <li>The default rate applies when no specific rule is set on the supplier or product.</li>
        </ul>
      </div>
    </div>
  );
}
