import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Play, Square, Plus, Trash2, ChevronUp, ChevronDown,
  ArrowLeft, Loader2, Database, FileText,
  AlignLeft, LayoutDashboard, Table2, TerminalSquare,
  Pin, Code, Copy, RotateCcw, ChevronRight, Layers,
  ChevronLeft, ArrowDown, ArrowUp, Maximize2, BarChart3,
  GripVertical, Lock, Unlock
} from "lucide-react";
import VegaChart, { type ChartUIBlock } from "../components/VegaChart";
import GridLayout from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Tab = 'notebook' | 'explorer' | 'dashboard';
type CellType = 'code' | 'markdown';
type CellStatus = 'idle' | 'running' | 'done' | 'error';

type UIBlock =
  | { type: "markdown"; content: string }
  | { type: "code"; language: string; content: string }
  | { type: "table"; columns: string[]; data: any[]; warning?: string | null }
  | { type: "chart"; spec: any; data: any[]; row_count: number; explanation?: string; query?: string }
  | { type: "metrics"; title?: string; metrics: { label: string; value: string; trend?: "up" | "down" | "neutral" }[] };

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

const INGEST_API_URL = "http://127.0.0.1:8000/api/v1";
const CHAT_API_URL = "http://127.0.0.1:8000/api/v1/chat";
const API_BASE = "http://127.0.0.1:8000/api/v1";

// Dashboard Pin type
type PinnedItem = {
  id: string;
  title: string;
  explanation: string;
  query: string;
  chartBlock: { type: "chart"; spec: any; data: any[]; row_count: number };
  datePinned: string;  // ISO string from DB
};

let globalExecCounter = 1;

function makeCell(type: CellType = 'code'): Cell {
  return {
    id: crypto.randomUUID(),
    type,
    input: '',
    execCount: null,
    status: 'idle',
    blocks: [],
    isEditing: type === 'markdown',
    collapsed: false,
  };
}

function MdRender({ content }: { content: string }) {
  // Render fenced code blocks separately, then handle inline markdown
  const segments: Array<{ type: 'html' | 'code'; content: string; lang?: string }> = [];
  const fenceRe = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0, m;
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
      // Fix: wrap consecutive <li> in <ul>
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


function TableBlock({ block }: { block: Extract<UIBlock, { type: 'table' }> }) {
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
            {block.columns.map(c => (
              <th key={c} className="px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.data.map((row, i) => (
            <tr key={i} className={`border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors`}>
              <td className="px-3 py-2 text-gray-600 text-right text-[11px]">{i}</td>
              {block.columns.map(c => (
                <td key={c} className="px-3 py-2 whitespace-nowrap text-gray-300">
                  {row[c] !== null && row[c] !== undefined ? <span>{String(row[c])}</span> : <span className="text-gray-600 italic">NaN</span>}
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

function MetricsGridBlock({ block }: { block: Extract<UIBlock, { type: 'metrics' }> }) {
  return (
    <div className="flex flex-col gap-4 p-5 bg-[#1a1a1a]/40 border-t border-white/[0.06]">
      <div className="px-2">
        {block.title && (
          <h3 className="text-[14px] font-bold text-gray-200 mb-4 flex items-center gap-2">
            {block.title}
          </h3>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {block.metrics.map((m, i) => (
            <div key={i} className="flex flex-col flex-1 min-w-[140px] gap-1.5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:border-blue-500/20 transition-all">
              <span className="text-[11px] font-mono text-gray-500 uppercase tracking-widest truncate" title={m.label}>{m.label}</span>
              <span className={`text-[16px] font-bold font-mono tracking-tight ${m.trend === 'up' ? 'text-emerald-400' : m.trend === 'down' ? 'text-red-400' : 'text-gray-200'}`}>
                {m.trend === 'up' && <span className="text-[14px] mr-1">↑</span>}
                {m.trend === 'down' && <span className="text-[14px] mr-1">↓</span>}
                {m.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NotebookCell({
  cell, index, total, onUpdate, onRun, onDelete, onMove, onAddBelow, isKernelBusy, onPin, pinnedTitles,
}: {
  cell: Cell; index: number; total: number;
  onUpdate: (id: string, patch: Partial<Cell>) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
  onAddBelow: (id: string, type: CellType) => void;
  isKernelBusy: boolean;
  onPin: (block: Extract<UIBlock, { type: 'chart' }>) => void;
  pinnedTitles: Set<string>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, 52)}px`;
  }, [cell.input]);

  const isRunning = cell.status === 'running';
  const hasOutput = cell.blocks.length > 0;

  return (
    <div className="relative group/cell">
      <div className={`flex items-start transition-all duration-150 ${focused ? 'opacity-100' : 'opacity-90 hover:opacity-100'}`}>

        <div className="flex flex-col items-end shrink-0 w-[52px] pt-[6px] pr-1">
          <button
            onClick={() => onRun(cell.id)}
            disabled={isKernelBusy && !isRunning}
            className={`w-7 h-7 flex items-center justify-center rounded transition-all ${isRunning ? 'text-amber-400 hover:text-amber-300' : focused ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/10' : 'text-gray-600 hover:text-gray-400'
              }`}
          >
            {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          </button>
          <span className="font-mono text-[11px] text-gray-600 mt-0.5 select-none">
            {isRunning ? <span className="text-amber-400 animate-pulse">*</span> : cell.execCount !== null ? cell.execCount : ''}
          </span>
        </div>

        <div className={`flex-1 min-w-0 rounded-[4px] border transition-all duration-100 ${focused ? cell.type === 'code' ? 'border-blue-500/60 bg-[#1a1a1a] shadow-[0_0_0_1px_rgba(59,130,246,0.15)]' : 'border-violet-500/50 bg-[#1a1a1a]' : 'border-white/[0.07] bg-[#161616] hover:border-white/[0.12]'
          }`}>

          {focused && (
            <div className="absolute -top-0 left-[60px] flex items-center gap-1 z-10">
              <span className={`text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-t ${cell.type === 'code' ? 'text-blue-400/70' : 'text-violet-400/70'}`}>
                {cell.type === 'code' ? '⬡ code' : '⬡ markdown'}
              </span>
            </div>
          )}

          {cell.type === 'code' ? (
            <textarea
              ref={textareaRef} value={cell.input} onChange={e => onUpdate(cell.id, { input: e.target.value })}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              onKeyDown={e => { if ((e.shiftKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onRun(cell.id); } }}
              spellCheck={false} placeholder="# Write a query or question for the AI agent..."
              className="w-full bg-transparent text-[13px] font-mono text-[#d4d4d4] leading-6 px-4 py-3 focus:outline-none resize-none placeholder-gray-700 caret-blue-400"
              style={{ minHeight: '52px' }}
            />
          ) : cell.isEditing ? (
            <div>
              <textarea
                autoFocus value={cell.input} onChange={e => onUpdate(cell.id, { input: e.target.value })}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { onUpdate(cell.id, { isEditing: false }); setFocused(false); }
                  if ((e.shiftKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onRun(cell.id); }
                }}
                placeholder="Write markdown notes..."
                className="w-full bg-transparent text-[13px] text-gray-300 leading-6 px-4 py-3 focus:outline-none resize-none placeholder-gray-700 caret-violet-400 font-sans"
                style={{ minHeight: '52px' }}
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

          {hasOutput && (
            <div className="border-t border-white/[0.06]">
              {cell.blocks.map((block, idx) => (
                <div key={idx} className="relative group/block">
                  {block.type === 'code' && (
                    <div>
                      <div className="flex items-center justify-between px-4 py-1.5 bg-white/[0.02] border-b border-white/[0.04]">
                        <span className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">{block.language}</span>
                        <button onClick={() => navigator.clipboard.writeText(block.content)} className="p-1 text-gray-600 hover:text-gray-400 transition-colors">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      <pre className="px-4 py-3 text-[12.5px] font-mono text-emerald-400/90 overflow-x-auto leading-5 bg-black/20">
                        <code>{block.content}</code>
                      </pre>
                    </div>
                  )}
                  {block.type === 'table' && <TableBlock block={block} />}
                  {block.type === 'markdown' && <div className="px-4 py-3"><MdRender content={block.content} /></div>}
                  {block.type === 'metrics' && <MetricsGridBlock block={block} />}
                  {block.type === 'chart' && (() => {
                    const cb = block as Extract<UIBlock, { type: 'chart' }>;
                    const title = cb.spec?.title?.text || cb.spec?.title || "";
                    const alreadyPinned = pinnedTitles.has(title);
                    return (
                      <div className="relative">
                        <VegaChart block={cb as any} />
                        <button
                          onClick={() => !alreadyPinned && onPin(cb)}
                          title={alreadyPinned ? 'Already pinned to Dashboard' : 'Pin to Dashboard'}
                          className={`absolute top-2 right-2 p-1.5 rounded border shadow-lg flex items-center gap-1.5 text-[10px] font-medium opacity-0 group-hover/block:opacity-100 transition-all ${alreadyPinned
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 cursor-default'
                            : 'bg-[#222] border-white/10 text-gray-400 hover:text-blue-400 hover:bg-[#333] cursor-pointer'
                            }`}
                        >
                          <Pin className={`w-3.5 h-3.5 ${alreadyPinned ? 'fill-current' : ''}`} />
                          {alreadyPinned ? 'Pinned ✓' : 'Pin'}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              ))}

              {cell.status === 'running' && (
                <div className="flex items-center gap-2.5 px-4 py-3 text-[12px] text-gray-500 font-mono">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                  <span>Running agent...</span>
                </div>
              )}
            </div>
          )}
          {cell.status === 'running' && !hasOutput && (
            <div className="flex items-center gap-2.5 px-4 py-3 border-t border-white/[0.06] text-[12px] text-gray-500 font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span>Executing LangGraph workflow...</span>
            </div>
          )}
        </div>

        <div className={`flex flex-col items-center gap-1 pl-1.5 pt-1 transition-opacity ${focused ? 'opacity-100' : 'opacity-0 group-hover/cell:opacity-100'}`}>
          <button onClick={() => onMove(cell.id, 'up')} disabled={index === 0} className="p-1 text-gray-600 hover:text-gray-300 disabled:opacity-20 transition-colors"><ChevronUp className="w-3.5 h-3.5" /></button>
          <button onClick={() => onMove(cell.id, 'down')} disabled={index === total - 1} className="p-1 text-gray-600 hover:text-gray-300 disabled:opacity-20 transition-colors"><ChevronDown className="w-3.5 h-3.5" /></button>
          <button onClick={() => onDelete(cell.id)} className="p-1 text-gray-600 hover:text-red-400 transition-colors mt-1"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <div className="h-3 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity my-0.5">
        <div className="flex items-center gap-1 bg-[#1a1a1a] border border-white/10 rounded-full px-2 py-0.5 shadow-lg">
          <button onClick={() => onAddBelow(cell.id, 'code')} className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-gray-400 hover:text-blue-400 font-mono transition-colors"><Code className="w-2.5 h-2.5" /> + Code</button>
          <div className="w-px h-3 bg-white/10" />
          <button onClick={() => onAddBelow(cell.id, 'markdown')} className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-gray-400 hover:text-violet-400 font-mono transition-colors"><AlignLeft className="w-2.5 h-2.5" /> + Markdown</button>
        </div>
      </div>
    </div>
  );
}

// ─── NEW INTERACTIVE DATA GRID COMPONENT ──────────────────────────────────────
function InteractiveDataGrid({
  sourceId,
  sourceType: _sourceType,
  tableName = null
}: {
  sourceId: string,
  sourceType: string,
  tableName?: string | null
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);

  const { data: tableData, isLoading, isFetching } = useQuery({
    queryKey: ['tableData', sourceId, tableName, page, pageSize, sortCol, sortDesc],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${INGEST_API_URL}/data/${sourceId}/explore/table`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          table_name: tableName,
          limit: pageSize,
          offset: page * pageSize,
          sort_column: sortCol,
          sort_desc: sortDesc
        })
      });
      if (!res.ok) throw new Error("Failed to fetch table data");
      return res.json();
    },
    placeholderData: (prev) => prev,
  });

  const handleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDesc) {
        setSortCol(null);
        setSortDesc(false);
      } else {
        setSortDesc(true);
      }
    } else {
      setSortCol(col);
      setSortDesc(false);
    }
    setPage(0);
  };

  if (isLoading && !tableData) {
    return <div className="h-64 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>;
  }

  if (!tableData) return <div className="p-4 text-gray-500">No data available.</div>;

  const totalPages = Math.ceil(tableData.total_rows / pageSize);

  return (
    <div className="flex flex-col h-[500px] border border-white/[0.07] rounded-lg bg-[#111111] overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#161616] border-b border-white/[0.07]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-gray-400">
            {tableData.total_rows.toLocaleString()} total rows
          </span>
          {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
        </div>

        <div className="flex items-center gap-4 text-sm font-mono text-gray-400">
          <span>Rows per page:
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

// ─── PANEL ACCENT COLORS ─────────────────────────────────────────────────────
const PANEL_ACCENTS_DS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#f59e0b",
  "#ef4444", "#06b6d4", "#ec4899", "#84cc16",
];

const DS_ROW_HEIGHT = 60;
const DS_MARGIN: [number, number] = [12, 12];
const DS_COLS = 12;

function dsPanelToPx(h: number) {
  return h * DS_ROW_HEIGHT + (h - 1) * DS_MARGIN[1];
}

// ─── DATASOURCE DASHBOARD GRID ────────────────────────────────────────────────
function DsDashboardGrid({
  pinnedItems, isPinsLoading, sourceId, onRemovePin, onExpandPin,
}: {
  pinnedItems: PinnedItem[];
  isPinsLoading: boolean;
  sourceId: string;
  onRemovePin: (id: string) => void;
  onExpandPin: (pin: PinnedItem) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const STORAGE_KEY = `ds-dashboard-layout-${sourceId}`;

  const [layout, setLayout] = useState<Layout[]>(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : []; }
    catch { return []; }
  });

  useEffect(() => {
    if (!pinnedItems.length) return;
    setLayout(prev => {
      const existingMap = new Map(prev.map((l: Layout) => [l.i, l]));
      const pinIds = new Set(pinnedItems.map(p => p.id));
      const cleaned = prev.filter((l: Layout) => pinIds.has(l.i));
      const toAdd = pinnedItems
        .filter(p => !existingMap.has(p.id))
        .map((p, i) => {
          const offset = cleaned.length + i;
          return { i: p.id, x: (offset % 2) * 6, y: Math.floor(offset / 2) * 9, w: 6, h: 8, minH: 4, minW: 3 };
        });
      return [...cleaned, ...toAdd] as Layout[];
    });
  }, [pinnedItems]);

  const handleLayoutChange = (newLayout: Layout[]) => {
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
          cols={DS_COLS}
          rowHeight={DS_ROW_HEIGHT}
          width={containerWidth}
          margin={DS_MARGIN}
          containerPadding={[14, 14]}
          isDraggable={editMode}
          isResizable={editMode}
          draggableHandle=".drag-handle"
          onLayoutChange={handleLayoutChange}
          resizeHandles={["se"]}
        >
          {pinnedItems.map((pin, idx) => {
            const accent = PANEL_ACCENTS_DS[idx % PANEL_ACCENTS_DS.length];
            const itemLayout = layout.find((l: Layout) => l.i === pin.id);
            const h = itemLayout?.h ?? 8;
            const totalPx = dsPanelToPx(h);
            const chartPx = Math.max(totalPx - 46, 80);

            return (
              <div
                key={pin.id}
                className="group relative flex flex-col rounded-xl border border-white/[0.09] bg-[#161616] shadow-2xl overflow-hidden transition-[border-color] duration-200 hover:border-white/[0.18]"
              >
                <div className="absolute top-0 left-0 right-0 h-[3px] z-10 rounded-t-xl" style={{ background: accent }} />
                <div className={`flex items-center justify-between px-3 py-2 border-b border-white/[0.06] bg-[#1a1a1a] shrink-0 mt-[3px] rounded-t-xl ${editMode ? "drag-handle cursor-grab active:cursor-grabbing" : ""
                  }`}>
                  <div className="flex items-center gap-2 min-w-0">
                    {editMode && <GripVertical className="w-4 h-4 text-gray-600 shrink-0" />}
                    <span className="text-[12.5px] font-semibold text-gray-200 truncate" title={pin.title}>{pin.title}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border hidden sm:inline"
                      style={{ color: accent, borderColor: `${accent}35`, background: `${accent}12` }}>chart</span>
                    <button onClick={() => onExpandPin(pin)} className="p-1 text-gray-600 hover:text-blue-400 transition-colors" title="Expand">
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => onRemovePin(pin.id)} className="p-1 text-gray-600 hover:text-red-400 transition-colors" title="Remove">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="bg-[#111111] overflow-hidden" style={{ height: `${chartPx}px` }}>
                  <VegaChart
                    block={{
                      ...pin.chartBlock,
                      spec: { ...pin.chartBlock.spec, height: chartPx - 16 },
                    } as ChartUIBlock}
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

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DataSourceNotebook() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState<Tab>('notebook');
  const [cells, setCells] = useState<Cell[]>([makeCell('code'), makeCell('markdown')]);
  const [kernelBusy, setKernelBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [expandedPin, setExpandedPin] = useState<PinnedItem | null>(null);

  const cellsRef = useRef(cells);
  useEffect(() => { cellsRef.current = cells; }, [cells]);

  const { data: history } = useQuery({
    queryKey: ["notebookHistory", id],
    queryFn: async () => {
      const res = await fetch(`${CHAT_API_URL}/${id}/history`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      return res.json();
    }
  });

  useEffect(() => { if (history) setCells(history); }, [history]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [cells.length]);

  // ─── PIN API ──────────────────────────────────────────────────────────────
  const { data: pinnedItems = [], isLoading: isPinsLoading } = useQuery<PinnedItem[]>({
    queryKey: ["pins", "source", id],
    queryFn: async () => {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/dashboard/pins?source_id=${id}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load pins");
      const data = await res.json();
      return data.map((p: any) => ({
        id: p.id,
        title: p.title,
        explanation: p.explanation,
        query: p.query,
        chartBlock: p.chart_payload,
        datePinned: p.created_at,
      }));
    },
    enabled: !!id,
  });

  // Set of pinned chart titles for instant feedback in the notebook
  const pinnedTitles = useMemo(
    () => new Set(pinnedItems.map((p) => p.title)),
    [pinnedItems]
  );


  const pinMutation = useMutation({
    mutationFn: async (chartBlock: Extract<UIBlock, { type: "chart" }>) => {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/dashboard/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          title: chartBlock.spec?.title?.text || chartBlock.spec?.title || "Data Visualization",
          explanation: chartBlock.explanation || "No explanation provided.",
          query: chartBlock.query || "",
          chart_payload: { type: chartBlock.type, spec: chartBlock.spec, data: chartBlock.data, row_count: chartBlock.row_count },
          source_id: id,
        }),
      });
      if (!res.ok) throw new Error("Failed to pin chart");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pins", "source", id] }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pins", "source", id] }),
  });

  const { data: source, isLoading } = useQuery({
    queryKey: ['dataSource', id],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${INGEST_API_URL}/data/${id}`, { headers: { "Authorization": `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!id,
  });

  const { data: profile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['dataProfile', id],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${INGEST_API_URL}/data/${id}/explore`, { headers: { "Authorization": `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to fetch profile');
      return res.json();
    },
    enabled: !!id,
  });

  const chatMutation = useMutation({
    mutationFn: async (payload: { message: string; cellId: string }) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${CHAT_API_URL}/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ message: payload.message, cell_id: payload.cellId }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.detail || `Agent request failed (${res.status})`);
      }
      return res.json();
    },
  });

  const updateCell = useCallback((id: string, patch: Partial<Cell>) => {
    setCells(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }, []);

  const runCell = async (cellId: string) => {
    const cell = cells.find(c => c.id === cellId);
    if (!cell || !cell.input.trim() || kernelBusy) return;

    if (cell.type === 'markdown') {
      updateCell(cellId, { isEditing: false, status: 'done' });
      return;
    }

    const execCount = globalExecCounter++;
    setKernelBusy(true);
    updateCell(cellId, { status: 'running', execCount, blocks: [] });

    try {
      const data = await chatMutation.mutateAsync({ message: cell.input, cellId: cell.id });
      updateCell(cellId, { status: 'done', blocks: data.blocks ?? [] });
    } catch (err: any) {
      updateCell(cellId, { status: 'error', blocks: [{ type: 'markdown', content: `❌ **Error:** ${err.message}` }] });
    } finally {
      setKernelBusy(false);
    }
  }

  const deleteCell = async (id: string) => {
    setCells(prev => prev.length > 1 ? prev.filter(c => c.id !== id) : prev);
    try {
      const token = localStorage.getItem('token');
      await fetch(`http://127.0.0.1:8000/api/v1/cell/${id}`, {
        method: 'DELETE',
        headers: { "Authorization": `Bearer ${token}` }
      });
    } catch (err) { console.error("Failed to delete cell from database:", err); }
  };

  const moveCell = useCallback((id: string, dir: 'up' | 'down') => {
    setCells(prev => {
      const idx = prev.findIndex(c => c.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }, []);

  const addCellBelow = useCallback((id: string, type: CellType) => {
    setCells(prev => {
      const idx = prev.findIndex(c => c.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, makeCell(type));
      return next;
    });
  }, []);

  const addCellAtEnd = (type: CellType) => { setCells(prev => [...prev, makeCell(type)]); };

  const runAll = async () => {
    if (kernelBusy) return;
    const cellIdsToRun = cellsRef.current.filter(c => c.type === 'code' && c.input.trim()).map(c => c.id);
    for (const currentId of cellIdsToRun) { await runCell(currentId); }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-screen bg-[#111111]"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>
  );

  return (
    <div className="flex flex-col h-screen bg-[#111111] overflow-hidden font-sans">
      {/* ── MENUBAR ─────────────────────────────────────────── */}
      <div className="h-[38px] bg-[#1a1a1a] border-b border-white/[0.07] flex items-center px-3 gap-1 shrink-0 z-20">
        <Link to="/" className="p-1.5 text-gray-500 hover:text-white hover:bg-white/[0.07] rounded transition-colors mr-1">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.05] cursor-default">
          <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] ${source?.source_type?.includes('db') ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'}`}>
            {source?.source_type?.includes('db') ? <Database className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
          </div>
          <span className="text-[13px] font-medium text-gray-200 max-w-[200px] truncate">
            {source?.dataset_name || 'Untitled Notebook'}
          </span>
        </div>
      </div>

      {/* ── TOOLBAR ─────────────────────────────────────────── */}
      <div className="h-[42px] bg-[#161616] border-b border-white/[0.07] flex items-center px-4 gap-2 shrink-0 z-10">
        <button onClick={runAll} disabled={kernelBusy} className="flex items-center gap-1.5 px-3 h-7 bg-[#2a2a2a] hover:bg-[#333] disabled:opacity-40 text-gray-200 text-[12px] font-medium rounded border border-white/[0.08] transition-colors"><Play className="w-3 h-3 fill-current text-blue-400" /> Run All</button>
        <button onClick={() => setCells(prev => prev.map(c => ({ ...c, blocks: [], status: 'idle', execCount: null })))} className="flex items-center gap-1.5 px-3 h-7 bg-[#2a2a2a] hover:bg-[#333] text-gray-200 text-[12px] font-medium rounded border border-white/[0.08] transition-colors"><RotateCcw className="w-3 h-3 text-gray-400" /> Clear Outputs</button>
        <div className="h-5 w-px bg-white/[0.07] mx-1" />
        <button onClick={() => addCellAtEnd('code')} className="flex items-center gap-1.5 px-3 h-7 bg-[#2a2a2a] hover:bg-[#333] text-gray-200 text-[12px] font-medium rounded border border-white/[0.08] transition-colors"><Plus className="w-3 h-3" /><Code className="w-3 h-3 text-blue-400" /> Code</button>
        <button onClick={() => addCellAtEnd('markdown')} className="flex items-center gap-1.5 px-3 h-7 bg-[#2a2a2a] hover:bg-[#333] text-gray-200 text-[12px] font-medium rounded border border-white/[0.08] transition-colors"><Plus className="w-3 h-3" /><AlignLeft className="w-3 h-3 text-violet-400" /> Markdown</button>
        <div className="flex-1" />
        <div className="flex bg-[#2a2a2a] border border-white/[0.08] rounded overflow-hidden">
          {([
            ['notebook', TerminalSquare, 'Notebook'],
            ['explorer', Table2, 'Explorer'],
            // ['dashboard', LayoutDashboard, 'Dashboard'],
          ] as const).map(([tab, Icon, label]) => (
            <button
              key={tab} onClick={() => setActiveTab(tab as Tab)}
              className={`flex items-center gap-1.5 px-3 h-7 text-[12px] font-medium transition-colors ${activeTab === tab ? 'bg-[#3a3a3a] text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-[#333]'}`}
            ><Icon className="w-3.5 h-3.5" /> {label}</button>
          ))}
        </div>
      </div>

      {/* ── MAIN CONTENT ────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-[#111111]">

        {/* ======= NOTEBOOK TAB ======= */}
        {activeTab === 'notebook' && (
          <div className="max-w-[900px] mx-auto py-6 px-4 space-y-0.5 pb-24">
            {cells.map((cell, idx) => (
              <NotebookCell
                key={cell.id}
                cell={cell}
                index={idx}
                total={cells.length}
                onUpdate={updateCell}
                onRun={runCell}
                onDelete={deleteCell}
                onMove={moveCell}
                onAddBelow={addCellBelow}
                isKernelBusy={kernelBusy}
                onPin={(block) => pinMutation.mutate(block)}
                pinnedTitles={pinnedTitles} /* <-- Added this line */
              />
            ))}
            <div className="pt-4 flex items-center gap-3 pl-[52px]">
              <button onClick={() => addCellAtEnd('code')} className="flex items-center gap-2 px-4 py-1.5 border border-dashed border-white/10 hover:border-blue-500/40 text-gray-600 hover:text-blue-400 text-[12px] font-mono rounded transition-all"><Plus className="w-3.5 h-3.5" /> Code cell</button>
              <button onClick={() => addCellAtEnd('markdown')} className="flex items-center gap-2 px-4 py-1.5 border border-dashed border-white/10 hover:border-violet-500/40 text-gray-600 hover:text-violet-400 text-[12px] font-mono rounded transition-all"><Plus className="w-3.5 h-3.5" /> Markdown cell</button>
            </div>
            <div ref={endRef} />
          </div>
        )}

        {/* ======= EXPLORER TAB ======= */}
        {activeTab === 'explorer' && (
          <div className="max-w-[1200px] mx-auto p-6 animate-in fade-in duration-200 pb-24 h-full flex flex-col">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-white mb-1">Data Explorer</h2>
              <p className="text-[13px] text-gray-400 font-mono">
                Explore schema and raw data for {source?.dataset_name || 'this dataset'}.
              </p>
            </div>

            {isLoadingProfile ? (
              <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>
            ) : profile?.error ? (
              <div className="p-4 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm">Error profiling data: {profile.error}</div>
            ) : profile?.type === 'file' ? (
              <div className="flex flex-col gap-6 h-full">

                {/* 1. SCHEMA DICTIONARY (Compact) */}
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
                        {profile.schema.map((col: any) => (
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

                {/* 2. FULL TABLE VIEWER (Spreadsheet style) */}
                <div className="flex-1 min-h-[400px] flex flex-col">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                    <Table2 className="w-4 h-4" /> Data Explorer (Interactive)
                  </h3>
                  <InteractiveDataGrid sourceId={id!} sourceType={source?.source_type || 'parquet'} />
                </div>

              </div>
            ) : (
              <div className="flex flex-col gap-6 h-full">
                <div className="p-5 bg-[#161616] border border-white/[0.07] rounded-lg">
                  <p className="text-sm text-gray-400 mb-4">Live database profiling is limited to table names to protect production performance. Select a table to explore its contents below.</p>
                  <div className="flex flex-wrap gap-2">
                    {profile?.tables?.map((t: any) => (
                      <span key={t.table_name} className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-[11px] font-mono text-emerald-400">
                        {t.table_schema}.{t.table_name}
                      </span>
                    ))}
                  </div>
                </div>
                {/* Auto-load the first table from the DB */}
                {profile?.tables && profile.tables.length > 0 && (
                  <div className="flex-1 min-h-[400px] flex flex-col">
                    <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                      <Table2 className="w-4 h-4" /> Data Explorer ({profile.tables[0].table_name})
                    </h3>
                    <InteractiveDataGrid sourceId={id!} sourceType="postgres_db" tableName={profile.tables[0].table_name} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ======= DASHBOARD TAB ======= */}
        {activeTab === 'dashboard' && (
          <DsDashboardGrid
            pinnedItems={pinnedItems}
            isPinsLoading={isPinsLoading}
            sourceId={id!}
            onRemovePin={(pinId) => { if (expandedPin?.id === pinId) setExpandedPin(null); unpinMutation.mutate(pinId); }}
            onExpandPin={setExpandedPin}
          />
        )}

        {/* Expanded Pin Modal — rendered outside the grid so it sits above everything */}
        {expandedPin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm" onClick={() => setExpandedPin(null)}>
            <div className="bg-[#161616] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-[#1a1a1a]">
                <h2 className="text-lg font-bold text-white">{expandedPin.title}</h2>
                <button onClick={() => setExpandedPin(null)} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
                <div className="flex-1 p-6 bg-[#111111] overflow-y-auto">
                  <VegaChart block={{ ...expandedPin.chartBlock, spec: { ...expandedPin.chartBlock.spec, height: 420 } } as ChartUIBlock} />
                </div>
                <div className="w-full lg:w-[380px] bg-[#1a1a1a]/50 p-6 overflow-y-auto border-t lg:border-t-0 lg:border-l border-white/5 flex flex-col gap-6">
                  {expandedPin.explanation && (
                    <div>
                      <p className="text-[11px] font-mono text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5"><AlignLeft className="w-3.5 h-3.5" /> AI Analysis</p>
                      <MdRender content={expandedPin.explanation} />
                    </div>
                  )}
                  {expandedPin.query && (
                    <div className="mt-auto">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] font-mono text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><Database className="w-3.5 h-3.5" /> Source Query</p>
                        <button onClick={() => navigator.clipboard.writeText(expandedPin.query)} className="text-gray-500 hover:text-white transition-colors"><Copy className="w-3 h-3" /></button>
                      </div>
                      <pre className="text-[11px] font-mono text-emerald-400/90 leading-relaxed overflow-x-auto whitespace-pre-wrap bg-black/40 rounded-lg p-3">{expandedPin.query}</pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
