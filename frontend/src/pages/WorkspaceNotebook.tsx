import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Play, Square, Plus, Trash2, ChevronUp, ChevronDown,
  ArrowLeft, Loader2, Database, FileText,
  AlignLeft, LayoutDashboard, TerminalSquare,
  Pin, Code, Copy, RotateCcw, Layers, GitMerge,
  Table2, ChevronRight, ChevronLeft, ArrowDown, ArrowUp,
  Maximize2, Minimize2, BarChart3, Search,
  GripVertical, Lock, Unlock
} from "lucide-react";
import VegaChart from "../components/VegaChart";
import type { ChartUIBlock } from "../components/VegaChart";
import GridLayout from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Tab = "notebook" | "explorer" | "dashboard";
type CellType = "code" | "markdown";
type CellStatus = "idle" | "running" | "done" | "error";

type ChartBlockDef = {
  type: "chart";
  spec: any;
  data: any[];
  row_count: number;
  explanation?: string;   // ← self-contained: set by backend
  query?: string;         // ← self-contained: set by backend
};

type UIBlock =
  | { type: "markdown"; content: string }
  | { type: "code"; language: string; content: string }
  | { type: "table"; columns: string[]; data: any[]; warning?: string | null }
  | ChartBlockDef;

type Cell = {
  id: string;
  type: CellType;
  input: string;
  execCount: number | null;
  status: CellStatus;
  blocks: UIBlock[];
  isEditing: boolean;
  collapsed: boolean;
};

type WorkspaceSource = {
  id: string;
  name: string;
  type: string;
  artifact_url: string | null;
  description: string | null;
};

type WorkspaceDetail = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  sources: WorkspaceSource[];
};

// Dashboard Pin Type
type PinnedItem = {
  id: string;
  title: string;
  explanation: string;
  query: string;
  chartBlock: ChartBlockDef;
  datePinned: string;  // ISO string from DB
};

const API_BASE = "http://127.0.0.1:8000/api/v1";
let globalExecCounter = 1;

function makeCell(type: CellType = "code"): Cell {
  return {
    id: crypto.randomUUID(),
    type,
    input: "",
    execCount: null,
    status: "idle",
    blocks: [],
    isEditing: type === "markdown",
    collapsed: false,
  };
}

// ─── SHARED UI COMPONENTS ─────────────────────────────────────────────────────

function MdRender({ content }: { content: string }) {
  // Render fenced code blocks separately, then handle inline markdown
  const segments: Array<{ type: 'html' | 'code'; content: string; lang?: string }> = [];
  const fenceRe = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = fenceRe.exec(content)) !== null) {
    if (m.index > last) segments.push({ type: 'html', content: content.slice(last, m.index) });
    segments.push({ type: 'code', lang: m[1] || 'text', content: m[2] });
    last = m.index + m[0].length;
  }
  if (last < content.length) segments.push({ type: 'html', content: content.slice(last) });

  function renderInlineHtml(text: string): string {
    return text
      .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-white mt-4 mb-1">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-white mt-4 mb-1">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-xl font-extrabold text-white mt-4 mb-2">$1</h1>')
      .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-gray-300">$1</li>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[12px] text-emerald-300">$1</code>')
      .replace(/^(?!<[hlisco]).+$/gm, (line) => line.trim() ? `<p class="text-gray-300">${line}</p>` : '<br />')
      .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (lis) => `<ul class="space-y-1 my-1">${lis}</ul>`);
  }

  return (
    <div className="text-[13.5px] leading-relaxed select-text">
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <div key={i} className="relative my-2 rounded-lg border border-white/10 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.04] border-b border-white/10">
              <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">{seg.lang}</span>
              <button
                onClick={() => navigator.clipboard.writeText(seg.content)}
                className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
            <pre className="px-4 py-3 text-[12.5px] font-mono text-emerald-400/90 overflow-x-auto leading-5 bg-black/20 whitespace-pre">
              <code>{seg.content}</code>
            </pre>
          </div>
        ) : (
          <div
            key={i}
            className="prose-invert space-y-1 [&_details]:border [&_details]:border-white/10 [&_details]:rounded [&_details]:px-3 [&_details]:py-2 [&_details]:my-2 [&_details]:cursor-pointer [&_summary]:text-blue-400 [&_summary]:font-medium [&_summary]:text-[12px] [&_summary]:select-none"
            dangerouslySetInnerHTML={{ __html: renderInlineHtml(seg.content) }}
          />
        )
      )}
    </div>
  );
}


function TableBlock({ block }: { block: Extract<UIBlock, { type: "table" }> }) {
  return (
    <div className="overflow-x-auto">
      {block.warning && (
        <div className="mx-3 mt-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-400 font-mono">
          ⚠ {block.warning}
        </div>
      )}
      <table className="w-full text-left text-[12.5px] font-mono">
        <thead>
          <tr className="border-b border-white/10">
            <th className="w-10 px-3 py-2.5 text-gray-600 text-right text-[11px]">#</th>
            {block.columns.map(c => <th key={c} className="px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {block.data.map((row, i) => (
            <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
              <td className="px-3 py-2 text-gray-600 text-right text-[11px]">{i}</td>
              {block.columns.map(c => (
                <td key={c} className="px-3 py-2 whitespace-nowrap text-gray-300">
                  {row[c] !== null && row[c] !== undefined ? String(row[c]) : <span className="text-gray-600 italic">NaN</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[11px] text-gray-600 font-mono border-t border-white/[0.04]">
        {block.data.length} rows × {block.columns.length} columns
      </div>
    </div>
  );
}


function isDbSource(type: string) { return ["postgresql", "postgres", "mysql", "sqlite"].includes(type.toLowerCase()); }

function sourceColor(type: string) {
  const t = type.toLowerCase();
  if (["postgresql", "postgres"].includes(t)) return "text-blue-400 bg-blue-500/10 border-blue-500/20";
  if (t === "mysql") return "text-orange-400 bg-orange-500/10 border-orange-500/20";
  if (t === "sqlite") return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
  return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
}

// ─── NOTEBOOK CELL ────────────────────────────────────────────────────────────
function NotebookCell({
  cell, index, total, sourceNames, onUpdate, onRun, onDelete, onMove, onAddBelow, isKernelBusy, onPin
}: {
  cell: Cell; index: number; total: number; sourceNames: string[];
  onUpdate: (id: string, patch: Partial<Cell>) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onAddBelow: (id: string, type: CellType) => void;
  isKernelBusy: boolean;
  onPin: (chartBlock: ChartBlockDef) => void; // ← simplified: block is self-contained
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const isRunning = cell.status === "running";
  const hasOutput = cell.blocks.length > 0;

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 52)}px`;
  }, [cell.input]);

  const placeholder = sourceNames.length > 1
    ? `# Query across: ${sourceNames.slice(0, 2).join(", ")}${sourceNames.length > 2 ? ` (+${sourceNames.length - 2} more)` : ""}...`
    : "# Write a query or question...";

  // Chart block is now self-contained — just forward it directly.
  const handlePinClick = (chartIdx: number) => {
    const chartBlock = cell.blocks[chartIdx] as ChartBlockDef;
    onPin(chartBlock);
  };

  return (
    <div className="relative group/cell">
      <div className={`flex items-start transition-all duration-150 ${focused ? "opacity-100" : "opacity-90 hover:opacity-100"}`}>
        <div className="flex flex-col items-end shrink-0 w-[52px] pt-[6px] pr-1">
          <button
            onClick={() => onRun(cell.id)} disabled={isKernelBusy && !isRunning}
            className={`w-7 h-7 flex items-center justify-center rounded transition-all ${isRunning ? "text-amber-400" : focused ? "text-blue-400 hover:bg-blue-500/10" : "text-gray-600 hover:text-gray-400"}`}
          >
            {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          </button>
          <span className="font-mono text-[11px] text-gray-600 mt-0.5 select-none">{isRunning ? <span className="text-amber-400 animate-pulse">*</span> : cell.execCount ?? ""}</span>
        </div>

        <div className={`flex-1 min-w-0 rounded-[4px] border transition-all duration-100 ${focused ? cell.type === "code" ? "border-blue-500/60 bg-[#1a1a1a] shadow-[0_0_0_1px_rgba(59,130,246,0.15)]" : "border-violet-500/50 bg-[#1a1a1a]" : "border-white/[0.07] bg-[#161616] hover:border-white/[0.12]"
          }`}>
          {focused && (
            <div className="absolute -top-0 left-[60px] z-10">
              <span className={`text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-t ${cell.type === "code" ? "text-blue-400/70" : "text-violet-400/70"}`}>
                {cell.type === "code" ? "⬡ code" : "⬡ markdown"}
              </span>
            </div>
          )}

          {cell.type === "code" ? (
            <textarea
              ref={textareaRef} value={cell.input} onChange={e => onUpdate(cell.id, { input: e.target.value })}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              onKeyDown={e => { if ((e.shiftKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onRun(cell.id); } }}
              spellCheck={false} placeholder={placeholder}
              className="w-full bg-transparent text-[13px] font-mono text-[#d4d4d4] leading-6 px-4 py-3 focus:outline-none resize-none placeholder-gray-700 caret-blue-400"
              style={{ minHeight: "52px" }}
            />
          ) : cell.isEditing ? (
            <div>
              <textarea
                autoFocus value={cell.input} onChange={e => onUpdate(cell.id, { input: e.target.value })}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                onKeyDown={e => {
                  if (e.key === "Escape") { onUpdate(cell.id, { isEditing: false }); setFocused(false); }
                  if ((e.shiftKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onRun(cell.id); }
                }}
                placeholder="Write markdown notes..."
                className="w-full bg-transparent text-[13px] text-gray-300 leading-6 px-4 py-3 focus:outline-none resize-none placeholder-gray-700 caret-violet-400 font-sans"
                style={{ minHeight: "52px" }}
              />
              <div className="flex justify-end gap-2 px-3 pb-2">
                <button onClick={() => { onRun(cell.id); setFocused(false); }} className="px-3 py-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded transition-colors">
                  Render (Shift+Enter)
                </button>
              </div>
            </div>
          ) : (
            <div className="px-5 py-4 cursor-text" onDoubleClick={() => { onUpdate(cell.id, { isEditing: true }); setFocused(true); }} onClick={() => setFocused(true)}>
              {cell.input ? <MdRender content={cell.input} /> : <span className="text-gray-600 italic text-[13px]">Double-click to edit markdown...</span>}
            </div>
          )}

          {(hasOutput || isRunning) && (
            <div className="border-t border-white/[0.06]">
              {cell.blocks.map((block, idx) => (
                <div key={idx} className="relative group/block">
                  {block.type === "code" && (
                    <div>
                      <div className="flex items-center justify-between px-4 py-1.5 bg-white/[0.02] border-b border-white/[0.04]">
                        <span className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">{block.language}</span>
                        <button onClick={() => navigator.clipboard.writeText(block.content)} className="p-1 text-gray-600 hover:text-gray-400 transition-colors"><Copy className="w-3 h-3" /></button>
                      </div>
                      <pre className="px-4 py-3 text-[12.5px] font-mono text-emerald-400/90 overflow-x-auto leading-5 bg-black/20"><code>{block.content}</code></pre>
                    </div>
                  )}
                  {block.type === "table" && <TableBlock block={block} />}
                  {block.type === "markdown" && <div className="px-4 py-3"><MdRender content={block.content} /></div>}
                  {block.type === "chart" && (
                    <div className="relative">
                      <VegaChart block={block as unknown as ChartUIBlock} />
                      <button
                        onClick={() => handlePinClick(idx)}
                        className="absolute top-2 right-4 p-1.5 bg-[#222] text-gray-400 hover:text-blue-400 hover:bg-[#333] rounded border border-white/10 opacity-0 group-hover/block:opacity-100 transition-all shadow-lg flex items-center gap-1.5 text-[10px] font-medium"
                        title="Pin to Dashboard"
                      >
                        <Pin className="w-3.5 h-3.5" /> Pin
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {isRunning && (
                <div className="flex items-center gap-2.5 px-4 py-3 text-[12px] text-gray-500 font-mono">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" /><span>Running agent across {sourceNames.length} source{sourceNames.length !== 1 ? "s" : ""}...</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`flex flex-col items-center gap-1 pl-1.5 pt-1 transition-opacity ${focused ? "opacity-100" : "opacity-0 group-hover/cell:opacity-100"}`}>
          <button onClick={() => onMove(cell.id, "up")} disabled={index === 0} className="p-1 text-gray-600 hover:text-gray-300 disabled:opacity-20 transition-colors"><ChevronUp className="w-3.5 h-3.5" /></button>
          <button onClick={() => onMove(cell.id, "down")} disabled={index === total - 1} className="p-1 text-gray-600 hover:text-gray-300 disabled:opacity-20 transition-colors"><ChevronDown className="w-3.5 h-3.5" /></button>
          <button onClick={() => onDelete(cell.id)} className="p-1 text-gray-600 hover:text-red-400 transition-colors mt-1"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <div className="h-3 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity my-0.5">
        <div className="flex items-center gap-1 bg-[#1a1a1a] border border-white/10 rounded-full px-2 py-0.5 shadow-lg">
          <button onClick={() => onAddBelow(cell.id, "code")} className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-gray-400 hover:text-blue-400 font-mono transition-colors"><Code className="w-2.5 h-2.5" /> + Code</button>
          <div className="w-px h-3 bg-white/10" />
          <button onClick={() => onAddBelow(cell.id, "markdown")} className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-gray-400 hover:text-violet-400 font-mono transition-colors"><AlignLeft className="w-2.5 h-2.5" /> + Markdown</button>
        </div>
      </div>
    </div>
  );
}


// ─── INTERACTIVE DATA GRID COMPONENT ──────────────────────────────────────────
// Note: We now require sourceId. We guard against undefined in the useQuery.
function InteractiveDataGrid({
  sourceId,
  sourceType,
  tableName = null
}: {
  sourceId?: string,
  sourceType?: string,
  tableName?: string | null
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);

  const { data: tableData, isLoading, isFetching, error } = useQuery({
    queryKey: ['tableData', sourceId, tableName, page, pageSize, sortCol, sortDesc],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/data/${sourceId}/explore/table`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          table_name: tableName, limit: pageSize, offset: page * pageSize,
          sort_column: sortCol, sort_desc: sortDesc
        })
      });
      if (!res.ok) throw new Error("Failed to fetch table data");
      return res.json();
    },
    placeholderData: (prev) => prev,
    // THE FIX: Do not run this query if sourceId is undefined or missing
    enabled: !!sourceId && sourceId !== 'undefined',
  });

  const handleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDesc) { setSortCol(null); setSortDesc(false); }
      else { setSortDesc(true); }
    } else {
      setSortCol(col); setSortDesc(false);
    }
    setPage(0);
  };

  if (!sourceId) return <div className="p-4 text-gray-500">Please select a dataset to view data.</div>;
  if (isLoading && !tableData) return <div className="h-64 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>;
  if (error) return <div className="p-4 text-red-400 bg-red-500/10 border border-red-500/20 rounded">Failed to load data. {error.message}</div>;
  if (!tableData) return <div className="p-4 text-gray-500">No data available.</div>;

  const totalPages = Math.ceil(tableData.total_rows / pageSize);

  return (
    <div className="flex flex-col flex-1 min-h-0 border border-white/[0.07] rounded-lg bg-[#111111] overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#161616] border-b border-white/[0.07] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-gray-400">
            {tableData.total_rows.toLocaleString()} rows
          </span>
          {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
        </div>

        <div className="flex items-center gap-4 text-sm font-mono text-gray-400">
          <span>Rows/page:
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}
              className="ml-2 bg-[#222] border border-white/10 rounded px-1 py-0.5 text-white outline-none cursor-pointer"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={500}>500</option>
            </select>
          </span>

          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>{page + 1} / {totalPages || 1}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar relative bg-[#111111]">
        <table className="w-full text-left text-[12.5px] font-mono border-collapse whitespace-nowrap">
          <thead className="sticky top-0 z-10 shadow-md">
            <tr>
              <th className="px-4 py-2.5 bg-[#1a1a1a] border-b border-r border-white/5 text-gray-500 font-medium w-12 text-center select-none">#</th>
              {tableData.columns.map((col: string) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className="px-4 py-2.5 bg-[#1a1a1a] border-b border-r border-white/5 text-gray-300 font-medium select-none hover:bg-[#252525] cursor-pointer transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2">
                    {col}
                    <span className="text-gray-600">
                      {sortCol === col ? (
                        sortDesc ? <ArrowDown className="w-3 h-3 text-blue-400" /> : <ArrowUp className="w-3 h-3 text-blue-400" />
                      ) : (
                        <ArrowUp className="w-3 h-3 opacity-0 group-hover:opacity-30" />
                      )}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={`divide-y divide-white/[0.04] ${isFetching ? 'opacity-50' : 'opacity-100'} transition-opacity`}>
            {tableData.data.map((row: any, i: number) => (
              <tr key={i} className="hover:bg-white/[0.03] transition-colors group">
                <td className="px-4 py-2 bg-[#161616] border-r border-white/5 text-gray-600 text-center select-none group-hover:text-gray-400">
                  {page * pageSize + i + 1}
                </td>
                {tableData.columns.map((col: string) => (
                  <td key={col} className="px-4 py-2 border-r border-white/5 text-gray-400 max-w-[300px] truncate hover:text-gray-200 hover:max-w-none transition-all">
                    {row[col] !== null ? String(row[col]) : <span className="text-gray-700 italic">null</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── PANEL ACCENT COLORS ──────────────────────────────────────────────────────
const PANEL_ACCENTS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#f59e0b",
  "#ef4444", "#06b6d4", "#ec4899", "#84cc16",
];

// How many px tall a grid row is (keep in sync with ROW_HEIGHT below)
const ROW_HEIGHT = 60;
const MARGIN: [number, number] = [12, 12];
const COLS = 12;

function panelToPx(h: number) {
  // react-grid-layout v1: total height = h * rowHeight + (h-1) * margin[1]
  return h * ROW_HEIGHT + (h - 1) * MARGIN[1];
}

// ─── DASHBOARD GRID ───────────────────────────────────────────────────────────
function DashboardGrid({
  pinnedItems, isPinsLoading, workspaceId, onRemovePin, onExpandPin,
}: {
  pinnedItems: PinnedItem[];
  isPinsLoading: boolean;
  workspaceId: string;
  onRemovePin: (id: string) => void;
  onExpandPin: (pin: PinnedItem) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const STORAGE_KEY = `dashboard-layout-${workspaceId}`;

  // v1 Layout type: Array of { i, x, y, w, h }
  const [layout, setLayout] = useState<Layout>(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : []; }
    catch { return []; }
  });

  // Sync layout when pins change
  useEffect(() => {
    if (!pinnedItems.length) return;
    setLayout(prev => {
      const existingMap = new Map(prev.map(l => [l.i, l]));
      const pinIds = new Set(pinnedItems.map(p => p.id));
      const cleaned = prev.filter(l => pinIds.has(l.i));
      const toAdd = pinnedItems
        .filter(p => !existingMap.has(p.id))
        .map((p, i) => {
          const offset = cleaned.length + i;
          // 2 columns, each 6 wide; 8 rows tall by default
          return { i: p.id, x: (offset % 2) * 6, y: Math.floor(offset / 2) * 9, w: 6, h: 8, minH: 4, minW: 3 };
        });
      return [...cleaned, ...toAdd] as Layout;
    });
  }, [pinnedItems]);

  const handleLayoutChange = (newLayout: Layout) => {
    setLayout(newLayout);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayout));
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width));
    obs.observe(el);
    setContainerWidth(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  if (isPinsLoading) return (
    <div className="flex-1 flex items-center justify-center" style={{ minHeight: "calc(100vh - 80px)" }}>
      <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
    </div>
  );

  if (pinnedItems.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center text-center relative" style={{ minHeight: "calc(100vh - 80px)" }}>
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(circle, #ffffff0a 1.5px, transparent 1.5px)", backgroundSize: "28px 28px" }} />
      <div className="relative z-10 flex flex-col items-center gap-5">
        <div className="w-20 h-20 rounded-2xl bg-[#161616] border border-white/[0.08] flex items-center justify-center shadow-2xl">
          <LayoutDashboard className="w-9 h-9 text-gray-600" />
        </div>
        <div>
          <h3 className="text-xl font-semibold text-gray-300 mb-2">No panels yet</h3>
          <p className="text-sm text-gray-500 max-w-sm leading-relaxed">
            Run a query in the <span className="text-blue-400 font-medium">Notebook</span> tab and click the{" "}
            <span className="text-blue-400 font-medium">Pin</span> icon on any chart to add it here.
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full">
          <Pin className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-[12px] text-blue-400 font-medium">Panels appear here once pinned</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.06] bg-[#111111] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-4 h-4 text-blue-400" />
            <span className="text-[14px] font-semibold text-white tracking-tight">Dashboard</span>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-[10px] font-mono text-blue-400">
            {pinnedItems.length} panel{pinnedItems.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-[#1e1e1e] border border-white/[0.07] rounded-lg text-[11px] text-gray-500 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </div>
          <button
            onClick={() => setEditMode(e => !e)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all duration-200 ${editMode
              ? "bg-amber-500/15 border-amber-500/40 text-amber-400 shadow-[0_0_14px_rgba(245,158,11,0.18)]"
              : "bg-[#1e1e1e] border-white/[0.08] text-gray-400 hover:text-white hover:border-white/20"
              }`}
          >
            {editMode ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            {editMode ? "Editing" : "Edit Layout"}
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e1e1e] border border-white/[0.08] rounded-lg text-[12px] text-gray-400 hover:text-white font-medium transition-colors">
            <BarChart3 className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {editMode && (
        <div className="px-5 py-2 bg-amber-500/5 border-b border-amber-500/20 flex items-center gap-2 text-[12px] text-amber-400/80 shrink-0">
          <GripVertical className="w-3.5 h-3.5" />
          Drag panels by header · Resize from bottom-right · Click <strong className="text-amber-400">Edit Layout</strong> to lock.
        </div>
      )}

      {/* Grid canvas */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          backgroundImage: editMode
            ? "radial-gradient(circle, #3b82f620 1.5px, transparent 1.5px)"
            : "radial-gradient(circle, #ffffff07 1.5px, transparent 1.5px)",
          backgroundSize: "28px 28px",
        }}
      >
        <GridLayout
          layout={layout}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          width={containerWidth}
          margin={MARGIN}
          containerPadding={[14, 14]}
          isDraggable={editMode}
          isResizable={editMode}
          draggableHandle=".drag-handle"
          onLayoutChange={handleLayoutChange}
          resizeHandles={["se"]}
        >
          {pinnedItems.map((pin, idx) => {
            const accent = PANEL_ACCENTS[idx % PANEL_ACCENTS.length];
            const itemLayout = layout.find(l => l.i === pin.id);
            const h = itemLayout?.h ?? 8;
            const totalPx = panelToPx(h);
            const headerPx = 42;
            const chartPx = Math.max(totalPx - headerPx - 4, 80);

            return (
              // react-grid-layout v1 REQUIRES key on the outer div AND the outer div must be the only child.
              // The outer div fills the cell via position:absolute from the library.
              <div
                key={pin.id}
                className="group relative flex flex-col rounded-xl border border-white/[0.09] bg-[#161616] shadow-2xl overflow-hidden transition-[border-color] duration-200 hover:border-white/[0.18]"
              >
                {/* Top accent stripe */}
                <div className="absolute top-0 left-0 right-0 h-[3px] z-10 rounded-t-xl" style={{ background: accent }} />

                {/* Panel header */}
                <div
                  className={`flex items-center justify-between px-3 py-2 border-b border-white/[0.06] bg-[#1a1a1a] shrink-0 mt-[3px] rounded-t-xl ${editMode ? "drag-handle cursor-grab active:cursor-grabbing" : ""
                    }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {editMode && <GripVertical className="w-4 h-4 text-gray-600 shrink-0" />}
                    <span className="text-[12.5px] font-semibold text-gray-200 truncate" title={pin.title}>
                      {pin.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border hidden sm:inline"
                      style={{ color: accent, borderColor: `${accent}35`, background: `${accent}12` }}
                    >chart</span>
                    <button onClick={() => onExpandPin(pin)} className="p-1 text-gray-600 hover:text-blue-400 transition-colors" title="Expand">
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => onRemovePin(pin.id)} className="p-1 text-gray-600 hover:text-red-400 transition-colors" title="Remove">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Chart */}
                <div className="flex-1 bg-[#111111] overflow-hidden" style={{ height: `${chartPx}px` }}>
                  <VegaChart
                    block={{
                      ...pin.chartBlock,
                      spec: { ...pin.chartBlock.spec, height: chartPx - 16 },
                    } as unknown as ChartUIBlock}
                  />
                </div>
              </div>
            );
          })}
        </GridLayout>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function WorkspaceNotebook() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("notebook");
  const [cells, setCells] = useState<Cell[]>([makeCell("code")]);
  const [kernelBusy, setKernelBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Explorer UI State
  const [selectedExplorerDataset, setSelectedExplorerDataset] = useState<string | null>(null);
  const [selectedDbTable, setSelectedDbTable] = useState<string | null>(null);

  // Modal State
  const [expandedPin, setExpandedPin] = useState<PinnedItem | null>(null);

  const queryClient = useQueryClient();

  // ─── PIN API ────────────────────────────────────────────────────────────────

  const { data: pinnedItems = [], isLoading: isPinsLoading } = useQuery<PinnedItem[]>({
    queryKey: ["pins", "workspace", id],
    queryFn: async () => {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/dashboard/pins?workspace_id=${id}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load pins");
      const data = await res.json();
      // Map backend PinResponse to PinnedItem shape
      return data.map((p: any) => ({
        id: p.id,
        title: p.title,
        explanation: p.explanation,
        query: p.query,
        chartBlock: p.chart_payload,
        datePinned: p.created_at,
      }));
    },
  });

  const pinMutation = useMutation({
    mutationFn: async (item: {
      title: string;
      explanation: string;
      query: string;
      chart_payload: object;
    }) => {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/dashboard/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ ...item, workspace_id: id }),
      });
      if (!res.ok) throw new Error("Failed to pin chart");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pins", "workspace", id] }),
  });

  const unpinMutation = useMutation({
    mutationFn: async (pinId: string) => {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/dashboard/pins/${pinId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to remove pin");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pins", "workspace", id] }),
  });

  const cellsRef = useRef(cells);
  useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  const handlePin = (chartBlock: ChartBlockDef) => {
    // The chart block is now self-contained — explanation & query live inside it.
    pinMutation.mutate({
      title: chartBlock.spec?.title?.text || chartBlock.spec?.title || "Data Visualization",
      explanation: chartBlock.explanation || "No explanation provided.",
      query: chartBlock.query || "",
      chart_payload: {
        type: chartBlock.type,
        spec: chartBlock.spec,
        data: chartBlock.data,
        row_count: chartBlock.row_count,
      },
    });
  };

  const removePin = (pinId: string) => {
    if (expandedPin?.id === pinId) setExpandedPin(null);
    unpinMutation.mutate(pinId);
  };

  const { data: history } = useQuery({
    queryKey: ["notebookHistory", id],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/chat/workspace/${id}/history`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      return res.json();
    }
  });

  useEffect(() => { if (history) setCells(history); }, [history]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [cells.length]);

  const { data: workspace, isLoading } = useQuery<WorkspaceDetail>({
    queryKey: ["workspace", id],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/workspaces/${id}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch workspace");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: profileData, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['workspaceProfile', id],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/workspaces/${id}/explore`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch profile');
      return res.json();
    },
    enabled: !!id,
  });

  // Auto-select the first dataset and table when profile data loads
  useEffect(() => {
    if (profileData && !selectedExplorerDataset) {
      const keys = Object.keys(profileData);
      if (keys.length > 0) {
        const firstDataset = keys[0];
        setSelectedExplorerDataset(firstDataset);
        if (profileData[firstDataset].type === 'database' && profileData[firstDataset].tables?.length > 0) {
          setSelectedDbTable(profileData[firstDataset].tables[0].table_name);
        }
      }
    }
  }, [profileData, selectedExplorerDataset]);

  const handleDatasetSwitch = (name: string) => {
    setSelectedExplorerDataset(name);
    if (profileData[name]?.type === 'database' && profileData[name]?.tables?.length > 0) {
      setSelectedDbTable(profileData[name].tables[0].table_name);
    } else {
      setSelectedDbTable(null);
    }
  };

  const chatMutation = useMutation({
    mutationFn: async (payload: { message: string; cellId: string }) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/chat/workspace/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ message: payload.message, cell_id: payload.cellId }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.detail || `Agent request failed (${res.status})`);
      }
      return res.json();
    },
  });

  const updateCell = useCallback((cellId: string, patch: Partial<Cell>) => {
    setCells(prev => prev.map(c => c.id === cellId ? { ...c, ...patch } : c));
  }, []);

  const runCell = async (cellId: string) => {
    const cell = cells.find(c => c.id === cellId);
    if (!cell || !cell.input.trim() || kernelBusy) return;

    if (cell.type === "markdown") {
      updateCell(cellId, { isEditing: false, status: "done" });
      return;
    }

    const execCount = globalExecCounter++;
    setKernelBusy(true);
    updateCell(cellId, { status: "running", execCount, blocks: [] });

    try {
      const data = await chatMutation.mutateAsync({ message: cell.input, cellId: cell.id });
      updateCell(cellId, { status: 'done', blocks: data.blocks ?? [] });
    } catch (err: any) {
      updateCell(cellId, {
        status: 'error',
        blocks: [{ type: 'markdown', content: `❌ **Error:** ${err.message}` }],
      });
    } finally {
      setKernelBusy(false);
    }
  }

  const deleteCell = async (cellId: string) => {
    setCells(prev => prev.length > 1 ? prev.filter(c => c.id !== cellId) : prev);
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_BASE}/cell/${cellId}`, {
        method: 'DELETE',
        headers: { "Authorization": `Bearer ${token}` }
      });
    } catch (err) {
      console.error("Failed to delete cell from database:", err);
    }
  };

  const moveCell = useCallback((cellId: string, dir: "up" | "down") => {
    setCells(prev => {
      const idx = prev.findIndex(c => c.id === cellId);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = dir === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }, []);

  const addCellBelow = useCallback((cellId: string, type: CellType) => {
    setCells(prev => {
      const idx = prev.findIndex(c => c.id === cellId);
      const next = [...prev];
      next.splice(idx + 1, 0, makeCell(type));
      return next;
    });
  }, []);

  const addCellAtEnd = (type: CellType) => setCells(prev => [...prev, makeCell(type)]);
  const runAll = async () => {
    if (kernelBusy) return;
    const cellIdsToRun = cellsRef.current.filter(c => c.type === 'code' && c.input.trim()).map(c => c.id);
    for (const currentId of cellIdsToRun) {
      await runCell(currentId);
    }
  };

  const sources = workspace?.sources ?? [];
  const sourceNames = sources.map(s => s.name);

  // Helper to find the active source's ID for the InteractiveDataGrid
  const activeSourceId = selectedExplorerDataset
    ? sources.find(s => s.name === selectedExplorerDataset)?.id
    : undefined;

  if (isLoading) return (
    <div className="flex items-center justify-center h-screen bg-[#111111]">
      <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-[#111111] overflow-hidden font-sans">

      {/* ── MENUBAR ────────────────────────────────────────── */}
      <div className="h-[38px] bg-[#1a1a1a] border-b border-white/[0.07] flex items-center px-3 gap-1 shrink-0 z-20">
        <Link to="/workspaces" className="p-1.5 text-gray-500 hover:text-white hover:bg-white/[0.07] rounded transition-colors mr-1">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.05] cursor-default">
          <div className="w-5 h-5 rounded flex items-center justify-center bg-blue-500/20 text-blue-400">
            <GitMerge className="w-3 h-3" />
          </div>
          <span className="text-[13px] font-medium text-gray-200 max-w-[200px] truncate">
            {workspace?.name ?? "Workspace"}
          </span>
        </div>
        <div className="h-4 w-px bg-white/10 mx-1" />
        <div className="flex items-center gap-1 overflow-hidden">
          {sources.slice(0, 3).map(s => (
            <span key={s.id} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border shrink-0 ${sourceColor(s.type)}`}>
              {isDbSource(s.type) ? <Database className="w-2.5 h-2.5" /> : <FileText className="w-2.5 h-2.5" />}
              {s.name}
            </span>
          ))}
          {sources.length > 3 && (
            <span className="text-[10px] text-gray-600 font-mono shrink-0">+{sources.length - 3}</span>
          )}
        </div>
      </div>

      {/* ── TOOLBAR ────────────────────────────────────────── */}
      <div className="h-[42px] bg-[#161616] border-b border-white/[0.07] flex items-center px-4 gap-2 shrink-0 z-10">
        <button onClick={runAll} disabled={kernelBusy} className="flex items-center gap-1.5 px-3 h-7 bg-[#2a2a2a] hover:bg-[#333] disabled:opacity-40 text-gray-200 text-[12px] font-medium rounded border border-white/[0.08] transition-colors">
          <Play className="w-3 h-3 fill-current text-blue-400" /> Run All
        </button>
        <button onClick={() => setCells(prev => prev.map(c => ({ ...c, blocks: [], status: "idle" as CellStatus, execCount: null })))} className="flex items-center gap-1.5 px-3 h-7 bg-[#2a2a2a] hover:bg-[#333] text-gray-200 text-[12px] font-medium rounded border border-white/[0.08] transition-colors">
          <RotateCcw className="w-3 h-3 text-gray-400" /> Clear Outputs
        </button>
        <div className="h-5 w-px bg-white/[0.07] mx-1" />
        <button onClick={() => addCellAtEnd("code")} className="flex items-center gap-1.5 px-3 h-7 bg-[#2a2a2a] hover:bg-[#333] text-gray-200 text-[12px] font-medium rounded border border-white/[0.08] transition-colors">
          <Plus className="w-3 h-3" /><Code className="w-3 h-3 text-blue-400" /> Code
        </button>
        <button onClick={() => addCellAtEnd("markdown")} className="flex items-center gap-1.5 px-3 h-7 bg-[#2a2a2a] hover:bg-[#333] text-gray-200 text-[12px] font-medium rounded border border-white/[0.08] transition-colors">
          <Plus className="w-3 h-3" /><AlignLeft className="w-3 h-3 text-violet-400" /> Markdown
        </button>
        <div className="flex-1" />
        <div className="flex bg-[#2a2a2a] border border-white/[0.08] rounded overflow-hidden">
          {([
            ["notebook", TerminalSquare, "Notebook"],
            ["explorer", Layers, "Explorer"],
            // ["dashboard", LayoutDashboard, `Dashboard (${pinnedItems.length})`],
          ] as const).map(([tab, Icon, label]) => (
            <button
              key={tab} onClick={() => setActiveTab(tab as Tab)}
              className={`flex items-center gap-1.5 px-3 h-7 text-[12px] font-medium transition-colors ${activeTab === tab ? "bg-[#3a3a3a] text-white" : "text-gray-500 hover:text-gray-300 hover:bg-[#333]"}`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── CONTENT ────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-[#111111]">

        {/* NOTEBOOK TAB */}
        {activeTab === "notebook" && (
          <div className="max-w-[900px] mx-auto py-6 px-4 space-y-0.5 pb-24">
            {cells.map((cell, idx) => (
              <NotebookCell
                key={cell.id} cell={cell} index={idx} total={cells.length} sourceNames={sourceNames}
                onUpdate={updateCell} onRun={runCell} onDelete={deleteCell} onMove={moveCell} onAddBelow={addCellBelow}
                isKernelBusy={kernelBusy} onPin={handlePin}
              />
            ))}
            <div className="pt-4 flex items-center gap-3 pl-[52px]">
              <button onClick={() => addCellAtEnd("code")} className="flex items-center gap-2 px-4 py-1.5 border border-dashed border-white/10 hover:border-blue-500/40 text-gray-600 hover:text-blue-400 text-[12px] font-mono rounded transition-all">
                <Plus className="w-3.5 h-3.5" /> Code cell
              </button>
              <button onClick={() => addCellAtEnd("markdown")} className="flex items-center gap-2 px-4 py-1.5 border border-dashed border-white/10 hover:border-violet-500/40 text-gray-600 hover:text-violet-400 text-[12px] font-mono rounded transition-all">
                <Plus className="w-3.5 h-3.5" /> Markdown cell
              </button>
            </div>
            <div ref={endRef} />
          </div>
        )}

        {/* EXPLORER TAB */}
        {activeTab === "explorer" && (
          <div className="max-w-[1200px] mx-auto p-6 animate-in fade-in duration-200 pb-24 h-full flex flex-col">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-white mb-1">Data Explorer</h2>
              <p className="text-[13px] text-gray-400 font-mono">
                Explore schemas and raw data across your workspace sources.
              </p>
            </div>

            {isLoadingProfile ? (
              <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>
            ) : !profileData ? (
              <div className="p-4 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm">Failed to load profile data.</div>
            ) : (
              <div className="flex flex-col h-full gap-6">

                {/* DATASET SELECTOR PILLS */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {Object.keys(profileData).map((datasetName) => {
                    const isSelected = selectedExplorerDataset === datasetName;
                    const type = profileData[datasetName]?.type;
                    return (
                      <button
                        key={datasetName}
                        onClick={() => handleDatasetSwitch(datasetName)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all whitespace-nowrap ${isSelected
                          ? 'bg-blue-500/10 border-blue-500/50 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.1)]'
                          : 'bg-[#161616] border-white/10 text-gray-400 hover:bg-white/5 hover:text-gray-200'
                          }`}
                      >
                        {type === 'database' ? <Database className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                        {datasetName}
                      </button>
                    );
                  })}
                </div>

                {/* SELECTED DATASET VIEW */}
                {selectedExplorerDataset && profileData[selectedExplorerDataset] && (
                  <div className="flex flex-col gap-6 flex-1 min-h-0">

                    {profileData[selectedExplorerDataset].error ? (
                      <div className="p-4 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm">
                        Error profiling: {profileData[selectedExplorerDataset].error}
                      </div>
                    ) : profileData[selectedExplorerDataset].type === 'file' ? (
                      <>
                        {/* 1. SCHEMA DICTIONARY */}
                        <div>
                          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                            <Layers className="w-4 h-4" /> Schema Definition
                          </h3>
                          <div className="bg-[#161616] border border-white/[0.07] rounded-lg overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar">
                            <table className="w-full text-left text-[12.5px]">
                              <thead className="sticky top-0 bg-[#161616] shadow-md z-10">
                                <tr className="border-b border-white/[0.07]">
                                  {['Column', 'Type', 'Health (Missing %)', 'Unique Vals', 'Min / Max'].map(h => (
                                    <th key={h} className="px-5 py-2.5 text-[11px] uppercase tracking-wider text-gray-500 font-medium">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/[0.04]">
                                {profileData[selectedExplorerDataset].schema.map((col: any) => (
                                  <tr key={col.name} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="px-5 py-2 font-mono text-blue-400 font-medium">{col.name}</td>
                                    <td className="px-5 py-2"><span className="px-2 py-0.5 bg-white/[0.06] rounded text-[11px] font-mono text-gray-400">{col.type}</span></td>
                                    <td className="px-5 py-2">
                                      <div className="flex items-center gap-2">
                                        <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                          <div className={`h-full ${col.null_percentage > 10 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${100 - col.null_percentage}%` }} />
                                        </div>
                                        <span className="text-xs text-gray-500 font-mono">{col.null_percentage}% null</span>
                                      </div>
                                    </td>
                                    <td className="px-5 py-2 text-gray-400 font-mono text-xs">{col.unique_count?.toLocaleString() || '-'}</td>
                                    <td className="px-5 py-2 text-gray-500 font-mono text-xs truncate max-w-[150px]">
                                      {col.min !== null && col.max !== null ? `${col.min} → ${col.max}` : '-'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* 2. FULL TABLE VIEWER */}
                        <div className="flex-1 flex flex-col min-h-[400px]">
                          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                            <Table2 className="w-4 h-4" /> Interactive Data Grid
                          </h3>
                          <InteractiveDataGrid
                            sourceId={activeSourceId}
                            sourceType={profileData[selectedExplorerDataset].type}
                          />
                        </div>
                      </>
                    ) : (
                      // DATABASE VIEW
                      <div className="flex flex-col gap-6 flex-1 min-h-0">
                        <div className="p-4 bg-[#161616] border border-white/[0.07] rounded-lg shrink-0">
                          <h4 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">Select Database Table</h4>
                          <div className="flex flex-wrap gap-2">
                            {profileData[selectedExplorerDataset].tables?.map((t: any) => (
                              <button
                                key={t.table_name}
                                onClick={() => setSelectedDbTable(t.table_name)}
                                className={`px-3 py-1.5 rounded-md text-[11px] font-mono transition-colors ${selectedDbTable === t.table_name
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                                  }`}
                              >
                                {t.table_schema}.{t.table_name}
                              </button>
                            ))}
                          </div>
                        </div>

                        {selectedDbTable && (
                          <div className="flex-1 flex flex-col min-h-[400px]">
                            <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                              <Table2 className="w-4 h-4" /> Data Explorer ({selectedDbTable})
                            </h3>
                            <InteractiveDataGrid
                              sourceId={activeSourceId}
                              sourceType="postgres_db"
                              tableName={selectedDbTable}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* DASHBOARD TAB */}
        {activeTab === "dashboard" && (
          <DashboardGrid
            pinnedItems={pinnedItems}
            isPinsLoading={isPinsLoading}
            workspaceId={id!}
            onRemovePin={removePin}
            onExpandPin={setExpandedPin}
          />
        )}

      </main>

      {/* ======= EXPANDED DEEP-DIVE MODAL ======= */}
      {expandedPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#161616] border border-white/10 rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">

            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-[#1a1a1a]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
                  <Search className="w-4 h-4" />
                </div>
                <h2 className="text-lg font-bold text-white">{expandedPin.title}</h2>
              </div>
              <button onClick={() => setExpandedPin(null)} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                <Minimize2 className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Split Layout */}
            <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">

              {/* Left Side: The Chart */}
              <div className="flex-1 p-6 bg-[#111111] overflow-y-auto flex items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5">
                <div className="w-full max-w-3xl">
                  {/* Full size chart */}
                  <ChartBlock block={{ ...expandedPin.chartBlock, spec: { ...expandedPin.chartBlock.spec, height: 400 } }} />
                </div>
              </div>

              {/* Right Side: The Story & Code */}
              <div className="w-full lg:w-[400px] bg-[#1a1a1a]/50 overflow-y-auto custom-scrollbar flex flex-col">

                <div className="p-6">
                  <h3 className="text-[11px] font-mono text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <AlignLeft className="w-3.5 h-3.5" /> AI Analysis
                  </h3>
                  <div className="prose prose-invert prose-sm max-w-none text-gray-300">
                    <MdRender content={expandedPin.explanation} />
                  </div>
                </div>

                <div className="mt-auto border-t border-white/5">
                  <div className="px-6 py-4 bg-black/40">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[11px] font-mono text-gray-500 uppercase tracking-wider flex items-center gap-2">
                        <Database className="w-3.5 h-3.5" /> Source Query
                      </h3>
                      <button onClick={() => navigator.clipboard.writeText(expandedPin.query)} className="text-gray-500 hover:text-white transition-colors">
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-emerald-400/90 leading-relaxed overflow-x-auto whitespace-pre-wrap">
                      <code>{expandedPin.query}</code>
                    </pre>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
