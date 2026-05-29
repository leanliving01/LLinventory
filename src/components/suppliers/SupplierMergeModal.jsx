import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X, ArrowRightLeft, AlertTriangle, CheckCircle2, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

const CONFLICT_FIELDS = [
  { key: 'name',                 label: 'Supplier Name' },
  { key: 'contact_name',         label: 'Contact Name' },
  { key: 'email',                label: 'Email' },
  { key: 'phone',                label: 'Phone' },
  { key: 'tax_id',               label: 'VAT Number' },
  { key: 'billing_address',      label: 'Billing Address' },
  { key: 'shipping_address',     label: 'Shipping Address' },
  { key: 'xero_contact_id',      label: 'Xero Contact ID' },
  { key: 'cin7_id',              label: 'Cin7 ID' },
  { key: 'payment_term_type',    label: 'Payment Terms Type' },
  { key: 'payment_term_value',   label: 'Payment Terms Value' },
  { key: 'default_tax_rate_id',  label: 'Default Tax Rate' },
];

export default function SupplierMergeModal({ supplier, onClose, onMerged }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [duplicateSupplier, setDuplicateSupplier] = useState(null);
  const [primaryId, setPrimaryId] = useState(supplier.id);
  const [resolutions, setResolutions] = useState({});
  const [merging, setMerging] = useState(false);

  const { data: allSuppliers = [] } = useQuery({
    queryKey: ['suppliers-all'],
    queryFn: () => base44.entities.Supplier.list('name', 500),
    staleTime: 60000,
  });

  const filteredSuppliers = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allSuppliers
      .filter(s => s.id !== supplier.id && s.status !== 'archived')
      .filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        (s.tax_id || '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [allSuppliers, searchQuery, supplier.id]);

  const primarySupplier  = primaryId === supplier.id ? supplier : duplicateSupplier;
  const secondarySupplier = primaryId === supplier.id ? duplicateSupplier : supplier;

  const conflictingFields = useMemo(() => {
    if (!duplicateSupplier) return [];
    return CONFLICT_FIELDS.filter(f => {
      const pVal = String(primarySupplier?.[f.key] ?? '');
      const sVal = String(secondarySupplier?.[f.key] ?? '');
      return pVal !== sVal && (pVal || sVal);
    });
  }, [duplicateSupplier, primarySupplier, secondarySupplier]);

  const handleSwapPrimary = () => {
    setPrimaryId(primaryId === supplier.id ? duplicateSupplier.id : supplier.id);
    const flipped = {};
    Object.keys(resolutions).forEach(k => {
      flipped[k] = resolutions[k] === 'primary' ? 'duplicate' : 'primary';
    });
    setResolutions(flipped);
  };

  const handleSelectDuplicate = (s) => {
    setDuplicateSupplier(s);
    setSearchQuery(s.name);
    setResolutions({});
  };

  const handleMerge = async () => {
    if (!primarySupplier || !secondarySupplier) return;
    setMerging(true);
    try {
      // 1. Apply any field-level overrides the user chose from the duplicate
      const overrides = {};
      conflictingFields.forEach(f => {
        if ((resolutions[f.key] || 'primary') === 'duplicate') {
          overrides[f.key] = secondarySupplier[f.key];
        }
      });
      if (Object.keys(overrides).length > 0) {
        await base44.entities.Supplier.update(primarySupplier.id, overrides);
      }

      // 2. Atomic FK migration + archive via SQL RPC
      const { data, error } = await supabase.rpc('merge_suppliers', {
        p_primary_id:    primarySupplier.id,
        p_duplicate_ids: [secondarySupplier.id],
      });
      if (error) throw new Error(error.message);

      toast.success(
        `${secondarySupplier.name} merged into ${primarySupplier.name} — all records transferred`
      );
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers-all'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      onMerged?.(primarySupplier.id);
      onClose();
    } catch (err) {
      toast.error('Merge failed: ' + (err.message || 'Unknown error'));
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="text-base font-semibold">Merge Suppliers</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {step === 1 && 'Select the duplicate supplier to merge away'}
              {step === 2 && 'Review conflicting fields — choose which values to keep'}
              {step === 3 && 'Confirm the merge'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {[1, 2, 3].map(s => (
                <div
                  key={s}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    s === step ? 'bg-primary' : s < step ? 'bg-primary/40' : 'bg-muted'
                  }`}
                />
              ))}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="ml-1">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* ── STEP 1: Select duplicate ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="rounded-lg border p-3 bg-primary/5">
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="text-xs shrink-0">Starting with</Badge>
                  <span className="text-sm font-medium">{supplier.name}</span>
                </div>
                {supplier.email && (
                  <p className="text-xs text-muted-foreground mt-1">{supplier.email}</p>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 block">
                  Find duplicate supplier to merge
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); if (duplicateSupplier && e.target.value !== duplicateSupplier.name) setDuplicateSupplier(null); }}
                    placeholder="Search by name, email, or VAT number..."
                    className="pl-9"
                    autoFocus
                  />
                </div>

                {filteredSuppliers.length > 0 && !duplicateSupplier && (
                  <div className="mt-1 border rounded-lg divide-y overflow-hidden">
                    {filteredSuppliers.map(s => (
                      <button
                        key={s.id}
                        onClick={() => handleSelectDuplicate(s)}
                        className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{s.name}</span>
                          {s.status === 'inactive' && (
                            <Badge variant="outline" className="text-xs">Inactive</Badge>
                          )}
                        </div>
                        {(s.email || s.tax_id) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {[s.email, s.tax_id].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {duplicateSupplier && (
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div>
                      <p className="text-[10px] uppercase font-semibold text-green-700 mb-1">Primary (keep)</p>
                      <p className="text-sm font-semibold">{primarySupplier?.name}</p>
                      {primarySupplier?.email && (
                        <p className="text-xs text-muted-foreground">{primarySupplier.email}</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleSwapPrimary}
                      title="Swap which supplier is primary"
                      className="shrink-0"
                    >
                      <ArrowRightLeft className="w-4 h-4" />
                    </Button>
                    <div className="text-right">
                      <p className="text-[10px] uppercase font-semibold text-destructive mb-1">Archive (duplicate)</p>
                      <p className="text-sm font-semibold">{secondarySupplier?.name}</p>
                      {secondarySupplier?.email && (
                        <p className="text-xs text-muted-foreground">{secondarySupplier.email}</p>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-center text-muted-foreground">
                    All POs, invoices, GRNs, credit notes, and history will move to the primary record.
                    Use <ArrowRightLeft className="inline w-3 h-3" /> to swap which is primary.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Resolve conflicts ── */}
          {step === 2 && (
            <div className="space-y-3">
              {conflictingFields.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" />
                  <p className="text-sm font-semibold">No conflicting fields</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Both suppliers have identical details — no resolution needed.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {conflictingFields.length} field{conflictingFields.length > 1 ? 's' : ''} differ between
                    the two suppliers. Click a value to select it. Primary supplier's values are selected by default.
                  </p>
                  <div className="space-y-2">
                    {conflictingFields.map(f => {
                      const choice = resolutions[f.key] || 'primary';
                      const pVal = String(primarySupplier?.[f.key] ?? '') || '—';
                      const sVal = String(secondarySupplier?.[f.key] ?? '') || '—';
                      return (
                        <div key={f.key} className="border rounded-lg p-3 space-y-2">
                          <p className="text-[10px] font-semibold uppercase text-muted-foreground">{f.label}</p>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => setResolutions(r => ({ ...r, [f.key]: 'primary' }))}
                              className={`text-left p-2.5 rounded-lg border-2 text-sm transition-colors ${
                                choice === 'primary'
                                  ? 'border-green-500 bg-green-50'
                                  : 'border-border hover:border-muted-foreground/50'
                              }`}
                            >
                              <p className="text-[10px] uppercase font-semibold text-green-700 mb-1 truncate">
                                {primarySupplier?.name}
                              </p>
                              <p className="truncate text-xs">{pVal}</p>
                            </button>
                            <button
                              onClick={() => setResolutions(r => ({ ...r, [f.key]: 'duplicate' }))}
                              className={`text-left p-2.5 rounded-lg border-2 text-sm transition-colors ${
                                choice === 'duplicate'
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border hover:border-muted-foreground/50'
                              }`}
                            >
                              <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1 truncate">
                                {secondarySupplier?.name}
                              </p>
                              <p className="truncate text-xs">{sVal}</p>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── STEP 3: Confirm ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">This cannot be undone</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    All records from <strong>{secondarySupplier?.name}</strong> will be permanently moved to{' '}
                    <strong>{primarySupplier?.name}</strong> and the duplicate will be archived.
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <p className="text-xs font-semibold uppercase text-muted-foreground">What will happen</p>
                <ul className="space-y-2">
                  {[
                    'Purchase orders, invoices, and GRNs',
                    'Supplier product catalog and pricing',
                    'Returns, credit notes, and shortages',
                    'Cooking runs and yield records',
                    'Activity history and attachments',
                  ].map(item => (
                    <li key={item} className="flex gap-2 text-muted-foreground">
                      <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                      {item} moved to <strong className="text-foreground">{primarySupplier?.name}</strong>
                    </li>
                  ))}
                  {conflictingFields.length > 0 && (
                    <li className="flex gap-2 text-muted-foreground">
                      <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                      {conflictingFields.length} conflicting field{conflictingFields.length > 1 ? 's' : ''} resolved per your selections
                    </li>
                  )}
                  <li className="flex gap-2 text-muted-foreground">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <strong className="text-foreground">{secondarySupplier?.name}</strong> will be archived
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t bg-muted/20">
          <Button
            variant="ghost"
            size="sm"
            onClick={step === 1 ? onClose : () => setStep(s => s - 1)}
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </Button>

          {step < 3 ? (
            <Button
              size="sm"
              onClick={() => setStep(s => s + 1)}
              disabled={step === 1 && !duplicateSupplier}
            >
              {step === 1 ? 'Review Conflicts →' : 'Confirm Merge →'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleMerge}
              disabled={merging}
              className="gap-2 min-w-[140px]"
            >
              {merging && <Loader2 className="w-4 h-4 animate-spin" />}
              {merging ? 'Merging…' : 'Merge Suppliers'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
