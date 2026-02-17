import { Plus } from 'lucide-react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { STATUS_UI } from '../config/ui';
import { useBoardStore } from '../store/boardStore';
import type { Status } from '../types/board';
import { KanbanCard } from './KanbanCard';
import { cx } from '../utils/cx';

type Props = {
  status: Status;
};

export function KanbanColumn({ status }: Props) {
  const cardIds = useBoardStore((s) => s.columns[status]);
  const addCard = useBoardStore((s) => s.addCard);

  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });

  return (
    <section className={cx('w-[320px] shrink-0 rounded-xl border p-3', STATUS_UI[status].column)}>
      <div className="mb-3 flex items-center justify-between">
        <span className={cx('rounded-md px-2 py-1 text-sm font-semibold', STATUS_UI[status].chip)}>
          {status}
        </span>
        <span className="text-sm font-semibold text-gray-500">{cardIds.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={cx('min-h-[120px] space-y-3 rounded-lg', isOver && 'ring-2 ring-blue-300')}
      >
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cardIds.map((cardId) => (
            <KanbanCard key={cardId} cardId={cardId} />
          ))}
        </SortableContext>

        {cardIds.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-400">
            {STATUS_UI[status].emptyText}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => addCard(status)}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
      >
        <Plus className="h-4 w-4" />
        Neue Seite
      </button>
    </section>
  );
}
