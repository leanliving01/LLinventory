import React, { useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import {
  resolveSubcategory,
  makeSubcategorySorter,
  getCategoryLabel,
  getCategoryColor,
} from '@/lib/productClassification';
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

// Render the data cells for a single product. Shared by dnd and plain rows so
// the column set is guaranteed identical everywhere (alignment).
function ProductCells({ product, showCheckbox, mergeSelection, setMergeSelection, dndEnabled, dragHandleProps, locationMap, sohMap }) {
  const isSelected = mergeSelection?.includes(product.id);
  const onHand = sohMap ? sohMap[product.id] : undefined;
  const price = product.selling_price ?? product.price;
  return (
    <>
      {dndEnabled && (
        <td className="w-8 px-1.5 py-2.5" {...dragHandleProps} onClick={e => e.stopPropagation()}>
          <GripVertical className="w-4 h-4 text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing" />
        </td>
      )}
      {showCheckbox && (
        <td className="w-10 px-3 py-2.5" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={!!isSelected}
            onChange={() => setMergeSelection(prev =>
              prev.includes(product.id) ? prev.filter(id => id !== product.id) : [...prev, product.id]
            )}
            className="rounded w-4 h-4"
          />
        </td>
      )}
      <td className="px-4 py-2.5 text-sm font-mono font-medium">{product.sku}</td>
      <td className="px-4 py-2.5 text-sm">{product.name}</td>
      <td className="px-4 py-2.5 text-center">
        <Badge className={`text-[10px] ${getCategoryColor(product.type)}`}>
          {getCategoryLabel(product.type)}
        </Badge>
      </td>
      <td className="px-4 py-2.5 text-sm text-muted-foreground">
        {(locationMap && locationMap[product.default_location_id]) || '—'}
      </td>
      <td className="px-4 py-2.5 text-sm text-right tabular-nums">
        {product.cost_avg ? `R ${product.cost_avg.toFixed(2)}` : '—'}
      </td>
      <td className="px-4 py-2.5 text-sm text-right tabular-nums">
        {price ? `R ${Number(price).toFixed(2)}` : '—'}
      </td>
      <td className="px-4 py-2.5 text-sm text-center">{product.stock_uom}</td>
      <td className="px-4 py-2.5 text-sm text-right tabular-nums">
        {onHand != null ? `${Number(onHand).toFixed(1)} ${product.stock_uom || ''}`.trim() : '—'}
      </td>
      <td className="px-4 py-2.5 text-center">
        <Badge className={product.inventory_tracked === false ? 'bg-gray-100 text-gray-500 text-[10px]' : 'bg-emerald-100 text-emerald-700 text-[10px]'}>
          {product.inventory_tracked === false ? 'No' : 'Yes'}
        </Badge>
      </td>
    </>
  );
}

function ProductRow({ product, index, dndEnabled, onNavigate, ...cellProps }) {
  if (!dndEnabled) {
    return (
      <tr
        className={`transition-colors cursor-pointer hover:bg-muted/30 ${cellProps.mergeSelection?.includes(product.id) ? 'bg-primary/5' : ''}`}
        onClick={() => onNavigate(product.id)}
      >
        <ProductCells product={product} dndEnabled={false} {...cellProps} />
      </tr>
    );
  }
  return (
    <Draggable draggableId={product.id} index={index}>
      {(provided, snapshot) => (
        <tr
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`transition-colors cursor-pointer ${cellProps.mergeSelection?.includes(product.id) ? 'bg-primary/5' : ''} ${
            snapshot.isDragging ? 'bg-primary/10 shadow-lg opacity-90' : 'hover:bg-muted/30'
          }`}
          onClick={() => !snapshot.isDragging && onNavigate(product.id)}
          style={{
            ...provided.draggableProps.style,
            display: snapshot.isDragging ? 'table' : undefined,
            width: snapshot.isDragging ? '100%' : undefined,
          }}
        >
          <ProductCells product={product} dndEnabled dragHandleProps={provided.dragHandleProps} {...cellProps} />
        </tr>
      )}
    </Draggable>
  );
}

function GroupHeadingRow({ name, count, groupIdx, colSpan, collapsible, isOpen, onToggle, isDraggingOver, items, showCheckbox, mergeSelection, setMergeSelection }) {
  const colorClass = GROUP_COLORS[groupIdx % GROUP_COLORS.length];
  const checkboxRef = React.useRef(null);
  const ids = items ? items.map(i => i.id) : [];
  const selectedCount = mergeSelection ? ids.filter(id => mergeSelection.includes(id)).length : 0;
  const allSelected = ids.length > 0 && selectedCount === ids.length;
  const someSelected = selectedCount > 0 && !allSelected;

  React.useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleGroup = () => {
    setMergeSelection?.(prev => {
      if (allSelected) {
        const rm = new Set(ids);
        return prev.filter(id => !rm.has(id));
      }
      return [...new Set([...prev, ...ids])];
    });
  };

  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <div className={`flex items-center border-y border-border transition-all ${
          isDraggingOver ? 'bg-primary/10 border-primary/30' : 'bg-muted/30'
        }`}>
          {showCheckbox && (
            <span className="pl-4 pr-1 flex items-center" onClick={e => e.stopPropagation()} title="Select all in this group">
              <input
                ref={checkboxRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleGroup}
                className="rounded w-4 h-4 cursor-pointer"
              />
            </span>
          )}
          <button
            type="button"
            onClick={() => collapsible && onToggle?.(name)}
            className={`flex-1 flex items-center gap-3 ${showCheckbox ? 'pl-2' : 'pl-4'} pr-4 py-2.5 text-left hover:bg-muted/50 ${collapsible ? '' : 'cursor-default'}`}
          >
            {collapsible && (isOpen
              ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />)}
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colorClass}`}>{name}</span>
            <span className="text-xs text-muted-foreground">{count} item{count !== 1 ? 's' : ''}</span>
            {selectedCount > 0 && (
              <span className="text-[10px] text-primary font-medium">· {selectedCount} selected</span>
            )}
            {isDraggingOver && (
              <span className="text-xs font-medium text-primary ml-auto">Drop here to move</span>
            )}
          </button>
        </div>
      </td>
    </tr>
  );
}

// A group body: a single <tbody>. In grouped+dnd mode the <tbody> is the
// Droppable; otherwise it's a plain <tbody>. Either way it lives inside ONE
// shared <table>, so the <colgroup> keeps every column aligned.
function GroupBody({ name, items, groupIdx, colSpan, viewMode, expanded, onToggle, dndEnabled, onNavigate, cellProps }) {
  const collapsible = viewMode === 'grouped';
  const isOpen = !collapsible || !!expanded[name];

  if (!dndEnabled) {
    return (
      <tbody className="divide-y divide-border">
        <GroupHeadingRow
          name={name} count={items.length} groupIdx={groupIdx} colSpan={colSpan}
          collapsible={collapsible} isOpen={isOpen} onToggle={onToggle} isDraggingOver={false}
          items={items} showCheckbox={cellProps.showCheckbox}
          mergeSelection={cellProps.mergeSelection} setMergeSelection={cellProps.setMergeSelection}
        />
        {isOpen && items.map((p, idx) => (
          <ProductRow key={p.id} product={p} index={idx} dndEnabled={false} onNavigate={onNavigate} {...cellProps} />
        ))}
      </tbody>
    );
  }

  return (
    <Droppable droppableId={name} type="PRODUCT">
      {(provided, snapshot) => (
        <tbody ref={provided.innerRef} {...provided.droppableProps} className="divide-y divide-border">
          <GroupHeadingRow
            name={name}
            count={items.length}
            groupIdx={groupIdx}
            colSpan={colSpan}
            collapsible
            isOpen={isOpen}
            onToggle={onToggle}
            isDraggingOver={snapshot.isDraggingOver}
            items={items}
            showCheckbox={cellProps.showCheckbox}
            mergeSelection={cellProps.mergeSelection}
            setMergeSelection={cellProps.setMergeSelection}
          />
          {(isOpen || snapshot.isDraggingOver) && items.map((p, idx) => (
            <ProductRow key={p.id} product={p} index={idx} dndEnabled onNavigate={onNavigate} {...cellProps} />
          ))}
          {provided.placeholder}
        </tbody>
      )}
    </Droppable>
  );
}

export default function GroupedProductTable({
  products,
  type,
  viewMode = 'grouped',
  expanded = {},
  onToggle,
  showCheckbox,
  mergeSelection,
  setMergeSelection,
  onProductReclassify,
  sohMap,
  locationMap,
  search,
  subcategoryOrder,
}) {
  const navigate = useNavigate();
  const dndEnabled = viewMode === 'grouped' && !!onProductReclassify;

  const grouped = useMemo(() => {
    const groups = {};
    for (const p of products) {
      const name = resolveSubcategory(p) || 'Other';
      if (!groups[name]) groups[name] = [];
      groups[name].push(p);
    }
    const sorter = makeSubcategorySorter(type, subcategoryOrder);
    return Object.entries(groups)
      .sort(([a], [b]) => sorter(a, b))
      .map(([name, items]) => ({ name, items }));
  }, [products, type]);

  // Auto-expand all groups when a search is active (collapsible mode only).
  useEffect(() => {
    if (viewMode === 'grouped' && search && search.trim() && onToggle) {
      onToggle('__expand_all__', grouped.map(g => g.name));
    }
  }, [search, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNavigate = useCallback((id) => navigate(`/catalog/${id}`), [navigate]);

  const hasDrag = dndEnabled;
  const dataCols = 9; // SKU, Name, Category, Default Location, Cost, Price, UoM, On Hand, Inventory
  const colSpan = (hasDrag ? 1 : 0) + (showCheckbox ? 1 : 0) + dataCols;

  const cellProps = { showCheckbox, mergeSelection, setMergeSelection, locationMap, sohMap };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full">
        <colgroup>
          {hasDrag && <col style={{ width: 32 }} />}
          {showCheckbox && <col style={{ width: 44 }} />}
          <col style={{ width: '14%' }} />{/* SKU */}
          <col />{/* Name */}
          <col style={{ width: 130 }} />{/* Category */}
          <col style={{ width: 160 }} />{/* Default Location */}
          <col style={{ width: 110 }} />{/* Cost */}
          <col style={{ width: 110 }} />{/* Price */}
          <col style={{ width: 70 }} />{/* UoM */}
          <col style={{ width: 110 }} />{/* On Hand */}
          <col style={{ width: 90 }} />{/* Inventory */}
        </colgroup>
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            {hasDrag && <th className="px-1.5 py-3"></th>}
            {showCheckbox && <th className="px-3 py-3"></th>}
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">SKU</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Name</th>
            <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Category</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Default Location</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Cost (ZAR)</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Price (ZAR)</th>
            <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">UoM</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">On Hand</th>
            <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Inventory</th>
          </tr>
        </thead>

        {grouped.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-muted-foreground">
                No products match your filters.
              </td>
            </tr>
          </tbody>
        ) : (
          grouped.map(({ name, items }, groupIdx) => (
            <GroupBody
              key={name}
              name={name}
              items={items}
              groupIdx={groupIdx}
              colSpan={colSpan}
              viewMode={viewMode}
              expanded={expanded}
              onToggle={onToggle}
              dndEnabled={dndEnabled}
              onNavigate={handleNavigate}
              cellProps={cellProps}
            />
          ))
        )}
      </table>

      {dndEnabled && (
        <div className="px-4 py-2 bg-muted/20 border-t border-border">
          <p className="text-[10px] text-muted-foreground">
            Drag a product by its handle and drop onto another subcategory to reclassify it.
          </p>
        </div>
      )}
    </div>
  );
}
