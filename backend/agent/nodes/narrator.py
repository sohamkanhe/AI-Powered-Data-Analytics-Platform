import json
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

from agent.state import AgentState
from agent.llm_client import llm

from typing import Optional, Literal, List


class MetricCard(BaseModel):
    label: str = Field(description="Short human-readable label (e.g. 'R² Score', 'p-value', 'Anomaly Count')")
    value: str = Field(description="Formatted value (e.g. '0.85', '< 0.05', '14')")
    trend: Literal["up", "down", "neutral"] = Field("neutral", description="'up', 'down', or 'neutral'.")


class MetricsGrid(BaseModel):
    title: str = Field("Key Metrics", description="Title for the metric cards")
    cards: list[MetricCard]


class ChartModel(BaseModel):
    title: str = Field(description="Chart title")
    mark:  str = Field(description="Vega-Lite mark: 'bar', 'line', 'point', 'rect', 'arc', 'area'")
    x_field: str = Field(description="Field name for X axis")
    x_type:  str = Field(description="'nominal', 'ordinal', or 'quantitative'")
    y_field: str = Field(description="Field name for Y axis (or value field for rect heatmap)")
    y_type:  str = Field(description="'quantitative', 'nominal', or 'ordinal'")
    color_field: Optional[str] = Field(None, description="Optional field for color/fill (e.g. for heatmap: the correlation value field)")
    data: list[dict] = Field(description="FLAT array of dicts. Each dict must have EXACTLY the field names you specified in x_field, y_field, color_field.")


class UIBlockLayout(BaseModel):
    type: Literal["markdown", "metrics", "chart"] = Field(description="Exactly one of: 'markdown', 'metrics', 'chart'")
    markdown_content: Optional[str] = Field(None, description="Markdown text if type is markdown")
    metrics_grid:     Optional[MetricsGrid] = Field(None, description="Metrics grid if type is metrics")
    chart:            Optional[ChartModel]  = Field(None, description="Chart config if type is chart")


class NarrationOutput(BaseModel):
    blocks: list[UIBlockLayout] = Field(
        description="A sequence of UI blocks (markdown, metrics, chart) presenting the findings."
    )


def _build_narrator_spec(c: ChartModel) -> dict:
    """Build a Vega-Lite v6 spec from the flat ChartModel fields."""
    mark = c.mark.lower().strip()

    if mark == "rect":
        # Heatmap — x, y are category axes, color encodes the value
        color_f = c.color_field or "value"
        enc = {
            "x":       {"field": c.x_field, "type": c.x_type,  "axis": {"labelAngle": -30}},
            "y":       {"field": c.y_field, "type": c.y_type},
            "color":   {"field": color_f,   "type": "quantitative",
                        "scale": {"scheme": "blues"}},
            "tooltip": {"content": "data"},
        }
    elif mark == "arc":
        enc = {
            "theta":   {"field": c.y_field, "type": "quantitative"},
            "color":   {"field": c.x_field, "type": "nominal"},
            "tooltip": {"content": "data"},
        }
    else:
        enc = {
            "x":       {"field": c.x_field, "type": c.x_type, "axis": {"labelAngle": -30}},
            "y":       {"field": c.y_field, "type": c.y_type},
            "tooltip": {"content": "data"},
        }
        if c.color_field:
            enc["color"] = {"field": c.color_field, "type": "nominal"}

    spec: dict = {
        "$schema":  "https://vega.github.io/schema/vega-lite/v6.json",
        "mark":     mark,
        "encoding": enc,
    }
    if c.title:
        spec["title"] = c.title

    # Size
    if mark == "arc":
        spec["width"]    = 280
        spec["height"]   = 280
        spec["autosize"] = {"type": "fit", "contains": "padding"}
    else:
        spec["width"]  = "container"
        spec["height"] = 300

    return spec


def narrator_node(state: AgentState):
    print("🗣️ [Narrator] Interpreting sandbox results...")

    sandbox_result = state.get("sandbox_result")
    messages       = state.get("messages", [])

    if not sandbox_result or sandbox_result.get("status") != "success":
        error_msg = (
            sandbox_result.get("error", "Unknown error")
            if sandbox_result else "No sandbox result available."
        )
        return {
            "ui_blocks": [{"type": "markdown",
                           "content": f"⚠️ **Python Execution Failed:**\n\n```\n{error_msg}\n```"}]
        }

    result_dict = sandbox_result.get("result", {})
    exec_time   = sandbox_result.get("execution_time", "?")

    user_question = ""
    for msg in reversed(messages):
        if hasattr(msg, "type") and msg.type == "human":
            user_question = msg.content
            break

    system_prompt = (
        "You are an expert Data Visualizer and Business Analyst.\n"
        "Take raw statistical/ML findings from a Python sandbox and design a clear, beautiful report.\n\n"
        "Output `blocks` using exactly these types:\n"
        "- `markdown`: Narrative insights, 'so what?' conclusions. Use markdown formatting.\n"
        "- `metrics`: Key numbers as metric cards (e.g. correlation coefficient, p-value, R²).\n"
        "- `chart`: A visualization using FLAT fields (not a full Vega spec object).\n\n"
        "CHART RULES — VERY IMPORTANT:\n"
        "1. Use flat fields: mark, x_field, x_type, y_field, y_type, color_field (optional).\n"
        "   Do NOT write out a Vega-Lite JSON spec — just set the field names and mark type.\n"
        "2. `data` MUST be a flat array of plain dicts.\n"
        "   Each dict must have EXACTLY the keys you named in x_field, y_field, and color_field.\n"
        "   Example for correlation heatmap: [{\"var1\": \"price\", \"var2\": \"area\", \"correlation\": 0.73}, ...]\n"
        "3. Mark types:\n"
        "   - 'bar'  → compare categories\n"
        "   - 'line' → trends over time\n"
        "   - 'rect' → heatmap / correlation matrix (x=var1, y=var2, color_field=correlation)\n"
        "   - 'point'→ scatter plot\n"
        "   - 'arc'  → pie/donut\n"
        "   - 'area' → filled line chart\n"
        "4. For CORRELATION MATRIX: set mark='rect', x_field='var1', y_field='var2', "
        "   color_field='correlation'. Extract ALL pairs from the matrix dict into `data`.\n"
        "5. Always generate at least one chart if the data supports visualization."
    )

    human_prompt = (
        f"User question: {user_question}\n\n"
        f"Python sandbox output:\n{json.dumps(result_dict, indent=2)}\n\n"
        "Design the presentation layout blocks."
    )

    try:
        structured_llm = llm.with_structured_output(NarrationOutput)
        result: NarrationOutput = structured_llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_prompt),
        ])

        ui_blocks = []
        raw_ai_narration = ""

        for b in result.blocks:
            if b.type == "markdown" and b.markdown_content:
                ui_blocks.append({"type": "markdown", "content": b.markdown_content})
                raw_ai_narration += b.markdown_content + "\n\n"

            elif b.type == "metrics" and b.metrics_grid:
                ui_blocks.append({
                    "type":    "metrics",
                    "title":   b.metrics_grid.title,
                    "metrics": [c.model_dump() for c in b.metrics_grid.cards],
                })

            elif b.type == "chart" and b.chart:
                c    = b.chart
                spec = _build_narrator_spec(c)
                print(
                    f"🗣️ [Narrator] chart | mark={c.mark} x={c.x_field}/{c.x_type} "
                    f"y={c.y_field}/{c.y_type} color={c.color_field} "
                    f"rows={len(c.data)} sample={c.data[:2]}"
                )
                ui_blocks.append({
                    "type":        "chart",
                    "spec":        spec,
                    "data":        c.data,
                    "row_count":   len(c.data),
                    "explanation": c.title,
                    "query":       "",
                })

        # Raw output collapsible
        raw_json_str = json.dumps(result_dict, indent=2)
        ui_blocks.append({
            "type":    "markdown",
            "content": (
                f"<details><summary>🔬 View Raw Statistical Output "
                f"(computed in {exec_time}s)</summary>\n\n```json\n{raw_json_str}\n```\n\n</details>"
            ),
        })

        ai_msg = AIMessage(content=raw_ai_narration.strip() or "Analysis complete.")
        print(f"🗣️ [Narrator] Done. Emitting {len(ui_blocks)} blocks.")
        return {"ui_blocks": ui_blocks, "messages": [ai_msg]}

    except Exception as e:
        print(f"🗣️ [Narrator] Generation failed: {e}")
        return {"ui_blocks": [{
            "type":    "markdown",
            "content": f"⚠️ **Narration failed.** Code ran OK but insights could not be interpreted.\n\n`{e}`",
        }]}
