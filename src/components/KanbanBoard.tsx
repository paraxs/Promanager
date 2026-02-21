import { useMemo, useState } from 'react';
import type { DragEndEvent, DragOverEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core';
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
import { useUiStore } from '../store/uiStore';
import { findCardStatus } from '../utils/board';
import { KanbanColumn } from './KanbanColumn';
import { APP_CONFIG } from '../config/appConfig';

const getStatusFromColumnId = (id: string): Status | null => {
  if (!id.startsWith('column:')) return null;
  const status = id.slice('column:'.length) as Status;
  return STATUS_ORDER.includes(status) ? status : null;
};

const DragPreview = ({ title }: { title: string }) => (
  <div className="w-[260px] rounded-xl border border-gray-200 bg-white p-3 shadow-xl sm:w-[300px]">
    <p className="text-sm font-semibold text-gray-900">{title}</p>
  </div>
);

export function KanbanBoard() {
  const columns = useBoardStore((s) => s.columns);
  const cardsById = useBoardStore((s) => s.cardsById);
  const dragMove = useBoardStore((s) => s.dragMove);
  const finalizeMove = useBoardStore((s) => s.finalizeMove);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const quickFilter = useUiStore((s) => s.quickFilter);
  const dragDisabled = searchQuery.trim().length > 0 || quickFilter !== 'all';

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
    if (dragDisabled) return;
    const cardId = String(event.active.id);
    const status = findStatus(event.active.id);
    if (!status) return;

    setActiveCardId(cardId);
    setStartStatus(status);
    const idx = columns[status].indexOf(cardId);
    setStartIndex(idx >= 0 ? idx : null);
  };

  const onDragOver = (event: DragOverEvent) => {
    if (dragDisabled) return;
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
    if (dragDisabled) {
      setActiveCardId(null);
      setStartStatus(null);
      setStartIndex(null);
      return;
    }
    const cardId = String(event.active.id);
    const droppedOver = event.over ? findStatus(event.over.id) : null;

    if (!droppedOver && activeCardId && startStatus !== null && startIndex !== null) {
      dragMove(activeCardId, startStatus, startIndex);
    } else if (startStatus) {
      finalizeMove(cardId, startStatus, APP_CONFIG.defaults.actorName);
    }

    setActiveCardId(null);
    setStartStatus(null);
    setStartIndex(null);
  };

  const onDragCancel = () => {
    if (dragDisabled) {
      setActiveCardId(null);
      setStartStatus(null);
      setStartIndex(null);
      return;
    }
    if (activeCardId && startStatus !== null && startIndex !== null) {
      dragMove(activeCardId, startStatus, startIndex);
    }

    setActiveCardId(null);
    setStartStatus(null);
    setStartIndex(null);
  };

  return (
    <div className="mt-3 overflow-x-auto pb-3 sm:mt-4 sm:pb-2">
      {dragDisabled ? (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Drag & Drop ist waehrend aktiver Suche/Filter deaktiviert.
        </p>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex min-w-max snap-x snap-mandatory gap-3 sm:gap-4">
          {STATUS_ORDER.map((status) => (
            <KanbanColumn key={status} status={status} />
          ))}
        </div>

        <DragOverlay>{activeCard ? <DragPreview title={activeCard.title} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
