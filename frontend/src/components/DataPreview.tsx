// src/components/DataPreview.tsx
import { useQuery } from '@tanstack/react-query';
import { datasetApi } from '../api/client';
import { X, Loader2, Table as TableIcon, Info } from 'lucide-react';

interface PreviewProps {
  datasetId: string;
  onClose: () => void;
}

export default function DataPreview({ datasetId, onClose }: PreviewProps) {
  const { data: response, isLoading, isError } = useQuery({
    queryKey: ['preview', datasetId],
    queryFn: () => datasetApi.getPreview(datasetId),
  });

  const preview = response?.data;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 md:p-8">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="p-4 border-b flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
              <TableIcon size={20} />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 leading-tight">
                {preview?.display_name || 'Dataset Preview'}
              </h2>
              <p className="text-xs text-slate-500">Showing first 50 rows • {preview?.total_rows || 0} total rows</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto bg-white">
          {isLoading ? (
            <div className="h-96 flex flex-col items-center justify-center gap-3">
              <Loader2 className="animate-spin text-blue-600" size={32} />
              <p className="text-sm text-slate-500">Loading stored records...</p>
            </div>
          ) : isError ? (
            <div className="h-96 flex items-center justify-center text-red-500 gap-2">
              <Info size={20} /> Failed to load preview data.
            </div>
          ) : (
            <div className="inline-block min-w-full align-middle">
              <table className="min-w-full border-separate border-spacing-0">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    {preview?.columns.map((col: string) => (
                      <th 
                        key={col} 
                        className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-r border-slate-200"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview?.data.map((row: any, i: number) => (
                    <tr key={i} className="hover:bg-blue-50/40 transition-colors">
                      {preview.columns.map((col: string) => (
                        <td key={col} className="px-4 py-2.5 text-sm text-slate-600 whitespace-nowrap border-r border-slate-100 last:border-r-0">
                          {row[col] === null ? (
                            <span className="text-slate-300 italic text-xs">null</span>
                          ) : (
                            String(row[col])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer / Schema Metadata Mini-view */}
        <div className="p-3 bg-slate-50 border-t flex justify-between items-center text-[10px] text-slate-400">
          <span>{datasetId}</span>
          <div className="flex gap-4">
            <span>COLUMNS: {preview?.columns.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}