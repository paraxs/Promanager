import { useRef } from 'react';
import { STATUS_ORDER, type Status } from '../types/board';
import { useBoardStore } from '../store/boardStore';
import { cx } from '../utils/cx';

type Props = {
  cardId: string;
  currentStatus: Status;
};

export function MoveCardMenu({ cardId, currentStatus }: Props) {
  const moveCardToStatus = useBoardStore((s) => s.moveCardToStatus);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const handleMove = (status: Status) => {
    moveCardToStatus(cardId, status, 'Franz Kofler');
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return (
    <details ref={detailsRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <summary className="list-none cursor-pointer rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
        In Spalte…
      </summary>

      <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => handleMove(status)}
            className={cx(
              'w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50',
              status === currentStatus ? 'font-semibold text-gray-900' : 'text-gray-700',
            )}
          >
            {status}
          </button>
        ))}
      </div>
    </details>
  );
}
