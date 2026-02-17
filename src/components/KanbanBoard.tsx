import { useMemo, useState } from 'react';
import type {
  DragCancelEvent,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { STATUS_ORDER, type Status } from '../types/board';
import { useBoardStore } from '../store/boardStore';
import { findCardStatus } from '../utils/board';
import { KanbanColumn } from './KanbanColumn';

const getStatusFromColumnId = (id: string): Status | null => {
  if (!id.startsWith('column:')) return null;
  const status = id.slice('column:'.length) as Status;
  return STATUS_ORDER.includes(status) ? status : null;
};

const DragPreview = ({ title }: { title: string }) => (
  <div className="w-[300px] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
    <p className="text-sm font-semibold text-gray-900">{title}</p>
  </div>
);

export function KanbanBoard() {
  const columns = useBoardStore((s) => s.columns);
  const cardsById = useBoardStore((s) => s.cardsById);
  const dragMove = useBoardStore((s) => s.dragMove);
  const finalizeMove = useBoardStore((s) => s.finalizeMove);

  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [startStatus, setStartStatus] = useState<Status | null>(null);
  const [startIndex, setStartIndex] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findStatus = (id: UniqueIdentifier): Status | null => {
    const raw = String(id);
    const viaColumn = getStatusFromColumnId(raw);
    if (viaColumn) return viaColumn;
    return findCardStatus(columns, raw);
  };

  const activeCard = useMemo(() => {
    if (!activeCardId) return null;
    return cardsById[activeCardId] ?? null;
  }, [activeCardId, cardsById]);

  const onDragStart = (event: DragStartEvent) => {
    const cardId = String(event.active.id);
    const status = findStatus(event.active.id);
    if (!status) return;

    setActiveCardId(cardId);
    setStartStatus(status);
    const idx = columns[status].indexOf(cardId);
    setStartIndex(idx >= 0 ? idx : null);
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const fromStatus = findStatus(active.id);
    const toStatus = findStatus(over.id);

    if (!fromStatus || !toStatus) return;

    const overId = String(over.id);
    let toIndex = columns[toStatus].length;

    if (!overId.startsWith('column:')) {
      const idx = columns[toStatus].indexOf(overId);
      toIndex = idx >= 0 ? idx : columns[toStatus].length;
    }

    dragMove(activeId, toStatus, toIndex);
  };

  const onDragEnd = (event: DragEndEvent) => {
  const cardId = String(event.active.id);
  const droppedOver = event.over ? findStatus(event.over.id) : null;

  if (!droppedOver && activeCardId && startStatus !== null && startIndex !== null) {
    // Drop außerhalb -> zurück an Startposition
    dragMove(activeCardId, startStatus, startIndex);
  } else if (startStatus) {
    finalizeMove(cardId, startStatus, 'Franz Kofler');
  }

  setActiveCardId(null);
  setStartStatus(null);
  setStartIndex(null);
};

  const onDragCancel = (_event: DragCancelEvent) => {
    if (activeCardId && startStatus !== null && startIndex !== null) {
      dragMove(activeCardId, startStatus, startIndex);
    }

    setActiveCardId(null);
    setStartStatus(null);
    setStartIndex(null);
  };

  return (
    <div className="mt-4 overflow-x-auto pb-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex min-w-max gap-4">
          {STATUS_ORDER.map((status) => (
            <KanbanColumn key={status} status={status} />
          ))}
        </div>

        <DragOverlay>{activeCard ? <DragPreview title={activeCard.title} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
