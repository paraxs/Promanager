import type { ChangeEvent } from 'react';
import { useRef } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { useBoardStore } from '../store/boardStore';

export function BoardHeader() {
  const exportState = useBoardStore((s) => s.exportState);
  const importState = useBoardStore((s) => s.importState);
  const resetDemoData = useBoardStore((s) => s.resetDemoData);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const data = exportState();
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `kanban-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();

    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      importState(text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Import fehlgeschlagen.';
      alert(msg);
    } finally {
      event.target.value = '';
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-3 px-6 py-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-gray-900">Projekte Firma 2026</h1>
          <p className="mt-1 text-sm text-gray-500">Service Management Dashboard</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-4 w-4" />
            Export JSON
          </button>

          <button
            type="button"
            onClick={handleImportClick}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Upload className="h-4 w-4" />
            Import JSON
          </button>

          <button
            type="button"
            onClick={resetDemoData}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RotateCcw className="h-4 w-4" />
            Demo zurücksetzen
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>
    </header>
  );
}
