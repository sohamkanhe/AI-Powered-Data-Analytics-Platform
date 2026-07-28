import re
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage
from agent.state import AgentState
from agent.nodes.router import llm
from db.duck_db import get_duckdb_connection


class SQLGeneration(BaseModel):
    query: str = Field(..., description="A valid DuckDB SQL query.")


def _safe_view_name(dataset_name: str) -> str:
    name = dataset_name.lower().strip()
    name = re.sub(r"[^a-z0-9_]", "_", name)
    name = re.sub(r"_+", "_", name)
    return name.strip("_") or "data_table"


def _fetch_single_schema(artifact_url: str) -> str:
    con = get_duckdb_connection()
    try:
        s3_path = f"s3://raw-data/{artifact_url}"
        con.execute(f"CREATE OR REPLACE VIEW data_table AS SELECT * FROM read_parquet('{s3_path}')")
        df = con.execute("DESCRIBE data_table").df()
        return "\n".join(f"  - {r['column_name']} ({r['column_type']})" for _, r in df.iterrows())
    except Exception as e:
        return f"Error fetching schema: {e}"
    finally:
        con.close()


def _fetch_workspace_schema(sources: list[dict]) -> tuple[str, dict[str, str]]:
    """
    Creates a view per source. Returns (schema_text, view_map).
    view_map: {view_name: artifact_url} — stored in state for the executor.
    """
    con = get_duckdb_connection()
    schema_parts = []
    view_map = {}

    try:
        for source in sources:
            artifact_url = source["artifact_url"]
            view_name = _safe_view_name(source["name"])

            # Deduplicate clashing view names
            if view_name in view_map:
                view_name = f"{view_name}_{source['id'][:6]}"

            s3_path = f"s3://raw-data/{artifact_url}"
            try:
                con.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet('{s3_path}')")
                df = con.execute(f"DESCRIBE {view_name}").df()
                cols = "\n".join(f"    - {r['column_name']} ({r['column_type']})" for _, r in df.iterrows())
                schema_parts.append(f"  View `{view_name}` (dataset: \"{source['name']}\"):\n{cols}")
                view_map[view_name] = artifact_url
            except Exception as e:
                schema_parts.append(f"  View `{view_name}` — ⚠️ failed: {e}")
    finally:
        con.close()

    return "\n\n".join(schema_parts), view_map


def query_node(state: AgentState):
    """
    Generates SQL for both single-source and workspace (multi-source) sessions.
    Detects mode from whether workspace_sources is populated in state.
    """
    messages        = state.get("messages", [])
    error_trace     = state.get("error_trace")
    workspace_sources = state.get("workspace_sources")  # None in single-source mode

    is_workspace = bool(workspace_sources)

    if is_workspace:
        print(f"📝 [SQL Node] Workspace mode — {len(workspace_sources)} sources")
        schema_text, view_map = _fetch_workspace_schema(workspace_sources)
        system_prompt = f"""You are an expert SQL developer using DuckDB.

You have access to these views — one per dataset in this workspace:

{schema_text}

RULES:
1. Query ONLY the view names listed above.
2. You may JOIN, UNION, or subquery across views freely.
3. Use standard DuckDB SQL. Return ONLY the SQL query, no markdown.
4. Column names are case-sensitive.
"""
    else:
        artifact_url = state.get("artifact_url")
        print("📝 [SQL Node] Single-source mode")
        schema_text = _fetch_single_schema(artifact_url)
        view_map = {}
        system_prompt = f"""You are an expert SQL developer using DuckDB.

You are querying a single table named exactly: data_table

DATASET SCHEMA:
{schema_text}

RULES:
1. Query ONLY data_table.
2. Use standard DuckDB SQL. Return ONLY the SQL query, no markdown.
"""

    if error_trace:
        system_prompt += f"\n\n🚨 YOUR PREVIOUS QUERY FAILED:\n{error_trace}\nRewrite to fix it."

    structured_llm = llm.with_structured_output(SQLGeneration)
    result = structured_llm.invoke([SystemMessage(content=system_prompt)] + messages)

    print(f"📝 [SQL Node] Generated: {result.query}")

    return {
        "current_code": result.query,
        "view_map":     view_map,   # empty dict in single-source mode, ignored by executor
        "error_trace":  None,
    }