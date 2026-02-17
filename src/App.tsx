import { BoardHeader } from './components/BoardHeader';
import { KanbanBoard } from './components/KanbanBoard';
import { CardDetailDrawer } from './components/CardDetailDrawer';

export default function App() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <BoardHeader />
      <main className="px-6 pb-6">
        <KanbanBoard />
      </main>
      <CardDetailDrawer />
    </div>
  );
}
