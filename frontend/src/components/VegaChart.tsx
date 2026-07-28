/**
 * VegaChart.tsx
 *
 * Renders any Vega-Lite v6 spec returned by the agent.
 * - Injects data as inline values (no named datasets needed)
 * - ResizeObserver keeps `width: "container"` charts responsive
 * - Tooltip enabled for all charts
 */

import { useRef, useEffect, useState, useCallback } from "react";
import embed, { type Result } from "vega-embed";

// ─── TYPES ────────────────────────────────────────────────────────────────────
export type ChartUIBlock = {
  type: "chart";
  spec: Record<string, any>;
  data: Record<string, any>[];
  row_count?: number;
  explanation?: string;
};

// ─── DARK THEME CONFIG ────────────────────────────────────────────────────────
const DARK_CONFIG = {
  background: "#111111",
  view: { stroke: "transparent" },
  axis: {
    gridColor: "#2a2a2a",
    tickColor: "#3a3a3a",
    labelColor: "#9ca3af",
    titleColor: "#6b7280",
    domainColor: "#2a2a2a",
    labelFont: "monospace",
    titleFont: "monospace",
    labelFontSize: 11,
    titleFontSize: 11,
  },
  legend: {
    labelColor: "#9ca3af",
    titleColor: "#6b7280",
    labelFont: "monospace",
    titleFont: "monospace",
    labelFontSize: 11,
  },
  title: { color: "#d1d5db", font: "monospace", fontSize: 12 },
  arc: { stroke: "#111111", strokeWidth: 1.5 },
  tooltip: { theme: "dark" },
} as const;

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function VegaChart({ block }: { block: ChartUIBlock }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Detect arc/pie mark (these need fixed size, not container width)
  const mark = block.spec?.mark ?? "";
  const markType = typeof mark === "object" ? mark?.type : mark;
  const isArc = markType === "arc";

  // ── Build the spec with injected data ─────────────────────────────────────
  const buildSpec = useCallback((): any => {
    const spec: any = {
      ...block.spec,
      // Always inject inline values — never rely on named datasets
      data: { values: block.data },
    };

    // Force arc charts to fixed size so they actually render
    if (isArc) {
      spec.width = 280;
      spec.height = 280;
      spec.autosize = { type: "fit", contains: "padding" };
    } else {
      spec.width = "container";
      spec.height ??= 300;
    }

    // Enable tooltips on every encoding field automatically
    const addTooltip = (enc: Record<string, any>) => {
      Object.keys(enc).forEach((ch) => {
        if (typeof enc[ch] === "object" && enc[ch] !== null && !Array.isArray(enc[ch])) {
          if (!enc[ch].tooltip) enc[ch] = { ...enc[ch] };
        }
      });
    };
    if (spec.encoding) addTooltip(spec.encoding);
    if (!spec.encoding?.tooltip) {
      spec.encoding = { ...(spec.encoding ?? {}), tooltip: { content: "data" } };
    }

    return spec;
  }, [block.spec, block.data, isArc]);

  // ── Embed / re-embed ───────────────────────────────────────────────────────
  const doEmbed = useCallback(() => {
    if (!containerRef.current) return;
    viewRef.current?.finalize();
    setLoading(true);
    setError(null);

    embed(containerRef.current, buildSpec(), {
      actions: false,
      renderer: "svg",
      theme: "dark",
      config: DARK_CONFIG,
      tooltip: { theme: "dark" },
    })
      .then((result) => {
        viewRef.current = result;
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        console.error("[VegaChart] Embed failed:", err);
        const raw: string = err?.message ?? "Failed to render chart";
        setError(raw.length > 200 ? raw.slice(0, 200) + "…" : raw);
        setLoading(false);
      });
  }, [buildSpec]);

  // ── Initial render ─────────────────────────────────────────────────────────
  useEffect(() => {
    doEmbed();
    return () => { viewRef.current?.finalize(); };
  }, [doEmbed]);

  // ── ResizeObserver — keeps container-width charts live ────────────────────
  useEffect(() => {
    if (isArc || !containerRef.current) return;
    const ro = new ResizeObserver(() => { doEmbed(); });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [isArc, doEmbed]);

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className={`px-4 pt-4 pb-2 ${isArc ? "flex flex-col items-center" : ""}`}>
      {/* Loading skeleton */}
      {loading && (
        <div className="h-[300px] w-full rounded bg-white/[0.03] animate-pulse flex items-center justify-center">
          <span className="text-[11px] font-mono text-gray-600">Rendering chart…</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="min-h-[120px] w-full rounded border border-red-500/20 bg-red-500/5 flex flex-col items-center justify-center gap-2 p-4">
          <span className="text-[12px] font-mono text-red-400">⚠ Chart render failed</span>
          <span className="text-[11px] text-gray-500 max-w-sm text-center font-mono break-all">{error}</span>
        </div>
      )}

      {/* Vega-Lite canvas — always mounted, hidden until ready */}
      <div
        ref={containerRef}
        className={`transition-opacity duration-300 ${loading || error ? "opacity-0 h-0 overflow-hidden" : "opacity-100"
          } ${isArc ? "" : "w-full"}`}
      />

      {/* Row count caption */}
      {!loading && !error && block.row_count !== undefined && (
        <p className="mt-1.5 text-[10px] font-mono text-gray-600 text-right w-full">
          {block.data.length < block.row_count
            ? `Showing ${block.data.length.toLocaleString()} of ${block.row_count.toLocaleString()} rows`
            : `${block.row_count.toLocaleString()} rows`}
        </p>
      )}
    </div>
  );
}