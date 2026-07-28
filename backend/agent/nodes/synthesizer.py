import io
import json
import pandas as pd
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from agent.state import AgentState
from agent.nodes.router import llm


class InsightGeneration(BaseModel):
    summary: str = Field(
        ...,
        description=(
            "1-2 sentence plain-English explanation of what the result shows. "
            "No SQL jargon. Reference actual numbers or patterns."
        )
    )
    insights: list[str] = Field(
        ...,
        description="2-4 specific, concrete observations from the data. Each should highlight something notable.",
        min_length=1,
        max_length=4,
    )


def _compact_stats(df_json: str, ui_blocks: list) -> str:
    lines = []
    try:
        df = pd.read_json(io.StringIO(df_json), orient="split")
        lines.append(f"Shape: {len(df)} rows x {len(df.columns)} columns")
        lines.append(f"Columns: {', '.join(df.columns.tolist())}")
        numeric_cols = df.select_dtypes(include="number").columns.tolist()
        for col in numeric_cols[:4]:
            s = df[col].dropna()
            if len(s):
                lines.append(
                    f"{col}: min={s.min():.3g}, max={s.max():.3g}, "
                    f"mean={s.mean():.3g}, median={s.median():.3g}"
                )
        lines.append(f"\nSample (top 5 rows):\n{df.head(5).to_string(index=False)}")
    except Exception:
        for block in ui_blocks:
            if block.get("type") == "table":
                lines.append(f"Columns: {', '.join(block.get('columns', []))}")
                lines.append(f"Rows shown: {len(block.get('data', []))}")
                break
    return "\n".join(lines)


def synthesize_node(state: AgentState):
    """
    Generates an insight markdown block and returns ONLY that block.
    The append_block reducer accumulates it on top of blocks from previous nodes.
    Final order in ui_blocks will be: [sql, table, chart, insight].
    The API layer should reverse or the frontend should render insight first.
    """
    print("🧠 [Synthesizer] Generating explanation and insights...")

    if state.get("attempt_count", 0) >= 3:
        return {
            "ui_blocks": [{
                "type": "markdown",
                "content": (
                    "⚠️ **Execution Failed**\n\n"
                    "The agent hit a persistent error after 3 attempts. "
                    "Try rephrasing your question or simplifying the request."
                ),
            }]
        }

    ui_blocks = state.get("ui_blocks", [])
    df_json   = state.get("df_json")
    messages  = state.get("messages", [])

    if not ui_blocks:
        return {}

    user_question = ""
    for msg in reversed(messages):
        if hasattr(msg, "type") and msg.type == "human":
            user_question = msg.content
            break

    stats_text = _compact_stats(df_json, ui_blocks) if df_json else "(no data summary available)"

    system_prompt = (
        "You are a senior data analyst explaining results to a business stakeholder.\n"
        "You will receive: the user's question + a compact stats summary of the result.\n\n"
        "Rules:\n"
        "- Be specific: reference actual numbers, columns, or patterns\n"
        "- Never use SQL terms like 'query', 'table', 'SELECT', 'JOIN'\n"
        "- Insights must be concrete, not generic\n"
        "- Keep it concise. No fluff."
    )

    human_prompt = (
        f"User question: {user_question}\n\n"
        f"Result summary:\n{stats_text}\n\n"
        f"Generate the summary and key insights."
    )

    try:
        structured_llm = llm.with_structured_output(InsightGeneration)
        result: InsightGeneration = structured_llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_prompt),
        ])

        bullets = "\n".join(f"- {i}" for i in result.insights)
        insight_content = (
                f"**Analysis**\n\n{result.summary}\n\n"
                f"**Key Insights**\n\n{bullets}"
            )
        insight_block = {
            "type": "markdown",
            "content": insight_content,
        }

        ai_message = AIMessage(content=insight_content)

        # Return ONLY the insight block — append_block reducer handles accumulation.
        # Do NOT re-emit ui_blocks from state here or they will be duplicated.
        print(f"🧠 [Synthesizer] Done. Emitting insight block.")
        return {"ui_blocks": [insight_block], "messages": [ai_message]}

    except Exception as e:
        print(f"🧠 [Synthesizer] Insight generation failed (non-fatal): {e}")
        return {}