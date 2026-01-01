/**
 * Column Config Button
 *
 * A dropdown button that allows users to:
 * - Toggle column visibility
 * - Drag and drop to reorder columns
 * - Reset to default configuration
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Columns, RotateCcw } from 'lucide-react';
import { DraggableColumnItem } from './DraggableColumnItem';
import type { TableColumnConfig } from '../../types';

interface ColumnConfigButtonProps {
  columns: Record<string, TableColumnConfig>;
  columnOrder: string[];
  visibleColumns: string[];
  onOrderChange: (newOrder: string[]) => void;
  onVisibilityChange: (columnId: string, visible: boolean) => void;
  onReset: () => void;
  defaultOrder: string[];
  defaultVisible: string[];
}

export const ColumnConfigButton: React.FC<ColumnConfigButtonProps> = ({
  columns,
  columnOrder,
  visibleColumns,
  onOrderChange,
  onVisibilityChange,
  onReset,
  defaultOrder,
  defaultVisible,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = columnOrder.indexOf(active.id as string);
      const newIndex = columnOrder.indexOf(over.id as string);
      const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
      onOrderChange(newOrder);
    }
  };

  const handleToggleVisibility = (columnId: string, visible: boolean) => {
    onVisibilityChange(columnId, visible);
  };

  const isDefault =
    JSON.stringify(columnOrder) === JSON.stringify(defaultOrder) &&
    JSON.stringify([...visibleColumns].sort()) === JSON.stringify([...defaultVisible].sort());

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          p-2 rounded-md transition-colors
          ${isOpen
            ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100'
            : 'text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300'
          }
        `}
        title="Configure columns"
        aria-label="Configure columns"
        aria-expanded={isOpen}
      >
        <Columns className="w-4 h-4" />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 shadow-lg z-50">
          <div className="p-2">
            <div className="text-xs font-medium text-sanctuary-500 uppercase tracking-wider px-2 py-1 mb-1">
              Columns
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={columnOrder}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-0.5">
                  {columnOrder.map((columnId) => {
                    const column = columns[columnId];
                    if (!column) return null;

                    return (
                      <DraggableColumnItem
                        key={columnId}
                        column={column}
                        isVisible={visibleColumns.includes(columnId)}
                        onToggle={handleToggleVisibility}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>

            {/* Reset Button */}
            <div className="mt-2 pt-2 border-t border-sanctuary-100 dark:border-sanctuary-800">
              <button
                onClick={() => {
                  onReset();
                }}
                disabled={isDefault}
                className={`
                  w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
                  transition-colors
                  ${isDefault
                    ? 'text-sanctuary-300 dark:text-sanctuary-600 cursor-not-allowed'
                    : 'text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'
                  }
                `}
              >
                <RotateCcw className="w-3 h-3" />
                Reset to Default
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
