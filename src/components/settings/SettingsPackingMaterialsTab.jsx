import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, Package, Loader2, Pill, UtensilsCrossed, Truck, Save } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import PackingRuleCard from './PackingRuleCard';
import PackingRuleForm from './PackingRuleForm';

const TRIGGER_GROUPS = [
  {
    key: 'has_meals',
    label: 'When order has meals',
    description: 'These materials are deducted when any meals (packages, BYO, standalone) are in the order. The system counts every individual meal across all package types.',
    icon: UtensilsCrossed,
    color: 'bg-status-info-subtle text-status-info',
  },
  {
    key: 'has_supplements',
    label: 'When order has supplements',
    description: 'These materials are deducted when any supplement products are in the order.',
    icon: Pill,
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  },
  {
    key: 'always',
    label: 'Every order',
    description: 'These materials are deducted on every packed order regardless of contents.',
    icon: Package,
    color: 'bg-muted text-muted-foreground',
  },
];

export default function SettingsPackingMaterialsTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [presetTrigger, setPresetTrigger] = useState(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['packing-material-rules'],
    queryFn: () => base44.entities.PackingMaterialRule.list('name', 50),
  });

  // Standard courier cost setting (auto-applied to each order at fulfilment).
  const { data: courierSetting } = useQuery({
    queryKey: ['setting', 'standard_courier_cost'],
    queryFn: async () => {
      const rows = await base44.entities.Setting.filter({ key: 'standard_courier_cost' });
      return rows?.[0] || null;
    },
  });
  const [courierCost, setCourierCost] = useState('');
  const [savingCourier, setSavingCourier] = useState(false);
  React.useEffect(() => {
    if (courierSetting) setCourierCost(courierSetting.value ?? '');
  }, [courierSetting]);

  const saveCourierCost = async () => {
    const val = String(Number(courierCost) || 0);
    setSavingCourier(true);
    try {
      if (courierSetting?.id) {
        await base44.entities.Setting.update(courierSetting.id, { value: val });
      } else {
        await base44.entities.Setting.create({
          key: 'standard_courier_cost', value: val, group: 'org',
          label: 'Standard courier cost per order (R)',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['setting', 'standard_courier_cost'] });
      toast.success('Standard courier cost saved');
    } catch (err) {
      toast.error(err.message || 'Could not save');
    } finally {
      setSavingCourier(false);
    }
  };

  // External packing-app URL template (deep-link button on the order packing list).
  const { data: appUrlSetting } = useQuery({
    queryKey: ['setting', 'packing_app_url_template'],
    queryFn: async () => {
      const rows = await base44.entities.Setting.filter({ key: 'packing_app_url_template' });
      return rows?.[0] || null;
    },
  });
  const [appUrl, setAppUrl] = useState('');
  const [savingAppUrl, setSavingAppUrl] = useState(false);
  React.useEffect(() => { if (appUrlSetting) setAppUrl(appUrlSetting.value ?? ''); }, [appUrlSetting]);

  const saveAppUrl = async () => {
    setSavingAppUrl(true);
    try {
      if (appUrlSetting?.id) {
        await base44.entities.Setting.update(appUrlSetting.id, { value: appUrl.trim() });
      } else {
        await base44.entities.Setting.create({
          key: 'packing_app_url_template', value: appUrl.trim(), group: 'org',
          label: 'Packing app URL template',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['setting', 'packing_app_url_template'] });
      toast.success('Packing app link saved');
    } catch (err) {
      toast.error(err.message || 'Could not save');
    } finally {
      setSavingAppUrl(false);
    }
  };

  const { data: packagingProducts = [] } = useQuery({
    queryKey: ['packaging-products'],
    queryFn: () => base44.entities.Product.filter({ type: 'packaging', status: 'active' }, 'name', 200),
    staleTime: 5 * 60 * 1000,
  });

  const rulesByTrigger = useMemo(() => {
    const map = { has_meals: [], has_supplements: [], always: [] };
    rules.forEach(r => {
      const key = r.trigger || 'always';
      if (map[key]) map[key].push(r);
      else map.always.push(r);
    });
    return map;
  }, [rules]);

  const handleDelete = async (rule) => {
    await base44.entities.PackingMaterialRule.delete(rule.id);
    queryClient.invalidateQueries({ queryKey: ['packing-material-rules'] });
    toast.success(`Deleted "${rule.name}"`);
  };

  const handleToggle = async (rule) => {
    await base44.entities.PackingMaterialRule.update(rule.id, { is_active: !rule.is_active });
    queryClient.invalidateQueries({ queryKey: ['packing-material-rules'] });
    toast.success(`${rule.name} ${rule.is_active ? 'disabled' : 'enabled'}`);
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setPresetTrigger(null);
    setShowForm(true);
  };

  const handleAddInGroup = (triggerKey) => {
    setEditingRule(null);
    setPresetTrigger(triggerKey);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingRule(null);
    setPresetTrigger(null);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Explainer */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Packing Material Rules</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Auto-deduct packaging materials from inventory when orders are packed.
            Add multiple items per trigger — they all fire together.
          </p>
        </div>
        <div className="px-6 py-3 bg-muted/30 border-b border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong>Meal counting:</strong> The system sums every individual meal in the order — whether it comes from
            a goal-based package (e.g. Men's Lean Muscle 15 = 15 meals), a Build Your Own order, or standalone meals.
            For <strong>"per X items"</strong> rules, it rounds up (31 meals at "4 per 30" = 8 deducted).
          </p>
        </div>

        {isLoading && (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
            Loading rules...
          </div>
        )}
      </div>

      {/* Standard courier cost */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
            <Truck className="w-4.5 h-4.5" strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">Standard courier cost</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Applied automatically as the courier cost on every order when it is fulfilled.
              You can override it on an individual order in its Additional Costs.
            </p>
          </div>
        </div>
        <div className="px-6 py-4 flex items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold">Cost per order (R)</label>
            <Input
              type="number" min="0" step="0.01"
              value={courierCost}
              onChange={(e) => setCourierCost(e.target.value)}
              className="w-40 tabular-nums"
              placeholder="0.00"
            />
          </div>
          <Button onClick={saveCourierCost} disabled={savingCourier} className="gap-1.5">
            {savingCourier ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" strokeWidth={1.5} />}
            Save
          </Button>
        </div>
        <div className="px-6 pb-4 space-y-1.5">
          <label className="text-xs font-semibold">Packing app URL (optional)</label>
          <p className="text-[11px] text-muted-foreground">
            Adds an "Open in Packing App" button on each order's Packing List. Use
            <code className="mx-1 px-1 bg-muted rounded">{'{order_number}'}</code>,
            <code className="mx-1 px-1 bg-muted rounded">{'{order_id}'}</code> or
            <code className="mx-1 px-1 bg-muted rounded">{'{shopify_order_id}'}</code> as placeholders.
          </p>
          <div className="flex items-end gap-3">
            <Input
              value={appUrl}
              onChange={(e) => setAppUrl(e.target.value)}
              className="flex-1"
              placeholder="https://yourapp.com/pack?order={order_number}"
            />
            <Button onClick={saveAppUrl} disabled={savingAppUrl} variant="outline" className="gap-1.5">
              {savingAppUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" strokeWidth={1.5} />}
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Grouped sections */}
      {!isLoading && TRIGGER_GROUPS.map(group => {
        const groupRules = rulesByTrigger[group.key] || [];
        const Icon = group.icon;
        const activeCount = groupRules.filter(r => r.is_active).length;

        return (
          <div key={group.key} className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Group header */}
            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", group.color)}>
                <Icon className="w-4.5 h-4.5" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{group.label}</h3>
                  {groupRules.length > 0 && (
                    <Badge variant="outline" className="text-[10px] tabular-nums">
                      {activeCount} active
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{group.description}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => handleAddInGroup(group.key)}
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
                Add Item
              </Button>
            </div>

            {/* Rules in this group */}
            <div className="divide-y divide-border">
              {groupRules.length === 0 && (
                <div className="px-6 py-5 text-center">
                  <p className="text-xs text-muted-foreground">
                    No materials configured yet. Click <strong>Add Item</strong> to add one.
                  </p>
                </div>
              )}
              {groupRules.map(rule => (
                <PackingRuleCard
                  key={rule.id}
                  rule={rule}
                  onEdit={handleEdit}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Form modal */}
      {showForm && (
        <PackingRuleForm
          rule={editingRule}
          products={packagingProducts}
          onClose={handleFormClose}
          defaultTrigger={presetTrigger}
        />
      )}
    </div>
  );
}