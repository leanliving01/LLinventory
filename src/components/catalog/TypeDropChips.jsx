import React from 'react';

const TYPE_LABELS = {
  raw: 'Raw Material',
  packaging: 'Packaging',
  wip_bulk: 'Bulk Cooked',
  finished_meal: 'Finished Meal',
  supplement: 'Supplement',
  package: 'Package',
  sauce: 'Sauce',
  solo_serve: 'Solo Serve',
  bundle: 'Bundle',
  service: 'Service',
};

const TYPE_COLORS = {
  raw: 'bg-amber-100 text-amber-700 border-amber-300',
  packaging: 'bg-gray-100 text-gray-700 border-gray-300',
  wip_bulk: 'bg-orange-100 text-orange-700 border-orange-300',
  finished_meal: 'bg-green-100 text-green-700 border-green-300',
  supplement: 'bg-purple-100 text-purple-700 border-purple-300',
  package: 'bg-blue-100 text-blue-700 border-blue-300',
  sauce: 'bg-red-100 text-red-700 border-red-300',
  solo_serve: 'bg-pink-100 text-pink-700 border-pink-300',
  bundle: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  service: 'bg-slate-100 text-slate-700 border-slate-300',
};

/**
 * Type chips with manual hover detection for drag-and-drop.
 * Uses mouse events instead of Droppable to avoid closest-center issues.
 * 
 * Props:
 *   hoveredType / setHoveredType — lifted state from Catalog page so
 *   onDragEnd can read which chip the mouse was over when the drop happened.
 */
export default function TypeDropChips({ typeCounts, currentTypeFilter, isDragging, hoveredType, setHoveredType, onTypeClick }) {
  const types = Object.keys(typeCounts).sort((a, b) => (typeCounts[b] || 0) - (typeCounts[a] || 0));

  return (
    <div className="flex flex-wrap gap-2 items-start">
      {types.map(type => {
        const count = typeCounts[type] || 0;
        const isActive = currentTypeFilter === type;
        const isDropTarget = isDragging && type !== currentTypeFilter;
        const isHovered = hoveredType === type;

        return (
          <div
            key={type}
            className="relative"
            style={{ zIndex: isDragging ? 50 : 'auto' }}
            onMouseEnter={() => isDragging && isDropTarget && setHoveredType(type)}
            onMouseLeave={() => hoveredType === type && setHoveredType(null)}
          >
            <button
              onClick={() => onTypeClick(type)}
              className={`text-xs font-medium transition-all ${
                isDropTarget
                  ? isHovered
                    ? TYPE_COLORS[type] + ' px-4 py-2 rounded-lg border-2 border-dashed ring-2 ring-primary scale-110 shadow-md'
                    : TYPE_COLORS[type] + ' px-4 py-2 rounded-lg border-2 border-dashed opacity-80 animate-pulse'
                  : isActive
                    ? (TYPE_COLORS[type]?.replace(/border-\S+/, '') || '') + ' px-2.5 py-1 rounded-full ring-2 ring-primary/30'
                    : (TYPE_COLORS[type]?.replace(/border-\S+/, '') || '') + ' px-2.5 py-1 rounded-full opacity-70 hover:opacity-100'
              }`}
            >
              {isDropTarget && isHovered
                ? `Drop → ${TYPE_LABELS[type] || type}`
                : `${TYPE_LABELS[type] || type} (${count})`
              }
            </button>
          </div>
        );
      })}
    </div>
  );
}