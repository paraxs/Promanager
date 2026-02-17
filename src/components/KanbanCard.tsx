import { memo } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, MessageSquare } from 'lucide-react';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { SOURCE_UI } from '../config/ui';
import { useBoardStore } from '../store/boardStore';
import { MoveCardMenu } from './MoveCardMenu';
import { cx } from '../utils/cx';

type Props = {
  cardId: string;
};

export const KanbanCard = memo(function KanbanCard({ cardId }: Props) {
  const card = useBoardStore((s) => s.cardsById[cardId]);
  const openCard = useBoardStore((s) => s.openCard);
  const moveCardLeft = useBoardStore((s) => s.moveCardLeft);
  const moveCardRight = useBoardStore((s) => s.moveCardRight);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cardId,
  });

  if (!card) return null;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cx(
        'rounded-xl border border-gray-200 bg-white p-3 shadow-sm',
        isDragging && 'opacity-70 shadow-lg',
      )}
      onClick={() => openCard(cardId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openCard(cardId);
        }
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-base leading-tight font-semibold text-gray-900">
          {card.title}
        </h3>

        <button
          type="button"
          className="rounded-md border border-gray-200 p-1 text-gray-500 hover:bg-gray-50"
          aria-label="Karte ziehen"
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {card.sources.map((source) => (
          <span
            key={`${card.id}-${source}`}
            className={cx('rounded-md px-2 py-0.5 text-xs font-medium', SOURCE_UI[source])}
          >
            {source}
          </span>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-1 text-sm text-gray-500">
        <MessageSquare className="h-4 w-4" />
        <span>{card.comments.length}</span>
      </div>

      <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => moveCardLeft(cardId, 'Franz Kofler')}
            className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            aria-label="Nach links"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => moveCardRight(cardId, 'Franz Kofler')}
            className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            aria-label="Nach rechts"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <MoveCardMenu cardId={cardId} currentStatus={card.status} />
      </div>
    </article>
  );
});
