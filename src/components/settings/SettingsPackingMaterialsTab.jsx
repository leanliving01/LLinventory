import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Package, Loader2, IceCream, Pill } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import PackingRuleCard from './PackingRuleCard';
import PackingRuleForm from './PackingRuleForm';

export default function SettingsPackingMaterialsTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['packing-material-rules'],
    queryFn: () => base44.entities.PackingMaterialRule.list('name', 50),
  });

  const { data: packagingProducts = [] } = useQuery({
    queryKey: ['packaging-products'],
    queryFn: () => base44.entities.Product.filter({ type: 'packaging', status: 'active' }, 'name', 200),
    staleTime: 5 * 60 * 1000,
  });

  const activeRules = rules.filter(r => r.is_active);
  const inactiveRules = rules.filter(r => !r.is_active);

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
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingRule(null);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Packing Material Rules</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Auto-deduct packaging materials from inventory when orders are packed.
            </p>
          </div>
          <Button
            onClick={() => { setEditingRule(null); setShowForm(true); }}
            size="sm"
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
            Add Rule
          </Button>
        </div>

        {/* How it works */}
        <div className="px-6 py-3 bg-muted/30 border-b border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong>How it works:</strong> When an order is packed, the system checks each active rule.
            If the order contains the trigger items (supplements, meals, or always), the specified packaging material
            is automatically deducted from inventory. Use <strong>fixed per order</strong> for items like supplement boxes
            (1 per order regardless of quantity), or <strong>per X items</strong> for tiered deductions like ice packs
            (e.g. 4 per every 30 meals).
          </p>
        </div>

        {/* Rules list */}
        <div className="divide-y divide-border">
          {isLoading && (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading rules...
            </div>
          )}
          {!isLoading && rules.length === 0 && (
            <div className="px-6 py-8 text-center">
              <Package className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">No packing material rules yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Add one to automatically deduct packaging when orders are packed.</p>
            </div>
          )}
          {activeRules.map(rule => (
            <PackingRuleCard
              key={rule.id}
              rule={rule}
              onEdit={handleEdit}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
          {inactiveRules.length > 0 && (
            <>
              <div className="px-6 py-2 bg-muted/20">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Disabled</p>
              </div>
              {inactiveRules.map(rule => (
                <PackingRuleCard
                  key={rule.id}
                  rule={rule}
                  onEdit={handleEdit}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Form drawer */}
      {showForm && (
        <PackingRuleForm
          rule={editingRule}
          products={packagingProducts}
          onClose={handleFormClose}
        />
      )}
    </div>
  );
}