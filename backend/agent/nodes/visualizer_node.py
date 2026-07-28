import io
import json
import pandas as pd
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage
from agent.state import AgentState
from agent.nodes.router import llm

MAX_CHART_ROWS = 500

_VEGA_KEYS = {"mark", "encoding", "layer", "facet", "hconcat", "vconcat", "transform"}

# Keywords that signal an explicit chart type request from the user
CHART_KEYWORDS = {
    "bar":     ["bar chart", "bar graph", "bar plot"],
    "line":    ["line chart", "line graph", "line plot", "trend line"],
    "area":    ["area chart", "area graph", "area plot"],
    "point":   ["scatter", "scatter plot", "scatter chart", "scatterplot"],
    "arc":     ["pie chart", "pie graph", "donut chart", "donut", "pie"],
    "boxplot": ["box plot", "boxplot", "box chart", "box and whisker"],
    "rect":    ["heatmap", "heat map"],
}


class VegaLiteSpec(BaseModel):
    chart_type_reasoning: str = Field(
        ...,
        description=(
            "Think step by step: what is the user trying to understand? "
            "What are the column types and cardinalities? "
            "Did the user explicitly request a chart type? If yes, use that. "
            "If not, what chart type best reveals the insight and why?"
        )
    )
    spec: dict = Field(
        ...,
        description=(
            "REQUIRED. The complete Vega-Lite v5 JSON object nested under this key. "
            "Must contain: '$schema', 'data', 'mark', 'encoding', 'width', 'height', 'config'. "
            "NEVER place 'mark', 'encoding', or 'config' at the top level of the tool call."
        ),
    )
    skip: bool = Field(
        False,
        description="Set true ONLY when data is completely non-visualizable (single text value, empty, etc).",
    )
    reason: str = Field("", description="If skip=true, one sentence explaining why.")


DARK_CONFIG = """{
  "background": "#111111",
  "view": {"stroke": "transparent"},
  "axis": {
    "gridColor": "#2a2a2a", "tickColor": "#3a3a3a", "labelColor": "#9ca3af",
    "titleColor": "#6b7280", "domainColor": "#2a2a2a",
    "labelFont": "monospace", "titleFont": "monospace",
    "labelFontSize": 11, "titleFontSize": 11
  },
  "legend": {
    "labelColor": "#9ca3af", "titleColor": "#6b7280",
    "labelFont": "monospace", "titleFont": "monospace", "labelFontSize": 11
  },
  "title": {"color": "#d1d5db", "font": "monospace", "fontSize": 12},
  "arc": {"stroke": "#111111", "strokeWidth": 1.5},
  "bar": {"cornerRadiusTopLeft": 3, "cornerRadiusTopRight": 3},
  "point": {"filled": true, "size": 60},
  "line": {"strokeWidth": 2}
}"""


VEGA_SYSTEM_PROMPT = f"""\
You are an expert data visualization engineer.

TOOL CALL STRUCTURE — this exact shape is required:
{{
  "chart_type_reasoning": "...",
  "spec": {{
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "data": {{"name": "table"}},
    "mark": ...,
    "encoding": {{...}},
    "width": "container",
    "height": 280,
    "config": {DARK_CONFIG}
  }},
  "skip": false,
  "reason": ""
}}

THE "spec" KEY IS MANDATORY. "mark" and "encoding" go INSIDE "spec", never at the top level.

CHART TYPE SELECTION — TWO MODES:

MODE 1 — USER SPECIFIED A CHART TYPE:
If the human prompt contains "⚠️ OVERRIDE", you MUST use exactly that mark type. No exceptions.

MODE 2 — AUTO SELECT (no override):
Pick the most insightful chart type for the data. Do NOT default to bar.
- Two continuous numerics + correlation question → point (scatter)
- Temporal/sequential x-axis + trend question → line or area
- Single numeric distribution → bar with bin transform (histogram)
- Grouped distribution → boxplot
- Few categories + proportion/share question → arc (pie/donut)
- Two categoricals + one numeric → rect (heatmap)
- Many categories (>8) or long names + ranking → horizontal bar (swap x/y, sort)
- Small number of discrete categories, no better option → bar

SPEC RULES (both modes):
1. "data": {{"name": "table"}} — always, never inline data
2. Use EXACT column names from the schema (case-sensitive)
3. "width": "container", "height": 280
4. For arc: theta + color encodings; "innerRadius": 50 for donut style
5. For time columns: use timeUnit (year, month, yearmonth, date, etc)
6. Large numeric axes: axis {{"format": "~s"}} for SI suffixes (1M, 500k, etc)
7. Single-series color: {{"value": "#60a5fa"}}. Multi-series: "scheme": "tableau10"
8. Add a descriptive "title" field to the spec
"""


def _detect_requested_chart(user_question: str) -> str | None:
    """Returns a Vega-Lite mark type if the user explicitly named a chart, else None."""
    q = user_question.lower()
    for mark_type, keywords in CHART_KEYWORDS.items():
        if any(kw in q for kw in keywords):
            return mark_type
    return None


def _rescue_bare_spec(raw: dict) -> dict | None:
    if not _VEGA_KEYS.intersection(raw.keys()):
        return None
    rescued = {k: v for k, v in raw.items() if k not in ("skip", "reason", "chart_type_reasoning")}
    rescued["data"] = {"name": "table"}
    print("📊 [Visualizer] Rescued bare spec from flat tool-call output.")
    return rescued


def generate_visuals(state: AgentState):
    print("📊 [Visualizer] Generating Vega-Lite spec via LLM...")

    df_json  = state.get("df_json")
    messages = state.get("messages", [])

    if not df_json:
        print("📊 [Visualizer] No df_json — skipping.")
        return {}

    try:
        df = pd.read_json(io.StringIO(df_json), orient="split")
    except Exception as e:
        print(f"📊 [Visualizer] df deserialization failed: {e}")
        return {}

    if df.empty:
        print("📊 [Visualizer] Empty DataFrame — skipping.")
        return {}

    total_rows = len(df)

    schema_lines = []
    for col in df.columns:
        dtype = str(df[col].dtype)
        n_unique = df[col].nunique()
        samples = df[col].dropna().head(3).tolist()
        schema_lines.append(f"  - {col} ({dtype}, {n_unique} unique): e.g. {samples}")
    schema_text = "\n".join(schema_lines)

    sample_text = json.dumps(df.head(10).to_dict(orient="records"), default=str, indent=2)

    user_question = ""
    for msg in reversed(messages):
        if hasattr(msg, "type") and msg.type == "human":
            user_question = msg.content
            break

    # ── Mode detection ────────────────────────────────────────────────────────
    requested_chart = _detect_requested_chart(user_question)

    if requested_chart:
        chart_instruction = (
            f"⚠️ OVERRIDE: The user explicitly requested a {requested_chart.upper()} chart. "
            f'You MUST set mark to "{requested_chart}". Do not choose a different chart type.'
        )
        print(f"📊 [Visualizer] User requested: {requested_chart}")
    else:
        chart_instruction = (
            "No chart type was specified — use MODE 2 (AUTO SELECT) to pick the best type for this data."
        )
        print("📊 [Visualizer] Auto-selecting chart type...")

    human_prompt = (
        f'User question: "{user_question}"\n\n'
        f"{chart_instruction}\n\n"
        f"Result schema ({total_rows} rows, {len(df.columns)} columns):\n{schema_text}\n\n"
        f"Sample data (first 10 rows):\n{sample_text}\n\n"
        f'Remember: "spec" wraps the entire Vega-Lite object. mark/encoding go inside spec, not at the top level.'
    )

    try:
        structured_llm = llm.with_structured_output(VegaLiteSpec)
        result: VegaLiteSpec = structured_llm.invoke([
            SystemMessage(content=VEGA_SYSTEM_PROMPT),
            HumanMessage(content=human_prompt),
        ])

        if result.skip:
            print(f"📊 [Visualizer] Skipping: {result.reason}")
            return {}

        print(f"📊 [Visualizer] Reasoning: {result.chart_type_reasoning[:120]}...")
        spec = result.spec

    except Exception as e:
        error_str = str(e)
        print(f"📊 [Visualizer] Structured output failed: {error_str}")
        try:
            import re
            match = re.search(r"'failed_generation':\s*'<function=\w+>(\{.*\})'", error_str, re.DOTALL)
            if not match:
                match = re.search(r'"failed_generation":\s*"<function=\w+>(\{.*?\})"', error_str, re.DOTALL)
            if match:
                raw = json.loads(match.group(1))
                spec = _rescue_bare_spec(raw)
                if spec is None:
                    return {}
            else:
                return {}
        except Exception as rescue_err:
            print(f"📊 [Visualizer] Rescue threw: {rescue_err}")
            return {}

    spec["data"] = {"name": "table"}

    chart_data = df.head(MAX_CHART_ROWS).to_dict(orient="records")
    chart_block = {
        "type": "chart",
        "spec": spec,
        "data": chart_data,
        "row_count": total_rows,
    }

    mark = spec.get("mark", "")
    mark_type = mark.get("type", mark) if isinstance(mark, dict) else mark
    print(f"📊 [Visualizer] Done. Mark type: {mark_type}")

    return {"ui_blocks": [chart_block]}