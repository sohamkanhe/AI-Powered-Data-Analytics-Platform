import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { datasetApi } from '../api/client';
import { X, Database, Loader2, Table as TableIcon, ArrowRight, ChevronLeft } from 'lucide-react';
import { useMirrorTable } from '../hooks/useMirrorTable';

interface ConnectDbModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ConnectDbModal({ isOpen, onClose }: ConnectDbModalProps) {
  const [connectedSourceId, setConnectedSourceId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  // Reset state when closing
  const handleClose = () => {
    setConnectedSourceId(null);
    setName('');
    setUrl('');
    onClose();
  };

  const connectionMutation = useMutation({
    mutationFn: datasetApi.connectDb,
    onSuccess: (response) => {
      // Backend returns { source_id: "..." }
      setConnectedSourceId(response.data.source_id);
    },
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden transition-all">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
          <div className="flex items-center gap-2">
            {connectedSourceId && (
              <button 
                onClick={() => setConnectedSourceId(null)}
                className="p-1 hover:bg-slate-100 rounded-full mr-1 transition-colors"
              >
                <ChevronLeft size={20} className="text-slate-500" />
              </button>
            )}
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Database className="text-blue-600" size={20} /> 
              {connectedSourceId ? 'Select Table' : 'Connect Database'}
            </h2>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600">
            <X size={20}/>
          </button>
        </div>

        {/* Content Section */}
        {!connectedSourceId ? (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Source Name</label>
                <input 
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="e.g. Inventory MySQL"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Connection URL</label>
                <input 
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none font-mono text-xs transition-all"
                  placeholder="mysql://root:admin@localhost:3307/inventory_db"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <p className="mt-2 text-[10px] text-slate-400 leading-relaxed">
                  Ensure the database is accessible. For local Docker, use your machine's IP or <code className="bg-slate-100 px-1">host.docker.internal</code> if the backend is containerized.
                </p>
              </div>
            </div>

            <div className="p-6 bg-slate-50 flex gap-3">
              <button 
                onClick={handleClose}
                className="flex-1 py-2 text-slate-600 font-semibold hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => connectionMutation.mutate({ name, connection_url: url })}
                disabled={connectionMutation.isPending || !name || !url}
                className="flex-1 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-blue-300 transition-all flex items-center justify-center gap-2"
              >
                {connectionMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : 'Connect'}
              </button>
            </div>
          </div>
        ) : (
          <TablePickerView 
            sourceId={connectedSourceId} 
            onComplete={handleClose} 
          />
        )}
      </div>
    </div>
  );
}

/**
 * Sub-component to handle table discovery and mirroring
 */
function TablePickerView({ sourceId, onComplete }: { sourceId: string, onComplete: () => void }) {
  const mirrorMutation = useMirrorTable();
  
  const { data, isLoading, isError } = useQuery({
    queryKey: ['source-tables', sourceId],
    queryFn: () => datasetApi.getTables(sourceId),
    retry: 1
  });

  if (isLoading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="animate-spin text-blue-600" size={32} />
        <p className="text-sm text-slate-500 animate-pulse">Introspecting database schema...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500 text-sm font-medium">Failed to fetch tables. Please check your connection URL.</p>
      </div>
    );
  }

  const tables = data?.data?.tables || [];

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="p-6 max-h-[400px] overflow-y-auto space-y-2">
        {tables.length === 0 ? (
          <p className="text-center text-slate-500 py-8">No tables found in this database.</p>
        ) : (
          tables.map((table: string) => (
            <button
              key={table}
              onClick={() => mirrorMutation.mutate({ sourceId, tableName: table }, { onSuccess: onComplete })}
              disabled={mirrorMutation.isPending}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-blue-500 hover:bg-blue-50 transition-all group text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-100 rounded group-hover:bg-blue-100 transition-colors">
                  <TableIcon size={16} className="text-slate-500 group-hover:text-blue-600" />
                </div>
                <span className="font-medium text-slate-700 group-hover:text-blue-700">{table}</span>
              </div>
              {mirrorMutation.isPending ? (
                <Loader2 size={16} className="animate-spin text-blue-600" />
              ) : (
                <ArrowRight size={16} className="text-slate-300 group-hover:text-blue-500 transition-transform group-hover:translate-x-1" />
              )}
            </button>
          ))
        )}
      </div>
      <div className="p-4 bg-slate-50 text-center">
        <p className="text-[11px] text-slate-400">
          Select a table to begin the ingestion process.
        </p>
      </div>
    </div>
  );
}