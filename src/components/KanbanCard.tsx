import { memo } from 'react';
import { AlertTriangle, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, GripVertical, MessageSquare } from 'lucide-react';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { SOURCE_UI } from '../config/ui';
import { useBoardStore } from '../store/boardStore';
import { MoveCardMenu } from './MoveCardMenu';
import { cx } from '../utils/cx';
import { APP_CONFIG } from '../config/appConfig';
import { CARD_PROPERTY_IDS } from '../config/database';
import { getAppointmentBadge } from '../utils/scheduling';

type Props = {
  cardId: string;
};

const formatIsoDateForDisplay = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
};

const APPOINTMENT_BADGE_UI = {
  overdue: 'bg-red-100 text-red-800',
  today: 'bg-orange-100 text-orange-800',
  tomorrow: 'bg-amber-100 text-amber-800',
  soon: 'bg-blue-100 text-blue-800',
  planned: 'bg-gray-100 text-gray-700',
  invalid: 'bg-red-100 text-red-800',
} as const;

export const KanbanCard = memo(function KanbanCard({ cardId }: Props) {
  const card = useBoardStore((s) => s.cardsById[cardId]);
  const openCard = useBoardStore((s) => s.openCard);
  const updateCard = useBoardStore((s) => s.updateCard);
  const moveCardLeft = useBoardStore((s) => s.moveCardLeft);
  const moveCardRight = useBoardStore((s) => s.moveCardRight);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cardId,
  });

  if (!card) return null;

  const titleValue = card.values?.[CARD_PROPERTY_IDS.title];
  const dateValueRaw = card.values?.[CARD_PROPERTY_IDS.date];
  const title = typeof titleValue === 'string' ? titleValue : card.title;
  const dateValue = typeof dateValueRaw === 'string' || dateValueRaw === null ? dateValueRaw : card.date ?? null;

  const appointmentBadge = getAppointmentBadge(dateValue);
  const isCollapsed = card.collapsed ?? false;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cx('rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-3.5', isDragging && 'opacity-70 shadow-lg')}
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
      <div className={cx('flex items-start justify-between gap-2', isCollapsed ? 'mb-0' : 'mb-2')}>
        <h3 className="line-clamp-2 text-base leading-tight font-semibold text-gray-900">{title}</h3>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50"
            aria-label={isCollapsed ? 'Karte ausklappen' : 'Karte einklappen'}
            onClick={(e) => {
              e.stopPropagation();
              updateCard(cardId, { collapsed: !isCollapsed });
            }}
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>

          <button
            type="button"
            className="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50"
            aria-label="Karte ziehen"
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!isCollapsed ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {card.sources.map((source) => (
            <span
              key={`${card.id}-${source}`}
              className={cx('rounded-md px-2 py-0.5 text-xs font-medium', SOURCE_UI[source] ?? 'bg-gray-100 text-gray-700')}
            >
              {source}
            </span>
          ))}
        </div>
      ) : null}

      {isCollapsed && dateValue ? (
        <div className="mt-2 inline-flex items-center gap-1 text-xs text-gray-600">
          <CalendarClock className="h-3.5 w-3.5" />
          <span>{formatIsoDateForDisplay(dateValue)}</span>
        </div>
      ) : null}

      {!isCollapsed ? (
        <>
          {appointmentBadge ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span
                className={cx(
                  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold',
                  APPOINTMENT_BADGE_UI[appointmentBadge.tone],
                )}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {appointmentBadge.label}
              </span>

              {!appointmentBadge.isBusinessDay && !APP_CONFIG.scheduling.allowWeekendAppointments ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Wochenende
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="mb-3 flex items-center gap-1 text-sm text-gray-500">
            <MessageSquare className="h-4 w-4" />
            <span>{card.comments.length}</span>
          </div>

          <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => moveCardLeft(cardId, APP_CONFIG.defaults.actorName)}
                className="min-h-9 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                aria-label="Nach links"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => moveCardRight(cardId, APP_CONFIG.defaults.actorName)}
                className="min-h-9 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                aria-label="Nach rechts"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <MoveCardMenu cardId={cardId} currentStatus={card.status} />
          </div>
        </>
      ) : null}
    </article>
  );
});
