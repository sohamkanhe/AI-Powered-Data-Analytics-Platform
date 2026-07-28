import duckdb
import pandas as pd
from db.duck_db import get_artifact_read_path, get_duckdb_connection
from schemas.uploads import SourceType


def generate_data_profile(source_type: str, artifact_url: str = None, connection_string: str = None):
    con = get_duckdb_connection()
    try:
        if source_type in [SourceType.POSTGRES_DB, SourceType.MYSQL_DB]:
            # For databases, we just get the tables. Full profiling is too heavy for live DBs.
            db_ext = "postgres" if source_type == SourceType.POSTGRES_DB else "mysql"
            con.execute(f"INSTALL {db_ext}; LOAD {db_ext};")
            con.execute(f"ATTACH '{connection_string}' AS my_db (TYPE {db_ext})")

            tables_df = con.execute(
                "SELECT table_name, table_schema FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog')").df()
            return {"type": "database", "tables": tables_df.to_dict(orient="records")}

        else:
            read_path = get_artifact_read_path(artifact_url)
            safe_read_path = read_path.replace("'", "''")

            # 1. Run SUMMARIZE
            summary_df = con.execute(f"SUMMARIZE SELECT * FROM read_parquet('{safe_read_path}')").df()

            # 2. Get a 10-row sample
            sample_df = con.execute(f"SELECT * FROM read_parquet('{safe_read_path}') LIMIT 10").df()

            # Format the summary for the frontend
            columns_profile = []
            for _, row in summary_df.iterrows():
                # Handle potential NaN values safely
                min_val = row['min'] if pd.notna(row['min']) else None
                max_val = row['max'] if pd.notna(row['max']) else None

                columns_profile.append({
                    "name": row['column_name'],
                    "type": row['column_type'],
                    "null_percentage": round(row['null_percentage'], 2),
                    "unique_count": row['approx_unique'],
                    "min": min_val,
                    "max": max_val
                })

            return {
                "type": "file",
                "schema": columns_profile,
                "sample": {
                    "columns": sample_df.columns.tolist(),
                    "data": sample_df.to_dict(orient="records")
                }
            }
    except Exception as e:
        return {"error": str(e)}
    finally:
        con.close()
