import io
import re
import json
import pandas as pd
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage
from agent.state import AgentState
from agent.llm_client import llm
from db.duck_db import get_artifact_read_path, get_duckdb_connection

MAX_SANDBOX_ROWS = 2000  # More rows for analytics; sandbox can handle it


class PythonCodeExecution(BaseModel):
    thinking: str = Field(description="Step by step reasoning: which columns to use, which algorithm fits, and how to structure result_dict.")
    code: str = Field(description="The Python code. MUST assign the final findings to a dict variable named `result_dict`.")


SYSTEM_PROMPT = """You are an elite Data Scientist Agent.
Your task is to write Python code to perform advanced analytics on a Pandas DataFrame named `df`.

LIBRARIES PRE-IMPORTED in the execution environment:
- `df` — pandas DataFrame already loaded. DO NOT try to read a file.
- `pd` (pandas), `np` (numpy)
- `scipy`, `scipy.stats` (as `stats`)
- `sklearn`
- `sm` (statsmodels.api)
- `Prophet` (from prophet)

STRICT RULES:
1. `df` is already loaded — do NOT read from disk or fetch from any URL.
2. All code runs in a sandboxed container with a strict 60-second timeout.
3. You MUST assign all final statistical findings to a variable called `result_dict`.
4. `result_dict` must ONLY contain JSON-serializable types: int, float, str, list, dict.
   - Convert numpy arrays: `.tolist()`
   - Convert datetime: `str(val)`
   - DO NOT store model objects, DataFrames, or Series directly in result_dict.
5. DO NOT import matplotlib, seaborn, or plot anything. Return only numbers/text.

CORRECT PATTERN:
```python
from scipy import stats
corr, p_value = stats.pearsonr(df['col_a'].dropna(), df['col_b'].dropna())
result_dict = {
    "metric": "Pearson Correlation",
    "correlation": round(float(corr), 4),
    "p_value": round(float(p_value), 6),
    "significant": bool(p_value < 0.05)
}
```
"""


def _safe_view_name(name: str) -> str:
    n = name.lower().strip()
    n = re.sub(r"[^a-z0-9_]", "_", n)
    return re.sub(r"_+", "_", n).strip("_") or "data_table"


def _fetch_df(state: AgentState) -> pd.DataFrame | None:
    """Fetch data from the source using DuckDB — same approach as sql_executor_node."""
    workspace_sources = state.get("workspace_sources")
    con = get_duckdb_connection()
    try:
        if workspace_sources:
            # Workspace mode — union all source DataFrames
            dfs = []
            for source in workspace_sources:
                view_name = _safe_view_name(source["name"])
                try:
                    if source.get("artifact_url"):
                        read_path = get_artifact_read_path(source["artifact_url"])
                        safe_read_path = read_path.replace("'", "''")
                        con.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet('{safe_read_path}')")
                        dfs.append(con.execute(f"SELECT * FROM {view_name} LIMIT {MAX_SANDBOX_ROWS}").df())
                except Exception as e:
                    print(f"🐍 [Generator] Could not load view '{view_name}': {e}")
            return pd.concat(dfs, ignore_index=True) if dfs else None
        else:
            artifact_url = state.get("artifact_url")
            if not artifact_url:
                print("🐍 [Generator] No artifact_url in state — cannot load data.")
                return None
            read_path = get_artifact_read_path(artifact_url)
            safe_read_path = read_path.replace("'", "''")
            con.execute(f"CREATE OR REPLACE VIEW data_table AS SELECT * FROM read_parquet('{safe_read_path}')")
            return con.execute(f"SELECT * FROM data_table LIMIT {MAX_SANDBOX_ROWS}").df()
    except Exception as e:
        print(f"🐍 [Generator] DuckDB fetch failed: {e}")
        return None
    finally:
        con.close()


def generate_code_node(state: AgentState):
    print("🐍 [Generator Node] Generating Python analytics code...")

    messages = state.get("messages", [])

    # Use pre-existing df_json if already populated (e.g. from prior sql_executor run)
    df_json = state.get("df_json")
    df = None

    if df_json:
        try:
            df = pd.read_json(io.StringIO(df_json), orient="split")
            print(f"🐍 [Generator Node] Using existing df_json ({len(df)} rows)")
        except Exception as e:
            print(f"🐍 [Generator Node] df_json parse failed: {e}")
            df = None

    if df is None or df.empty:
        print("🐍 [Generator Node] df_json absent or empty — fetching from source...")
        df = _fetch_df(state)

    if df is None or df.empty:
        print("🐍 [Generator Node] Could not load any data. Aborting.")
        return {
            "current_code": None,
            "df_json": None,
            "sandbox_result": {"status": "error", "error": "No dataset available for Python analysis. Run a SQL query first to load data, or check that the data source is configured correctly."}
        }

    # Build schema description for the LLM
    schema_lines = []
    for col in df.columns:
        dtype = str(df[col].dtype)
        n_unique = df[col].nunique()
        samples = df[col].dropna().head(3).tolist()
        schema_lines.append(f"  - {col} ({dtype}, {n_unique} unique): e.g. {samples}")
    schema_text = "\n".join(schema_lines)

    # Capture user's analytical question
    user_question = ""
    for msg in reversed(messages):
        if hasattr(msg, "type") and msg.type == "human":
            user_question = msg.content
            break

    human_prompt = (
        f"User question: {user_question}\n\n"
        f"DataFrame `df` schema ({len(df)} rows, {len(df.columns)} columns):\n{schema_text}\n\n"
        f"Write Python code to perform this analysis. Store all findings in `result_dict`."
    )

    try:
        structured_llm = llm.with_structured_output(PythonCodeExecution)
        result: PythonCodeExecution = structured_llm.invoke([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=human_prompt),
        ])

        print(f"🐍 [Generator Node] Code generated ({len(result.code)} chars). Thinking: {result.thinking[:80]}...")

        # Serialize the freshly loaded df so sandbox_node can pass it to the worker
        fresh_df_json = df.to_json(orient="split", date_format="iso")

        return {
            "current_code": result.code,
            "df_json": fresh_df_json,
        }

    except Exception as e:
        print(f"🐍 [Generator Node] LLM failed: {e}")
        return {"current_code": None}
