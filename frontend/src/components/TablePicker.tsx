import { useQuery } from '@tanstack/react-query';
import { datasetApi } from '../api/client';
import { useMirrorTable } from '../hooks/useMirrorTable';
import { Loader2, Table as TableIcon, ArrowRight } from 'lucide-react';

export default function TablePicker({ sourceId, onComplete }: { sourceId: string, onComplete: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['source-tables', sourceId],
    queryFn: () => datasetApi.getTables(sourceId),
  });

  const mirrorMutation = useMirrorTable();

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-blue-600" /></div>;

  return (
    <div className="p-6 space-y-4">
      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Select Table to Mirror</h3>
      <div className="grid gap-2">
        {data?.data.tables.map((table: string) => (
          <button
            key={table}
            onClick={() => mirrorMutation.mutate({ sourceId, tableName: table }, { onSuccess: onComplete })}
            disabled={mirrorMutation.isPending}
            className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition-all group text-left"
          >
            <div className="flex items-center gap-3">
              <TableIcon size={18} className="text-slate-400 group-hover:text-blue-500" />
              <span className="font-medium text-slate-700">{table}</span>
            </div>
            {mirrorMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} className="text-slate-300 group-hover:text-blue-500" />}
          </button>
        ))}
      </div>
    </div>
  );
}