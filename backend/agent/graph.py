import json
import re
import pandas as pd
from typing import Annotated, TypedDict, List, Union, Literal, Any, Dict, Optional
from pydantic import BaseModel, Field

from langchain_core.messages import BaseMessage, SystemMessage, ToolMessage
from langgraph.graph.message import add_messages
from langgraph.graph import StateGraph, END

from agent.llm_client import llm
from db.duck_db import get_artifact_read_path, get_duckdb_connection
from agent.state import AgentState
from agent.nodes.generator import generate_code_node
from agent.nodes.sandbox import execute_sandbox_node
from agent.nodes.narrator import narrator_node

# ──────────────────────────────────────────────────────────────────────────────
# 1. SCHEMAS
# ──────────────────────────────────────────────────────────────────────────────

class MarkdownBlock(BaseModel):
    """A pure text / explanation block."""
    type: Literal["markdown"]
    content: str = Field(description="Markdown or plain text to display.")


class SQLTableBlock(BaseModel):
    """Renders a SQL query result as a table."""
    type: Literal["table"]
    query: str = Field(description="DuckDB SQL query to fetch table rows.")
    explanation: str = Field(description="One-line description of what this table shows.")


class SQLChartBlock(BaseModel):
    """Renders a SQL query as a Vega-Lite chart. Use FLAT fields — do NOT nest a vega_spec object."""
    type: Literal["chart"]
    query: str  = Field(description="Aggregated DuckDB SQL query for this chart.")
    mark:  str  = Field(description="Vega-Lite mark: 'bar', 'line', 'point', 'arc' (pie/donut), 'rect'.")
    x_field: str = Field(description="Column name for the X axis (or 'theta' dimension for arc).")
    x_type:  str = Field(description="'nominal', 'ordinal', or 'quantitative'.")
    y_field: str = Field(description="Column name for the Y axis (or 'color' dimension for arc).")
    y_type:  str = Field(description="'quantitative', 'nominal', or 'ordinal'.")
    title:   str = Field(default="", description="Optional chart title.")
    explanation: str = Field(default="", description="One-line description of what this chart shows.")


class FinalReport(BaseModel):
    """Submit the final answer. Call ONLY after you have explored the data with explore_sql."""
    blocks: List[Union[MarkdownBlock, SQLTableBlock, SQLChartBlock]] = Field(
        description="List of UI blocks. Use 'markdown' for chat, 'table' for data, 'chart' for visualizations."
    )


class ExploreSQLInput(BaseModel):
    query: str = Field(description="DuckDB SQL query to execute")


class ExecutePython(BaseModel):
    """Trigger advanced Python analytics: EDA, correlation, forecasting, anomaly detection, hypothesis testing."""
    query: str = Field(description="The user's original request explaining what analytics to run.")


# ──────────────────────────────────────────────────────────────────────────────
# Helper: build a Vega-Lite spec from the flat SQLChartBlock fields
# ──────────────────────────────────────────────────────────────────────────────
def _build_vega_spec(block: dict) -> dict:
    """
    Accept the raw tool-call dict for a chart block and reconstruct a valid
    Vega-Lite v6 spec regardless of how the LLM structured the fields.
    """
    mark = (block.get("mark") or "bar").lower().strip()

    # Try flat x_field / y_field first (our schema), then fall back to
    # whatever the model sent (encoding, x, y keys).
    encoding_raw = block.get("encoding") or {}
    x_enc = encoding_raw.get("x") or {}
    y_enc = encoding_raw.get("y") or {}
    theta_enc = encoding_raw.get("theta") or {}
    color_enc = encoding_raw.get("color") or {}

    x_field = (block.get("x_field")
               or (x_enc.get("field") if isinstance(x_enc, dict) else x_enc)
               or block.get("x") or "")
    x_type  = (block.get("x_type")
               or (x_enc.get("type") if isinstance(x_enc, dict) else None)
               or "nominal")
    y_field = (block.get("y_field")
               or (y_enc.get("field") if isinstance(y_enc, dict) else y_enc)
               or block.get("y") or "")
    y_type  = (block.get("y_type")
               or (y_enc.get("type") if isinstance(y_enc, dict) else None)
               or "quantitative")

    if mark == "arc":
        # pie/donut: theta = quantity, color = category
        theta_field = (block.get("x_field") or block.get("y_field")
                       or (theta_enc.get("field") if isinstance(theta_enc, dict) else theta_enc)
                       or y_field)
        theta_type  = "quantitative"
        color_field = (block.get("y_field") or block.get("x_field")
                       or (color_enc.get("field") if isinstance(color_enc, dict) else color_enc)
                       or x_field)
        enc = {
            "theta": {"field": theta_field, "type": theta_type},
            "color": {"field": color_field, "type": "nominal"},
        }
    else:
        enc = {
            "x": {"field": x_field, "type": x_type, "axis": {"labelAngle": -30}},
            "y": {"field": y_field, "type": y_type},
        }
        # Also carry colour grouping if the model provided it
        if color_enc:
            enc["color"] = color_enc if isinstance(color_enc, dict) else {"field": color_enc, "type": "nominal"}

    spec: dict = {
        "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
        "mark":     mark,
        "encoding": enc,
    }

    # Also accept a pre-built vega_spec/spec/chart blob from the LLM as override
    pre = block.get("vega_spec") or block.get("spec") or block.get("chart")
    if isinstance(pre, dict) and pre:
        spec = pre   # honour the pre-built spec if present
        spec["$schema"] = "https://vega.github.io/schema/vega-lite/v6.json"

    title = block.get("title") or block.get("explanation") or ""
    if title:
        spec["title"] = title

    return spec


# ──────────────────────────────────────────────────────────────────────────────
# 2. DUCKDB EXECUTION ENGINE
# ──────────────────────────────────────────────────────────────────────────────
def _safe_view_name(dataset_name: str) -> str:
    name = dataset_name.lower().strip()
    name = re.sub(r"[^a-z0-9_]", "_", name)
    return re.sub(r"_+", "_", name).strip("_") or "data_table"


def _setup_duckdb_views(con, state: AgentState):
    """Set up views on an existing connection (reuse across multiple queries to avoid repeated INSTALL)."""
    if state.get("workspace_sources"):
        for source in state["workspace_sources"]:
            view_name = _safe_view_name(source["name"])
            if source["source_type"] in ["postgres_db", "mysql_db"]:
                db_ext = "postgres" if source["source_type"] == "postgres_db" else "mysql"
                con.execute(f"INSTALL {db_ext}; LOAD {db_ext};")
                con.execute(f"ATTACH '{source['connection_string']}' AS live_{view_name} (TYPE {db_ext})")
            elif source.get("artifact_url"):
                read_path = get_artifact_read_path(source["artifact_url"])
                safe_read_path = read_path.replace("'", "''")
                con.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet('{safe_read_path}')")
    else:
        if state.get("source_type") in ["postgres_db", "mysql_db"]:
            db_ext = "postgres" if state.get("source_type") == "postgres_db" else "mysql"
            con.execute(f"INSTALL {db_ext}; LOAD {db_ext};")
            con.execute(f"ATTACH '{state['connection_string']}' AS live_db (TYPE {db_ext})")
        else:
            artifact_url = state.get("artifact_url")
            if artifact_url:
                read_path = get_artifact_read_path(artifact_url)
                safe_read_path = read_path.replace("'", "''")
                con.execute(f"CREATE OR REPLACE VIEW data_table AS SELECT * FROM read_parquet('{safe_read_path}')")


def execute_duckdb_query(state: AgentState, query: str) -> pd.DataFrame:
    """Open a fresh connection, set up views, run one query, close. Used for explore_sql tool."""
    con = get_duckdb_connection()
    try:
        _setup_duckdb_views(con, state)
        return con.execute(query).df()
    finally:
        con.close()


# ──────────────────────────────────────────────────────────────────────────────
# 3. GRAPH NODES
# ──────────────────────────────────────────────────────────────────────────────
def reset_state_node(state: AgentState):
    """Resets ephemeral per-turn fields so stale checkpointed state doesn't leak into the new response."""
    return {
        "ui_blocks": None,  # append_block treats None as reset to []
        "df_json": None,
        "sandbox_result": None,
        "current_code": None,
        "error_trace": None,
    }


def agent_node(state: AgentState):
    print(f"[Agent] Invoking -- {len(state['messages'])} messages in state")
    sys_msg = SystemMessage(content=f"""You are an elite Data Analytics AI Assistant with access to three tools.

Available data schema:
{state.get('schema_context', 'No schema provided.')}

━━━ TOOL SELECTION GUIDE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[search] explore_sql
   Use this to test a DuckDB SQL query and see results before finalizing.
   Always call this first to validate your SQL before calling FinalReport.

[report] FinalReport (with chart/table/markdown blocks)
   Use this when the answer can be expressed with:
   - SQL queries (SELECT, GROUP BY, JOIN, WHERE, aggregate functions)
   - Simple counts, averages, rankings, distributions, filters
   - Any chart or visualization (bar, line, pie, scatter, heatmap)
   ALL visualizations go through FinalReport — never ExecutePython for charts.

[python] ExecutePython
   Use this ONLY when the task genuinely requires Python statistical libraries
   that cannot be replicated in SQL:
   - scipy.stats (pearsonr, spearmanr, ttest, chi2, anova)
   - sklearn (clustering, regression, classification, anomaly detection)
   - statsmodels (OLS, time series decomposition)
   - prophet (forecasting)
   Ask yourself: "Can SQL compute this?" → If yes, use FinalReport.
   If it needs a library function (p-values, ML model, algorithm), use ExecutePython.

━━━ CHART FORMAT (for FinalReport chart blocks) ━━━━━━━━━━━━━━━━━━━━
Use FLAT fields — do NOT write a nested Vega spec:
  type: "chart"
  mark: "bar" | "line" | "point" | "arc" | "rect"
  query: <aggregated SQL>
  x_field: <exact column name from query result>
  x_type: "nominal" | "ordinal" | "quantitative"
  y_field: <exact column name from query result>
  y_type: "nominal" | "ordinal" | "quantitative"
  title: <optional title>
  explanation: <one sentence>

━━━ RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Explore before report: always call explore_sql to validate SQL first.
2. Never give up on SQL errors — rewrite and retry.
3. Never apologize for SQL errors to the user — fix them silently.
4. Casual questions ("Hello", "What can you do?") → answer with a markdown block, no SQL.
5. ALWAYS end every FinalReport with a final markdown block that summarizes the key insights
   from the data in 2-3 concise sentences. This summary block MUST be the last block.
""")

    llm_with_tools = llm.bind_tools([
        {"name": "explore_sql",
         "description": "Execute a DuckDB SQL query to explore/validate data. Always call this before FinalReport.",
         "parameters": ExploreSQLInput.model_json_schema()},
        FinalReport,
        ExecutePython,
    ])

    response = llm_with_tools.invoke([sys_msg] + state["messages"])
    chosen = [tc["name"] for tc in getattr(response, "tool_calls", [])]
    print(f"[Agent] Tools chosen: {chosen or ['(none -- plain text)']}") 
    return {"messages": [response]}

def tools_node(state: AgentState):
    last_message = state["messages"][-1]
    tool_messages = []

    for tc in getattr(last_message, "tool_calls", []):
        if tc["name"] == "explore_sql":
            query = tc["args"].get("query")
            try:
                df = execute_duckdb_query(state, query)
                if len(df) > 50:
                    res = f"OK. {len(df)} rows. Top 50:\n" + df.head(50).to_markdown(index=False)
                else:
                    res = f"OK. {len(df)} rows:\n" + df.to_markdown(index=False)
            except Exception as e:
                res = f"SQL Error: {str(e)}\n\nCRITICAL INSTRUCTION: Do NOT tell the user about this error. You MUST rewrite the query and call explore_sql again to fix it!"

            tool_messages.append(ToolMessage(content=res, tool_call_id=tc["id"], name=tc["name"]))

    return {"messages": tool_messages}


def should_continue(state: AgentState) -> str:
    last_message = state["messages"][-1]
    if not hasattr(last_message, "tool_calls") or not last_message.tool_calls:
        return "render_report"
    if any(tc["name"] == "ExecutePython" for tc in last_message.tool_calls):
        return "generator"
    if any(tc["name"] == "FinalReport" for tc in last_message.tool_calls):
        return "render_report"
    return "tools"


def _extract_text_content(content) -> str:
    """Safely extract text from a LangChain message content that may be a string OR a list of parts (Gemini format)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                parts.append(part.get("text", "") or str(part.get("content", "")))
            else:
                parts.append(str(part))
        return " ".join(p for p in parts if p)
    return str(content) if content else ""


# ──────────────────────────────────────────────────────────────────────────────
# Normalize whatever the LLM sends into one of our canonical block types
# ──────────────────────────────────────────────────────────────────────────────
_MARKDOWN_TYPES = {"markdown", "markdownblock", "text", "plain", "message", "response"}
_TABLE_TYPES    = {"table",    "tableblock",    "sqltableblock", "sql_table"}
_CHART_TYPES    = {"chart",    "chartblock",    "sqlchartblock", "sql_chart",
                   "bar",      "line",          "scatter",       "pie",
                   "histogram","heatmap",       "area",          "boxplot"}


def _normalize_type(b_type: str | None) -> str:
    """Map whatever the LLM produces to 'markdown', 'table', or 'chart'."""
    if b_type is None:
        return "markdown"
    t = b_type.lower().strip()
    if t in _MARKDOWN_TYPES:
        return "markdown"
    if t in _TABLE_TYPES:
        return "table"
    if t in _CHART_TYPES:
        return "chart"
    return "unknown"


def _apply_dark_theme(spec: dict, is_arc: bool) -> dict:
    if is_arc:
        spec["width"]    = 300
        spec["height"]   = 300
        spec["autosize"] = {"type": "fit", "contains": "padding"}
    else:
        spec["width"] = "container"
        spec.setdefault("height", 300)
    spec.setdefault("padding", {"left": 20, "top": 20, "right": 20, "bottom": 40})
    spec.setdefault("config", {})
    spec["config"].update({
        "background": "#111111",
        "view":   {"stroke": "transparent"},
        "axis":   {"gridColor": "#2a2a2a", "tickColor": "#3a3a3a",
                   "labelColor": "#9ca3af", "titleColor": "#6b7280",
                   "domainColor": "#2a2a2a", "labelAngle": 0},
        "legend": {"labelColor": "#9ca3af", "titleColor": "#6b7280"},
        "title":  {"color": "#d1d5db"},
        "arc":    {"stroke": "#111111", "strokeWidth": 1.5},
    })
    return spec


def render_report_node(state: AgentState):
    last_message = state["messages"][-1]
    ui_blocks = []

    # ── Plain text (no tool calls at all) ────────────────────────────────────
    if not getattr(last_message, "tool_calls", None):
        text = _extract_text_content(last_message.content)
        print(f"[Render] plain text ({len(text)} chars)")
        ui_blocks.append({"type": "markdown", "content": text.strip() or "*(no response)*"})
        return {"ui_blocks": ui_blocks}

    tool_call = next((tc for tc in last_message.tool_calls if tc["name"] == "FinalReport"), None)
    if not tool_call:
        print("[Render] no FinalReport found in tool_calls")
        return {"ui_blocks": ui_blocks}

    blocks_raw = tool_call["args"].get("blocks", [])
    raw_types  = [b.get("type") for b in blocks_raw]
    print(f"[Render] {len(blocks_raw)} blocks | raw types: {raw_types}")

    # ── ONE DuckDB connection for all queries in this report ────────────────
    con = get_duckdb_connection()
    try:
        _setup_duckdb_views(con, state)
        seen_queries: set = set()

        for block in blocks_raw:
            raw_type  = block.get("type")
            norm_type = _normalize_type(raw_type)
            print(f"  → raw={repr(raw_type)} → norm={norm_type} | keys={list(block.keys())}")

            # ── Markdown ──────────────────────────────────────────────────────
            if norm_type == "markdown":
                # Accept content under ANY key the model may use
                text = (block.get("content") or block.get("text")
                        or block.get("markdown") or block.get("message")
                        or block.get("value") or block.get("body") or "")
                if not text:
                    text = " ".join(str(v) for k, v in block.items()
                                   if k not in ("type",) and isinstance(v, str))
                if text:
                    ui_blocks.append({"type": "markdown", "content": text})
                    print(f"    [OK] markdown ({len(text)} chars)")

            # ── Table ─────────────────────────────────────────────────────
            elif norm_type == "table":
                if block.get("explanation"):
                    ui_blocks.append({"type": "markdown", "content": block["explanation"]})
                query = block.get("query", "")
                try:
                    df = con.execute(query).df()
                    df = df.where(pd.notnull(df), None)
                    if query not in seen_queries:
                        ui_blocks.append({"type": "code", "language": "sql", "content": query})
                        seen_queries.add(query)
                    warning = f"Showing 100 of {len(df)} rows" if len(df) > 100 else None
                    ui_blocks.append({
                        "type": "table",
                        "columns": df.columns.tolist(),
                        "data":    df.head(100).to_dict(orient="records"),
                        "warning": warning,
                    })
                    print(f"    [OK] table {len(df)} rows")
                except Exception as e:
                    print(f"    [ERR] table error: {e}")
                    ui_blocks.append({"type": "markdown", "content": f"**SQL Error:** `{e}`"})

            # ── Chart ─────────────────────────────────────────────────────
            elif norm_type == "chart":
                query = block.get("query") or block.get("sql") or block.get("sql_query") or ""
                if not query or not query.strip():
                    print(f"    [WARN] chart block has no query. keys={list(block.keys())}")
                    ui_blocks.append({"type": "markdown",
                                      "content": "Chart block had no SQL query -- model forgot to include it."})
                    continue
                try:
                    result = con.execute(query)
                    if result is None:
                        raise ValueError(f"DuckDB returned None for query: {query[:80]}")
                    df = result.df()
                    df = df.where(pd.notnull(df), None)
                    print(f"    [OK] chart query {len(df)} rows, cols={df.columns.tolist()}")

                    # Track chart queries in seen_queries but do NOT prepend a SQL code block.
                    # Charts are self-explanatory; only table blocks need the SQL header.
                    seen_queries.add(query)

                    # Build spec from flat fields — tolerates whatever structure the LLM used
                    spec = _build_vega_spec(block)
                    mark_raw  = spec.get("mark", "")
                    mark_type = mark_raw.get("type", mark_raw) if isinstance(mark_raw, dict) else mark_raw
                    spec = _apply_dark_theme(spec, is_arc=(mark_type == "arc"))

                    print(f"    [OK] chart mark={mark_type}")
                    ui_blocks.append({
                        "type":        "chart",
                        "spec":        spec,
                        "data":        df.head(1000).to_dict(orient="records"),
                        "row_count":   len(df),
                        "explanation": block.get("explanation", ""),
                        "query":       query,
                    })
                except Exception as e:
                    print(f"    [ERR] chart error: {e}")
                    ui_blocks.append({"type": "markdown", "content": f"**Render Error:** `{e}`"})

            else:
                print(f"    [SKIP] unrecognized block type {repr(raw_type)} -- skipped")

    finally:
        con.close()

    print(f"[Render] done -> {len(ui_blocks)} ui_block(s)")
    tool_msg = ToolMessage(tool_call_id=tool_call["id"], content="Report rendered.", name="FinalReport")
    return {"messages": [tool_msg], "ui_blocks": ui_blocks}

# ──────────────────────────────────────────────────────────────────────────────
# 5. COMPILE GRAPH
# ──────────────────────────────────────────────────────────────────────────────
workflow = StateGraph(AgentState)

workflow.add_node("reset_state", reset_state_node)
workflow.add_node("agent",       agent_node)
workflow.add_node("tools",       tools_node)
workflow.add_node("render_report", render_report_node)
workflow.add_node("generator",   generate_code_node)
workflow.add_node("sandbox",     execute_sandbox_node)
workflow.add_node("narrator",    narrator_node)

workflow.set_entry_point("reset_state")
workflow.add_edge("reset_state", "agent")

workflow.add_conditional_edges("agent", should_continue, {
    "tools":         "tools",
    "render_report": "render_report",
    "generator":     "generator",
})
workflow.add_edge("tools",       "agent")
workflow.add_edge("generator",   "sandbox")
workflow.add_edge("sandbox",     "narrator")
workflow.add_edge("narrator",    END)
workflow.add_edge("render_report", END)

data_agent = workflow.compile()
