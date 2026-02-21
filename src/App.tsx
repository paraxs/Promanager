import { BoardHeader } from './components/BoardHeader';
import { KanbanBoard } from './components/KanbanBoard';
import { BoardTable } from './components/BoardTable';
import { CardDetailDrawer } from './components/CardDetailDrawer';
import { RuntimeErrorBoundary } from './components/RuntimeErrorBoundary';
import { useUiStore } from './store/uiStore';

export default function App() {
  const viewMode = useUiStore((s) => s.viewMode);

  return (
    <RuntimeErrorBoundary>
      <div className="min-h-screen bg-white text-gray-900">
        <BoardHeader />
        <main className="px-3 pb-4 sm:px-6 sm:pb-6">
          {viewMode === 'table' ? <BoardTable /> : <KanbanBoard />}
        </main>
        <CardDetailDrawer />
      </div>
    </RuntimeErrorBoundary>
  );
}
