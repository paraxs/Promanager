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
        const label =
          comment.timeLabel ??
          formatDistanceToNow(new Date(comment.createdAt), {
            addSuffix: true,
            locale: de,
          });

        return (
          <div key={comment.id} className="rounded-lg border border-gray-200 p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800">{comment.user}</span>
              <span className="text-xs text-gray-500">{label}</span>
            </div>
            <p className="text-sm text-gray-700">{comment.text}</p>
          </div>
        );
      })}
    </div>
  );
}
