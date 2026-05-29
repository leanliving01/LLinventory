import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { getProductSubcategory } from '@/lib/productSubcategories';
import { Droppable, Draggable } from '@hello-pangea/dnd';

const GROUP_COLORS = [
  'bg-red-100 text-red-700',
  'bg-green-100 text-green-700',
  'bg-yellow-100 text-yellow-700',
  'bg-orange-100 text-orange-700',
  'bg-rose-100 text-rose-700',
  'bg-blue-100 text-blue-700',
  'bg-amber-100 text-amber-700',
  'bg-stone-100 text-stone-700',
  'bg-purple-100 text-purple-700',
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
  'bg-cyan-100 text-cyan-700',
  'bg-slate-100 text-slate-700',
];

function ProductRow({ product, index, showCheckbox, mergeSelection, setMergeSelection, onNavigate, isDragEnabled }) {
  const isSelected = mergeSelection?.includes(product.id);

  return (
    <Draggable draggableId={product.id} index={index} isDragDisabled={!isDragEnabled}>
      {(provided, snapshot) => (
        <tr
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`transition-colors cursor-pointer ${isSelected ? 'bg-primary/5' : ''} ${
            snapshot.isDragging ? 'bg-primary/10 shadow-lg rounded-lg opacity-90' : 'hover:bg-muted/30'
          }`}
          onClick={() => !snapshot.isDragging && onNavigate(product.id)}
          style={{
            ...provided.draggableProps.style,
            display: snapshot.isDragging ? 'table' : undefined,
            width: snapshot.isDragging ? '100%' : undefined,
          }}
        >
          {/* Drag handle cell */}
          {isDragEnabled && (
            <td
              className="w-8 px-1.5 py-2.5"
              {...provided.dragHandleProps}
              onClick={e => e.stopPropagation()}
            >
              <GripVertical className="w-4 h-4 text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing" />
            </td>
          )}
          {showCheckbox && (
            <td className="w-10 px-3 py-2.5" onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => setMergeSelection(prev =>
                  prev.includes(product.id) ? prev.filter(id => id !== product.id) : [...prev, product.id]
                )}
                className="rounded w-4 h-4"
              />
            </td>
          )}
          <td className="px-4 py-2.5 text-sm font-mono font-medium">{product.sku}</td>
          <td className="px-4 py-2.5 text-sm">{product.name}</td>
          <td className="px-4 py-2.5 text-sm text-muted-foreground">{product.category || '—'}</td>
          <td className="px-4 py-2.5 text-sm text-right tabular-nums">
            {product.cost_avg ? `R ${product.cost_avg.toFixed(2)}` : '—'}
          </td>
          <td className="px-4 py-2.5 text-sm text-right tabular-nums">
            {product.price ? `R ${product.price.toFixed(2)}` : '—'}
          </td>
          <td className="px-4 py-2.5 text-sm text-center">{product.stock_uom}</td>
          <td className="px-4 py-2.5 text-center">
            <Badge className={product.inventory_tracked === false ? 'bg-gray-100 text-gray-500 text-[10px]' : 'bg-emerald-100 text-emerald-700 text-[10px]'}>
              {product.inventory_tracked === false ? 'No' : 'Yes'}
            </Badge>
          </td>
        </tr>
      )}
    </Draggable>
  );
}

function CategoryGroup({ category, items, groupIdx, isOpen, onToggle, showCheckbox, mergeSelection, setMergeSelection, onNavigate, isDragEnabled, isDragOver }) {
  const colorClass = GROUP_COLORS[groupIdx % GROUP_COLORS.length];

  return (
    <Droppable droppableId={category} type="PRODUCT">
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
        >
          <button
            onClick={() => onToggle(category)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 border-y border-border transition-all text-left ${
              snapshot.isDraggingOver
                ? 'bg-primary/10 border-primary/30 ring-2 ring-primary/20'
                : 'bg-muted/30 hover:bg-muted/50'
            }`}
          >
            {isOpen
              ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            }
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colorClass}`}>
              {category}
            </span>
            <span className="text-xs text-muted-foreground">
              {items.length} item{items.length !== 1 ? 's' : ''}
            </span>
            {snapshot.isDraggingOver && (
              <span className="text-xs font-medium text-primary ml-auto">
                Drop here to move
              </span>
            )}
          </button>

          {(isOpen || snapshot.isDraggingOver) && (
            <table className="w-full">
              <tbody className="divide-y divide-border">
                {items.map((p, idx) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    index={idx}
                    showCheckbox={showCheckbox}
                    mergeSelection={mergeSelection}
                    setMergeSelection={setMergeSelection}
                    onNavigate={onNavigate}
                    isDragEnabled={isDragEnabled}
                  />
                ))}
                {provided.placeholder}
              </tbody>
            </table>
          )}

          {!isOpen && !snapshot.isDraggingOver && (
            <div style={{ display: 'none' }}>{provided.placeholder}</div>
          )}
        </div>
      )}
    </Droppable>
  );
}


export default function GroupedProductTable({ products, showCheckbox, mergeSelection, setMergeSelection, onProductReclassify, search }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState({});
  const isDragEnabled = !!onProductReclassify;

  const grouped = useMemo(() => {
    const groups = {};
    for (const p of products) {
      const cat = p.subcategory || getProductSubcategory(p) || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => {
        if (a.startsWith('Other')) return 1;
        if (b.startsWith('Other')) return -1;
        return a.localeCompare(b);
      })
      .map(([category, items]) => ({ category, items }));
  }, [products]);

  // Auto-expand all groups when a search is active
  useEffect(() => {
    if (search && search.trim()) {
      setExpanded(prev => {
        const next = { ...prev };
        for (const group of grouped) {
          next[group.category] = true;
        }
        return next;
      });
    }
    // Do NOT collapse when search is cleared
  }, [search, grouped]);

  const toggle = (cat) => setExpanded(prev => ({ ...prev, [cat]: !prev[cat] }));

  const handleNavigate = useCallback((id) => navigate(`/catalog/${id}`), [navigate]);

  return (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Table header */}
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {isDragEnabled && <th className="w-8 px-1.5 py-3"></th>}
              {showCheckbox && <th className="w-10 px-3 py-3"></th>}
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">SKU</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Category</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Cost (ZAR)</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Price (ZAR)</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">UoM</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Inventory</th>
            </tr>
          </thead>
        </table>

        {grouped.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No products match your filters.
          </div>
        )}

        {grouped.map(({ category, items }, groupIdx) => (
          <CategoryGroup
            key={category}
            category={category}
            items={items}
            groupIdx={groupIdx}
            isOpen={expanded[category]}
            onToggle={toggle}
            showCheckbox={showCheckbox}
            mergeSelection={mergeSelection}
            setMergeSelection={setMergeSelection}
            onNavigate={handleNavigate}
            isDragEnabled={isDragEnabled}
          />
        ))}

        {isDragEnabled && (
          <div className="px-4 py-2 bg-muted/20 border-t border-border">
            <p className="text-[10px] text-muted-foreground">
              Drag a product by its handle and drop onto another subcategory to reclassify it.
            </p>
          </div>
        )}
      </div>
  );
}