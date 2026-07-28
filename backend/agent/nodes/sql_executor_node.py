import pandas as pd
from agent.state import AgentState
from db.duck_db import get_duckdb_connection

MAX_TABLE_ROWS = 100
MAX_VIZ_ROWS   = 500


def execute_sql_node(state: AgentState):
    """
    Executes SQL for both single-source and workspace sessions.
    - Single-source: creates the standard `data_table` view from artifact_url
    - Workspace:     recreates all views from view_map (populated by query_node)
    """
    query             = state.get("current_code")
    workspace_sources = state.get("workspace_sources")
    view_map          = state.get("view_map", {})   # only set in workspace mode

    is_workspace = bool(workspace_sources)

    print(f"⚙️ [SQL Executor] {'Workspace' if is_workspace else 'Single-source'} mode — running query...")

    con = get_duckdb_connection()

    try:
        if is_workspace:
            # Recreate every workspace view (fresh connection has no views)
            for view_name, artifact_url in view_map.items():
                s3_path = f"s3://raw-data/{artifact_url}"
                con.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet('{s3_path}')")
        else:
            # Standard single-source view
            artifact_url = state.get("artifact_url")
            s3_path = f"s3://raw-data/{artifact_url}"
            con.execute(f"CREATE OR REPLACE VIEW data_table AS SELECT * FROM read_parquet('{s3_path}')")

        df = con.execute(query).df()
        df = df.where(df.notnull(), None)

        total_rows = len(df)
        df_display = df.head(MAX_TABLE_ROWS)
        records    = df_display.to_dict(orient="records")
        columns    = df.columns.tolist()

        warning = None
        if total_rows > MAX_TABLE_ROWS:
            warning = (
                f"Showing {MAX_TABLE_ROWS} of {total_rows:,} rows. "
                "Ask for an aggregated view to see full trends."
            )

        ui_blocks = [
            {"type": "code",  "language": "sql", "content": query},
            {"type": "table", "columns": columns, "data": records, "warning": warning},
        ]

        df_json = df.head(MAX_VIZ_ROWS).to_json(orient="split", date_format="iso")

        print(f"✅ [SQL Executor] {total_rows} rows returned.")
        return {
            "ui_blocks":     ui_blocks,
            "df_json":       df_json,
            "error_trace":   None,
            "attempt_count": 0,
        }

    except Exception as e:
        print(f"❌ [SQL Executor] Crashed: {e}")
        return {
            "ui_blocks":     [],
            "df_json":       None,
            "error_trace":   str(e),
            "attempt_count": state.get("attempt_count", 0) + 1,
        }
    finally:
        con.close()