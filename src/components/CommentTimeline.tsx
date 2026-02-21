import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import type { BoardComment } from '../types/board';

type Props = {
  comments: BoardComment[];
};

export function CommentTimeline({ comments }: Props) {
  if (comments.length === 0) {
    return <p className="text-sm text-gray-400">Noch keine Kommentare.</p>;
  }

  return (
    <div className="space-y-3">
      {[...comments].reverse().map((comment) => {
        const label = formatDistanceToNow(new Date(comment.createdAt), {
          addSuffix: true,
          locale: de,
        });

        return (
          <div key={comment.id} className="rounded-lg border border-slate-300 bg-slate-50 p-3 shadow-sm">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-white">
                {comment.user}
              </span>
              <span className="text-xs font-medium text-slate-600">{label}</span>
            </div>
            <p className="text-sm font-medium text-slate-900">{comment.text}</p>
          </div>
        );
      })}
    </div>
  );
}
