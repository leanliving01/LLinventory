import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Star } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Generic add/list/activate/set-default manager for a single accounting account
 * type (cogs | inventory | revenue). Modelled on SettingsTaxRatesTab's pattern.
 *
 * Props:
 *   accountType — 'cogs' | 'inventory' | 'revenue'
 *   title       — section heading, e.g. "COGS Accounts"
 *   icon        — optional lucide icon component
 */
export default function AccountListSection({ accountType, title, icon: Icon }) {
  const queryClient = useQueryClient();
  const queryKey = ['accounting-accounts', accountType];
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');

  const { data: accounts = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => base44.entities.AccountingAccount.filter({ account_type: accountType, is_active: true }, 'sort_order', 200),
    staleTime: 300000,
  });

  const handleSetDefault = async (acct) => {
    if (acct.is_default) return;
    setSaving(acct.id + '_default');
    try {
      for (const a of accounts.filter(a => a.is_default)) {
        await base44.entities.AccountingAccount.update(a.id, { is_default: false });
      }
      await base44.entities.AccountingAccount.update(acct.id, { is_default: true });
      queryClient.invalidateQueries({ queryKey });
      toast.success(`${acct.name} set as default`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(null);
    }
  };

  const handleToggleActive = async (acct) => {
    setSaving(acct.id + '_active');
    try {
      await base44.entities.AccountingAccount.update(acct.id, { is_active: !acct.is_active });
      queryClient.invalidateQueries({ queryKey });
      toast.success(`${acct.name} ${acct.is_active ? 'deactivated' : 'activated'}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(null);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) { toast.error('Name is required'); return; }
    setAdding(true);
    try {
      await base44.entities.AccountingAccount.create({
        account_type: accountType,
        name: newName.trim(),
        code: newCode.trim() || null,
        is_default: accounts.length === 0,
        is_active: true,
        sort_order: 999,
      });
      queryClient.invalidateQueries({ queryKey });
      toast.success(`Account "${newName.trim()}" added`);
      setNewName('');
      setNewCode('');
      setShowAddForm(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-primary" />}
          <h3 className="text-sm font-semibold">{title}</h3>
          <Badge variant="outline" className="text-[10px]">{accounts.length}</Badge>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAddForm(v => !v)}>
          <Plus className="w-3.5 h-3.5" />
          Add Account
        </Button>
      </div>

      {showAddForm && (
        <div className="px-5 py-4 border-b border-border bg-muted/30 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">New Account</p>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-[180px] space-y-1">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                placeholder="e.g. Cost of Goods Sold"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              />
            </div>
            <div className="w-32 space-y-1">
              <label className="text-xs text-muted-foreground">Code (optional)</label>
              <Input
                placeholder="e.g. 403"
                value={newCode}
                onChange={e => setNewCode(e.target.value)}
                className="font-mono"
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              />
            </div>
            <Button onClick={handleAdd} disabled={adding} className="gap-1.5">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Save
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Code is the accounting/Xero account number (optional). The account number is what gets stored on the product.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading accounts...
        </div>
      ) : accounts.length === 0 ? (
        <div className="px-5 py-6 text-sm text-muted-foreground">No accounts yet — add one above.</div>
      ) : (
        <div className="divide-y divide-border">
          {accounts.map(acct => (
            <div key={acct.id} className={`px-5 py-3.5 flex items-center justify-between gap-4 ${!acct.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{acct.name}</span>
                    {acct.is_default && (
                      <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200 gap-1">
                        <Star className="w-2.5 h-2.5" /> Default
                      </Badge>
                    )}
                    {!acct.is_active && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>
                    )}
                  </div>
                  {acct.code && (
                    <span className="text-xs text-muted-foreground font-mono mt-0.5 inline-block">{acct.code}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!acct.is_default && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 px-2 gap-1"
                    disabled={saving === acct.id + '_default'}
                    onClick={() => handleSetDefault(acct)}
                  >
                    {saving === acct.id + '_default'
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Star className="w-3 h-3" />}
                    Set Default
                  </Button>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{acct.is_active ? 'Active' : 'Inactive'}</span>
                  <Switch
                    checked={acct.is_active}
                    onCheckedChange={() => handleToggleActive(acct)}
                    disabled={saving === acct.id + '_active' || acct.is_default}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
