import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Package, Loader2, Pill, UtensilsCrossed } from 'lucide-react';
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