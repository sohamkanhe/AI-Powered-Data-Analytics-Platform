import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Database, FileText, Clock, CheckCircle2, Plus, X, Server, UploadCloud,
  ArrowLeft, File, Loader2, Trash2, Pencil 
} from "lucide-react";
import { Link } from "react-router-dom";

// --- TYPES ---
interface DataSourceItem {
  id: string;
  name: string;
  description?: string;
  type: string;
  rows: string;
  size: string;
  uploaded: string;
  status: string;
}

type ModalView = 'selection' | 'upload' | 'database' | 'edit';

const API_BASE_URL = "http://127.0.0.1:8000/api/v1"; 

export default function DataSources() {
  const queryClient = useQueryClient();
  
  // --- UI STATE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalView, setModalView] = useState<ModalView>('selection');
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // --- FORM STATE ---
  const [datasetName, setDatasetName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dbType, setDbType] = useState<"postgres_db" | "mysql_db">("postgres_db");
  const [connectionString, setConnectionString] = useState("");

  // --- QUERIES ---
  const { data: sources, isLoading } = useQuery<DataSourceItem[]>({
    queryKey: ["dataSources"],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/data`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch data sources");
      return res.json();
    },
  });

  // --- MUTATIONS ---
  const uploadMutation = useMutation({
    mutationFn: async (payload: { file?: File; metadata: any }) => {
      const formData = new FormData();
      if (payload.file) formData.append("file", payload.file);
      formData.append("metadata_json", JSON.stringify(payload.metadata));
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/upload`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: formData, 
      });
      if (!res.ok) throw new Error("Ingestion failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dataSources"] });
      handleCloseModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/data/${editingId}`, {
        method: "PATCH",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}` 
        },
        body: JSON.stringify({ dataset_name: datasetName, description: description }),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dataSources"] });
      handleCloseModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/data/${id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Deletion failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dataSources"] });
    },
  });

  // --- HANDLERS ---
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setTimeout(() => {
      setModalView('selection');
      setEditingId(null);
      setSelectedFile(null);
      setDatasetName("");
      setDescription("");
      setConnectionString("");
      setDbType("postgres_db");
      uploadMutation.reset();
      updateMutation.reset();
    }, 200);
  };

  const handleEditClick = (e: React.MouseEvent, source: DataSourceItem) => {
    e.preventDefault(); // Stop navigation
    setDatasetName(source.name);
    setDescription(source.description || "");
    setEditingId(source.id);
    setModalView('edit');
    setIsModalOpen(true);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault(); // Stop navigation
    if (window.confirm("Are you sure you want to delete this data source? This will also remove it from any connected workspaces.")) {
      deleteMutation.mutate(id);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setDatasetName(file.name.split('.').slice(0, -1).join('.'));
    }
  };

  const handleFileUploadSubmit = () => {
    if (!selectedFile) return;
    let sourceType = "csv";
    if (selectedFile.name.endsWith(".parquet")) sourceType = "parquet";
    if (selectedFile.name.endsWith(".xlsx")) sourceType = "excel";
    if (selectedFile.name.endsWith(".json")) sourceType = "json";

    uploadMutation.mutate({
      file: selectedFile,
      metadata: {
        dataset_name: datasetName || selectedFile.name.split('.')[0],
        description: description || null,
        source_type: sourceType,
      }
    });
  };

  const handleDbSubmit = () => {
    uploadMutation.mutate({
      metadata: {
        dataset_name: datasetName,
        description: description || null,
        source_type: dbType,
        connection_string: connectionString
      }
    });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white tracking-tight">Data Sources</h1>
        <p className="text-gray-400 mt-1">Connect databases or upload raw files to feed your analytical agents.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div 
          onClick={() => setIsModalOpen(true)}
          className="group relative flex flex-col items-center justify-center min-h-[220px] rounded-2xl border-2 border-dashed border-white/10 bg-white/5 hover:bg-white/[0.07] hover:border-blue-500/50 transition-all cursor-pointer overflow-hidden"
        >
          <div className="w-14 h-14 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:scale-110 group-hover:bg-blue-500/20 transition-all">
            <Plus className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-medium text-gray-200 mt-4">Add Data Source</h3>
        </div>

        {isLoading && (
          <div className="col-span-1 md:col-span-2 flex items-center justify-center min-h-[220px] bg-white/5 rounded-2xl border border-white/10">
             <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        )}

        {sources?.map((source) => (
          <Link to={`/datasources/${source.id}`} key={source.id} className="block group">
            <div className="relative bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6 hover:bg-white/5 hover:border-blue-500/30 transition-all shadow-lg flex flex-col justify-between min-h-[220px]">
              
              <div className="flex items-start justify-between">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
                  source.type.includes('DB') 
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                    : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                }`}>
                  {source.type.includes('DB') ? <Server className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                </div>
                
                {/* --- NEW: EDIT & DELETE ACTIONS --- */}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={(e) => handleEditClick(e, source)}
                    className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={(e) => handleDeleteClick(e, source.id)}
                    disabled={deleteMutation.isPending}
                    className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex-1">
                <h3 className="text-lg font-semibold text-gray-100 truncate pr-2">{source.name}</h3>
                <div className="flex items-center gap-2 mt-1.5 mb-2">
                  <span className="px-2 py-0.5 rounded bg-white/10 text-[11px] font-medium text-gray-300 uppercase tracking-wider border border-white/5">
                    {source.type}
                  </span>
                  <span className="text-sm text-gray-500">{source.rows} rows</span>
                </div>
                {source.description && (
                  <p className="text-[13px] text-gray-400 line-clamp-2 leading-relaxed">
                    {source.description}
                  </p>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-sm">
                <div className="flex items-center gap-1.5 text-gray-500">
                  <Clock className="w-3.5 h-3.5" /> {source.uploaded}
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-xs font-medium">{source.status}</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* --- MODAL OVERLAY --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-2xl bg-[#0A0A0A] border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-8 animate-in zoom-in-95 duration-200">
            
            <button 
              onClick={handleCloseModal}
              disabled={uploadMutation.isPending || updateMutation.isPending}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors z-10 disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>

            {/* SELECTION, UPLOAD, AND DATABASE VIEWS (UNCHANGED) */}
            {modalView === 'selection' && ( /* ... existing code ... */ 
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="mb-8">
                  <h2 className="text-2xl font-bold text-white">Add Data Source</h2>
                  <p className="text-gray-400 mt-1">Select how you want to bring data into the platform.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div onClick={() => setModalView('database')} className="group border border-white/10 bg-white/5 hover:bg-white/10 hover:border-emerald-500/50 rounded-xl p-6 cursor-pointer transition-all">
                    <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 mb-4 group-hover:scale-110 transition-transform">
                      <Database className="w-6 h-6" />
                    </div>
                    <h3 className="text-lg font-semibold text-white">Connect Database</h3>
                    <p className="text-sm text-gray-400 mt-2">Connect securely to Postgres or MySQL.</p>
                  </div>
                  <div onClick={() => setModalView('upload')} className="group border border-white/10 bg-white/5 hover:bg-white/10 hover:border-blue-500/50 rounded-xl p-6 cursor-pointer transition-all">
                    <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 mb-4 group-hover:scale-110 transition-transform">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <h3 className="text-lg font-semibold text-white">Upload File</h3>
                    <p className="text-sm text-gray-400 mt-2">Drop a CSV, Excel, JSON, or Parquet file.</p>
                  </div>
                </div>
              </div>
            )}
            {modalView === 'upload' && ( /* ... existing upload code ... */ 
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
              <button onClick={() => setModalView('selection')} disabled={uploadMutation.isPending} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 disabled:opacity-50">
                <ArrowLeft className="w-4 h-4" /> Back to options
              </button>
              
              <h2 className="text-2xl font-bold text-white mb-6">Upload File</h2>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Dataset Name *</label>
                  <input 
                    type="text" value={datasetName} onChange={(e) => setDatasetName(e.target.value)}
                    disabled={uploadMutation.isPending}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Description (Optional)</label>
                  <textarea 
                    rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder="Helps the AI agent understand the context of this data..."
                    disabled={uploadMutation.isPending}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              </div>

              <div className="relative group rounded-xl border-2 border-dashed border-white/10 bg-white/5 hover:bg-white/[0.07] hover:border-blue-500/50 transition-all p-8 text-center cursor-pointer overflow-hidden mb-6">
                <input type="file" accept=".csv, .xlsx, .parquet, .json" onChange={handleFileChange} disabled={uploadMutation.isPending} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" />
                {selectedFile ? (
                  <div className="relative z-10 flex flex-col items-center gap-2">
                    <div className="w-12 h-12 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
                      <File className="w-6 h-6" />
                    </div>
                    <span className="font-medium text-blue-400">{selectedFile.name}</span>
                  </div>
                ) : (
                  <div className="relative z-10 flex flex-col items-center gap-2">
                    <UploadCloud className="w-8 h-8 text-blue-400" />
                    <span className="text-gray-200 font-medium">Drag & drop to upload</span>
                    <span className="text-xs text-gray-500">.CSV, .XLSX, .JSON, or .PARQUET</span>
                  </div>
                )}
              </div>

              {uploadMutation.isError && (
                <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">{uploadMutation.error.message}</div>
              )}

              <div className="flex justify-end gap-3">
                <button onClick={handleCloseModal} disabled={uploadMutation.isPending} className="px-5 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5">Cancel</button>
                <button onClick={handleFileUploadSubmit} disabled={!selectedFile || !datasetName.trim() || uploadMutation.isPending} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
                  {uploadMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Upload Dataset
                </button>
              </div>
            </div>
            )}
            {modalView === 'database' && ( /* ... existing DB code ... */ 
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
              <button onClick={() => setModalView('selection')} disabled={uploadMutation.isPending} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 disabled:opacity-50">
                <ArrowLeft className="w-4 h-4" /> Back to options
              </button>
              
              <h2 className="text-2xl font-bold text-white mb-6">Connect Database</h2>

              <div className="space-y-4 mb-8">
                <div className="grid grid-cols-2 gap-4">
                  <div 
                    onClick={() => !uploadMutation.isPending && setDbType('postgres_db')} 
                    className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center gap-3 ${dbType === 'postgres_db' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                  >
                    <Database className="w-5 h-5" />
                    <span className="font-medium text-sm text-white">PostgreSQL</span>
                  </div>
                  <div 
                    onClick={() => !uploadMutation.isPending && setDbType('mysql_db')} 
                    className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center gap-3 ${dbType === 'mysql_db' ? 'bg-blue-500/10 border-blue-500 text-blue-400' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                  >
                    <Database className="w-5 h-5" />
                    <span className="font-medium text-sm text-white">MySQL</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Dataset Name *</label>
                  <input 
                    type="text" value={datasetName} onChange={(e) => setDatasetName(e.target.value)}
                    placeholder="e.g. Production Analytics DB"
                    disabled={uploadMutation.isPending}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Connection String *</label>
                  <input 
                    type="password" value={connectionString} onChange={(e) => setConnectionString(e.target.value)}
                    placeholder="postgresql://user:password@localhost:5432/dbname"
                    disabled={uploadMutation.isPending}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Description (Optional)</label>
                  <textarea 
                    rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
                    disabled={uploadMutation.isPending}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  />
                </div>
              </div>

              {uploadMutation.isError && (
                <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">{uploadMutation.error.message}</div>
              )}

              <div className="flex justify-end gap-3">
                <button onClick={handleCloseModal} disabled={uploadMutation.isPending} className="px-5 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5">Cancel</button>
                <button onClick={handleDbSubmit} disabled={!datasetName.trim() || !connectionString.trim() || uploadMutation.isPending} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
                  {uploadMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Connect Database
                </button>
              </div>
            </div>
            )}

            {/* --- NEW VIEW: EDIT --- */}
            {modalView === 'edit' && (
              <div className="animate-in fade-in duration-300">
                <h2 className="text-2xl font-bold text-white mb-6">Edit Data Source</h2>
                <div className="space-y-4 mb-8">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Dataset Name *</label>
                    <input 
                      type="text" value={datasetName} onChange={(e) => setDatasetName(e.target.value)}
                      disabled={updateMutation.isPending}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
                    <textarea 
                      rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
                      disabled={updateMutation.isPending}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </div>
                {updateMutation.isError && (
                  <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">{updateMutation.error.message}</div>
                )}
                <div className="flex justify-end gap-3">
                  <button onClick={handleCloseModal} disabled={updateMutation.isPending} className="px-5 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5">Cancel</button>
                  <button onClick={() => updateMutation.mutate()} disabled={!datasetName.trim() || updateMutation.isPending} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
                    {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save Changes
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}