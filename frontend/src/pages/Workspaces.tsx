import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"; 
import { 
  TerminalSquare, Plus, Database, ChevronRight, X, Loader2, CheckSquare, Square, Server, FileText, Trash2, Pencil
} from "lucide-react"; 

const API_BASE_URL = "http://127.0.0.1:8000/api/v1";

interface WorkspaceItem {
  id: string;
  name: string;
  description?: string;
  source_count: number;
  sources: { id: string; name: string; type: string }[];
  created_at: string;
}

interface DataSourceItem {
  id: string;
  name: string;
  type: string;
}

export default function Workspaces() {
  const queryClient = useQueryClient();
  
  // --- UI STATE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // --- FORM STATE ---
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());

  // --- QUERIES ---
  const { data: workspaces, isLoading: isLoadingWS } = useQuery<WorkspaceItem[]>({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE_URL}/workspaces`, { headers: { "Authorization": `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to fetch workspaces");
      return res.json();
    },
  });

  const { data: sources, isLoading: isLoadingSources } = useQuery<DataSourceItem[]>({
    queryKey: ["dataSources"],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/data`, { headers: { "Authorization": `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to fetch data sources");
      return res.json();
    },
    enabled: isModalOpen,
  });

  // --- MUTATIONS ---
  const createMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          name: workspaceName,
          description: workspaceDescription || null,
          source_ids: Array.from(selectedSourceIds)
        }),
      });
      if (!res.ok) throw new Error("Creation failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      closeModal();
    }
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/workspaces/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          name: workspaceName,
          description: workspaceDescription || null,
          source_ids: Array.from(selectedSourceIds)
        }),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      closeModal();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/workspaces/${id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Deletion failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    }
  });

  // --- HANDLERS ---
  const handleEditClick = (e: React.MouseEvent, ws: WorkspaceItem) => {
    e.preventDefault(); // Stop routing
    setEditingId(ws.id);
    setWorkspaceName(ws.name);
    setWorkspaceDescription(ws.description || "");
    setSelectedSourceIds(new Set(ws.sources.map(s => s.id)));
    setIsModalOpen(true);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault(); // Stop routing
    if (window.confirm("Are you sure you want to delete this workspace? Your data sources will not be deleted.")) {
      deleteMutation.mutate(id);
    }
  };

  const toggleSource = (id: string) => {
    const next = new Set(selectedSourceIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSourceIds(next);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setTimeout(() => {
      setEditingId(null);
      setWorkspaceName("");
      setWorkspaceDescription("");
      setSelectedSourceIds(new Set());
      createMutation.reset();
      updateMutation.reset();
    }, 200);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      
      {/* Header & CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Workspaces</h1>
          <p className="text-gray-400 mt-1">Combine multiple datasets into isolated analytical environments.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg shadow-[0_0_15px_rgba(59,130,246,0.4)] transition-all hover:scale-105"
        >
          <Plus className="w-5 h-5" />
          New Workspace
        </button>
      </div>

      {/* Workspaces Grid */}
      {isLoadingWS ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {workspaces?.map((ws) => (
            <Link to={`/workspaces/${ws.id}`} key={ws.id} className="block group">
              <div className="relative bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6 hover:bg-white/5 hover:border-blue-500/30 transition-all cursor-pointer overflow-hidden shadow-lg hover:shadow-[0_0_30px_rgba(59,130,246,0.15)] h-full flex flex-col">
                
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-violet-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                    <TerminalSquare className="w-5 h-5" />
                  </div> 
                  
                  {/* --- NEW: EDIT & DELETE ACTIONS --- */}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={(e) => handleEditClick(e, ws)}
                      className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => handleDeleteClick(e, ws.id)}
                      disabled={deleteMutation.isPending}
                      className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <h3 className="text-lg font-semibold text-gray-100 group-hover:text-blue-400 transition-colors truncate pr-2">
                  {ws.name}
                </h3>
                {ws.description ? (
                  <p className="text-[13px] text-gray-400 line-clamp-2 leading-relaxed mt-2 mb-5">
                    {ws.description}
                  </p>
                ) : (
                  <p className="text-[13px] text-gray-500 italic mt-2 mb-5">No description provided.</p>
                )}

                <div className="space-y-2.5 mt-auto">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    <Database className="w-3.5 h-3.5" />
                    {ws.source_count} Connected {ws.source_count === 1 ? 'Source' : 'Sources'}
                  </div>
                  
                  {ws.sources && ws.sources.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {ws.sources.slice(0, 3).map(src => (
                        <span 
                          key={src.id} 
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1a1a1a] border border-white/10 text-[11px] text-gray-300 shadow-sm"
                        >
                          <span className={src.type.includes('DB') ? 'text-emerald-400' : 'text-blue-400'}>
                            {src.type.includes('DB') ? <Server className="w-3 h-3"/> : <FileText className="w-3 h-3"/>}
                          </span>
                          <span className="truncate max-w-[110px]">{src.name}</span>
                        </span>
                      ))}
                      {ws.sources.length > 3 && (
                        <span className="px-2 py-1 rounded bg-transparent border border-dashed border-white/20 text-[11px] text-gray-500">
                          +{ws.sources.length - 3} more
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="px-3 py-2 border border-dashed border-white/10 rounded-lg text-xs text-gray-500 text-center">
                      No data sources attached yet.
                    </div>
                  )}
                </div>

                <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-400 group-hover:text-gray-200 transition-colors">
                    Open Workspace
                  </span>
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-blue-500/20 group-hover:text-blue-400 transition-all">
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
          {/* ... (keep empty state unchanged) ... */}
        </div>
      )}

      {/* --- CREATE/EDIT WORKSPACE MODAL --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-xl bg-[#0A0A0A] border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-8 animate-in zoom-in-95 duration-200">
            
            <button onClick={closeModal} disabled={isSaving} className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-2xl font-bold text-white mb-6">
              {editingId ? "Edit Workspace" : "New Workspace"}
            </h2>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Workspace Name *</label>
                <input 
                  type="text" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)}
                  disabled={isSaving}
                  placeholder="e.g., Cross-Platform User Analytics"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
                <textarea 
                  rows={2} value={workspaceDescription} onChange={(e) => setWorkspaceDescription(e.target.value)}
                  disabled={isSaving}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Include Data Sources</label>
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                  {isLoadingSources ? (
                    <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>
                  ) : sources?.length === 0 ? (
                    <div className="p-4 text-sm text-gray-500 text-center">No data sources available. Add some in the Data Sources tab first.</div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {sources?.map((source) => (
                        <div 
                          key={source.id} 
                          onClick={() => !isSaving && toggleSource(source.id)}
                          className={`flex items-center gap-3 p-3 transition-colors ${isSaving ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/5 cursor-pointer'}`}
                        >
                          <div className="text-blue-500">
                            {selectedSourceIds.has(source.id) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-gray-600" />}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-200">{source.name}</p>
                            <p className="text-xs text-gray-500 uppercase tracking-wider">{source.type}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Error states */}
              {(createMutation.isError || updateMutation.isError) && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                  {createMutation.error?.message || updateMutation.error?.message}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button onClick={closeModal} disabled={isSaving} className="px-5 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5">
                  Cancel
                </button>
                <button 
                  onClick={() => editingId ? updateMutation.mutate() : createMutation.mutate()}
                  disabled={!workspaceName.trim() || selectedSourceIds.size === 0 || isSaving}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                >
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingId ? "Save Changes" : "Create Workspace"}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}