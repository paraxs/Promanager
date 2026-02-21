import { Plus } from 'lucide-react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { STATUS_UI } from '../config/ui';
import { APP_CONFIG } from '../config/appConfig';
import { useBoardStore } from '../store/boardStore';
import { useUiStore } from '../store/uiStore';
import type { Status } from '../types/board';
import { KanbanCard } from './KanbanCard';
import { cx } from '../utils/cx';
import { cardMatchesUiFilters } from '../utils/cardFilters';

type Props = {
  status: Status;
};

export function KanbanColumn({ status }: Props) {
  const cardIds = useBoardStore((s) => s.columns[status]);
  const cardsById = useBoardStore((s) => s.cardsById);
  const addCard = useBoardStore((s) => s.addCard);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const quickFilter = useUiStore((s) => s.quickFilter);

  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });
  const visibleCardIds = cardIds.filter((cardId) => {
    const card = cardsById[cardId];
    if (!card || card.hiddenAt) return false;
    return cardMatchesUiFilters(card, searchQuery, quickFilter);
  });

  return (
    <section className={cx('w-[88vw] max-w-[360px] shrink-0 snap-start rounded-xl border p-2.5 sm:w-[320px] sm:p-3', STATUS_UI[status].column)}>
      <div className="mb-3 flex items-center justify-between">
        <span className={cx('rounded-md px-2 py-1 text-sm font-semibold', STATUS_UI[status].chip)}>
          {status}
        </span>
        <span className="text-sm font-semibold text-gray-500">
          {visibleCardIds.length}
          {visibleCardIds.length !== cardIds.length ? <span className="text-xs font-normal text-gray-400"> / {cardIds.length}</span> : null}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={cx('min-h-[96px] space-y-3 rounded-lg sm:min-h-[120px]', isOver && 'ring-2 ring-blue-300')}
      >
        <SortableContext items={visibleCardIds} strategy={verticalListSortingStrategy}>
          {visibleCardIds.map((cardId) => (
            <KanbanCard key={cardId} cardId={cardId} />
          ))}
        </SortableContext>

        {visibleCardIds.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-400">
            {cardIds.length === 0 ? STATUS_UI[status].emptyText : 'Keine Treffer fuer den aktiven Filter.'}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => addCard(status)}
        className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
      >
        <Plus className="h-4 w-4" />
        {APP_CONFIG.defaults.newCardTitle}
      </button>
    </section>
  );
}
