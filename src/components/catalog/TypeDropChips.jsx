import React from 'react';
import { Droppable } from '@hello-pangea/dnd';

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
 * Renders type chips — always mounted as Droppable to avoid mount/unmount
 * during drag lifecycle. Visual styling changes based on isDragging.
 */
export default function TypeDropChips({ typeCounts, currentTypeFilter, isDragging, isDropEnabled = true, onTypeClick }) {
  const types = Object.keys(typeCounts).sort((a, b) => (typeCounts[b] || 0) - (typeCounts[a] || 0));

  return (
    <div className="flex flex-wrap gap-2 items-start">
      {types.map(type => {
        const count = typeCounts[type] || 0;
        const isActive = currentTypeFilter === type;
        const showAsDropTarget = isDragging && isDropEnabled && type !== currentTypeFilter;

        // Only render as Droppable when inside a DragDropContext (isDropEnabled)
        if (isDropEnabled) {
          return (
            <Droppable key={type} droppableId={`type:${type}`} type="PRODUCT">
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  style={{ display: 'inline-block' }}
                >
                  <button
                    onClick={() => onTypeClick(type)}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${
                      showAsDropTarget
                        ? snapshot.isDraggingOver
                          ? TYPE_COLORS[type] + ' border-2 border-dashed ring-2 ring-primary scale-110 shadow-md'
                          : TYPE_COLORS[type] + ' border-2 border-dashed opacity-80 animate-pulse'
                        : isActive
                          ? (TYPE_COLORS[type]?.replace(/border-\S+/, '') || '') + ' ring-2 ring-primary/30'
                          : (TYPE_COLORS[type]?.replace(/border-\S+/, '') || '') + ' opacity-70 hover:opacity-100'
                    }`}
                  >
                    {showAsDropTarget && snapshot.isDraggingOver
                      ? `Drop → ${TYPE_LABELS[type] || type}`
                      : `${TYPE_LABELS[type] || type} (${count})`
                    }
                  </button>
                  <div style={{ display: 'none' }}>{provided.placeholder}</div>
                </div>
              )}
            </Droppable>
          );
        }

        // Plain chip when not inside a DragDropContext
        return (
          <button
            key={type}
            onClick={() => onTypeClick(type)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${
              isActive
                ? (TYPE_COLORS[type]?.replace(/border-\S+/, '') || '') + ' ring-2 ring-primary/30'
                : (TYPE_COLORS[type]?.replace(/border-\S+/, '') || '') + ' opacity-70 hover:opacity-100'
            }`}
          >
            {TYPE_LABELS[type] || type} ({count})
          </button>
        );
      })}
    </div>
  );
}