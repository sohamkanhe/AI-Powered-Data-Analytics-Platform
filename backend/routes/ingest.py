import hashlib
import os
import shutil
import uuid
import duckdb
import pandas as pd
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from botocore.exceptions import ClientError
from sqlalchemy import select
from db.duck_db import get_duckdb_connection
from db.db import AsyncSessionLocal
from db.models.data_source import DataSource
from db.models.user import User
from routes.auth_router import get_current_user
from routes.explore_helper import generate_data_profile
from s3.client import s3_client
from schemas.uploads import DataIngestRequest, SourceType
from pydantic import BaseModel, Field
from typing import Optional, Any, Dict, List


# --- SCHEMA ---
class DataSourceUpdate(BaseModel):
    dataset_name: Optional[str] = None
    description: Optional[str] = None

class ColumnMeaning(BaseModel):
    column_name: str
    semantic_type: str = Field(description="e.g., Currency, Boolean Flag, Identifier, Measurement, Categorical, Temporal")
    description: str = Field(description="1-2 sentences explaining what this data represents to a business user in plain English.")

class DictionaryGeneration(BaseModel):
    columns: List[ColumnMeaning]


class TableQueryRequest(BaseModel):
    table_name: Optional[str] = None  # Required if the source is a live Database
    limit: int = 50
    offset: int = 0
    sort_column: Optional[str] = None
    sort_desc: bool = False

router = APIRouter()

duckdb_con = duckdb.connect(database=':memory:')

def convert_csv_to_parquet(path: str, out: str):
    attempts = [
        "read_csv_auto('{p}', sample_size=-1, ignore_errors=true, null_padding=true)",
        "read_csv('{p}', delim=',', header=true, strict_mode=false, ignore_errors=true)",
        "read_csv('{p}', delim=';', header=true, strict_mode=false, ignore_errors=true)",
        "read_csv('{p}', delim='|', header=true, strict_mode=false, ignore_errors=true)",
    ]

    for expr in attempts:
        try:
            duckdb_con.execute(f"""
                COPY (
                  SELECT * FROM {expr.format(p=path)}
                )
                TO '{out}' (FORMAT 'PARQUET', CODEC 'SNAPPY')
            """)
            return
        except Exception:
            pass

    raise Exception("CSV parsing failed for all known dialects")


def save_upload_to_temp(file: UploadFile, filename: str) -> str:
    temp_dir = "temp_storage"
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, filename)

    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return temp_path


def convert_to_parquet(source_path: str, source_type: SourceType) -> str:
    parquet_path = source_path + ".parquet"

    if not os.path.exists(source_path):
        raise HTTPException(status_code=400, detail="File upload failed internally.")

    try:
        if source_type == SourceType.CSV:
            safe_path = source_path.replace("'", "''")
            safe_out = parquet_path.replace("'", "''")
            # query = f"COPY (SELECT * FROM read_csv_auto('{safe_path}', sample_size=-1, ignore_errors=true, null_padding=true)) TO '{safe_out}' (FORMAT 'PARQUET', CODEC 'SNAPPY')"
            # duckdb_con.execute(query)
            convert_csv_to_parquet(safe_path, safe_out)

        elif source_type == SourceType.JSON:
            safe_path = source_path.replace("'", "''")
            safe_out = parquet_path.replace("'", "''")
            query = f"COPY (SELECT * FROM read_json_auto('{safe_path}')) TO '{safe_out}' (FORMAT 'PARQUET', CODEC 'SNAPPY')"
            duckdb_con.execute(query)

        elif source_type == SourceType.EXCEL:
            df = pd.read_excel(source_path)
            df.to_parquet(parquet_path, index=False)

        return parquet_path

    except Exception as e:
        if os.path.exists(parquet_path):
            os.remove(parquet_path)
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")


def process_ingestion(file_path: str, metadata: DataIngestRequest) -> str:
    """
    Hashes the file on disk and uploads to S3.
    """
    print(f"Ready to ingest {metadata.dataset_name} from {file_path}")

    sha256_hash = hashlib.sha256()

    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            sha256_hash.update(chunk)

    remote_file_name = f"{sha256_hash.hexdigest()}.parquet"
    bucket_name = 'raw-data'

    try:
        try:
            s3_client.head_bucket(Bucket=bucket_name)
        except ClientError:
            s3_client.create_bucket(Bucket=bucket_name)

        s3_client.upload_file(file_path, bucket_name, remote_file_name)
    except Exception as e:
        # Never create a datasource record that points at an object which was
        # not uploaded. That record would otherwise fail later during profiling
        # and chat with an unhelpful DuckDB connection error.
        raise HTTPException(
            status_code=503,
            detail="Could not store the uploaded file in MinIO. Start MinIO and try the upload again."
        ) from e

    return remote_file_name


@router.get("/data")
async def get_all_sources(current_user: User = Depends(get_current_user)):
    try:
        async with AsyncSessionLocal() as session:
            stmt = select(DataSource).where(DataSource.user_id == current_user.id)
            result = await session.execute(stmt)
            sources = result.scalars().all()

            # 3. Serialize to JSON-friendly dictionaries
            return [
                {
                    "id": str(source.id),
                    "name": source.dataset_name,
                    "type": source.source_type.upper() if source.source_type else "FILE",
                    # Format the date nicely for the UI (fallback to "Recently" if missing)
                    "uploaded": source.created_at.strftime("%b %d, %Y") if hasattr(source,
                                                                                   'created_at') and source.created_at else "Recently",
                    "description": source.description,
                    "rows": source.ingestion_config.get("rows", "Unknown") if source.ingestion_config else "Unknown",
                    "size": source.ingestion_config.get("size", "--") if source.ingestion_config else "--",
                    "preview_columns": source.ingestion_config.get("preview_columns", []) if source.ingestion_config else [],
                    "status": "Ready",
                }
                for source in sources
            ]

    except HTTPException as he:
        raise he


@router.get("/data/{source_id}")
async def get_all_sources(source_id: str, current_user: User = Depends(get_current_user)):
    try:
        async with AsyncSessionLocal() as session:
            try:
                source_uuid = uuid.UUID(source_id)  # Using a new variable prevents overwrite bugs
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid source_id")

            stmt = select(DataSource).where(
                DataSource.id == source_uuid,
                DataSource.user_id == current_user.id
            )
            result = await session.execute(stmt)
            source = result.scalar_one_or_none()

            if not source:
                raise HTTPException(status_code=404, detail="Data source not found or access denied")

            return source
    except HTTPException as he:
        raise he


@router.post("/upload")
async def upload(
        file: UploadFile = File(None),
        metadata_json: str = Form(..., description="JSON string of DataIngestRequest model"),
        current_user: User = Depends(get_current_user)
):
    try:
        req_data = DataIngestRequest.model_validate_json(metadata_json)
        artifact_url = ""

        extracted_metadata = {
            "rows": "Unknown",
            "size": "--",
            "preview_columns": []
        }

        if req_data.source_type in [SourceType.POSTGRES_DB, SourceType.MYSQL_DB]:
            if not req_data.connection_string:
                raise HTTPException(status_code=400, detail="Connection string required for Database Source")
            extracted_metadata["size"] = "Live DB"
            extracted_metadata["rows"] = "Dynamic"

            try:
                con = duckdb.connect(':memory:')
                db_ext = "postgres" if req_data.source_type == SourceType.POSTGRES_DB else "mysql"
                con.execute(f"INSTALL {db_ext}; LOAD {db_ext};")
                con.execute(f"ATTACH '{req_data.connection_string}' AS my_db (TYPE {db_ext})")

                # Fetch all table names
                tables_df = con.execute(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog')").df()
                extracted_metadata["preview_columns"] = tables_df['table_name'].tolist()
                con.close()
            except Exception as e:
                print(f"Warning: Could not fetch DB schema preview: {e}")

            print(f"Registered Database Source: {req_data.dataset_name}")

        else:
            if not file:
                raise HTTPException(status_code=400,
                                    detail=f"File upload required for source type {req_data.source_type}")

            raw_file_path = save_upload_to_temp(file, file.filename)
            final_path = raw_file_path

            try:
                if req_data.source_type != SourceType.PARQUET:
                    final_path = convert_to_parquet(raw_file_path, req_data.source_type)
                try:
                    # File Size
                    size_bytes = os.path.getsize(final_path)
                    if size_bytes > 1024 * 1024:
                        extracted_metadata["size"] = f"{round(size_bytes / (1024 * 1024), 2)} MB"
                    else:
                        extracted_metadata["size"] = f"{round(size_bytes / 1024, 2)} KB"

                    # Row Count and Schema via DuckDB
                    con = duckdb.connect(':memory:')
                    safe_path = final_path.replace("'", "''")

                    desc_df = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{safe_path}')").df()
                    extracted_metadata["preview_columns"] = desc_df['column_name'].tolist()

                    count_res = con.execute(f"SELECT COUNT(*) FROM read_parquet('{safe_path}')").fetchone()
                    extracted_metadata["rows"] = f"{count_res[0]:,}" if count_res else "Unknown"
                    con.close()
                except Exception as e:
                    print(f"Warning: Could not extract file metadata: {e}")

                artifact_url = process_ingestion(final_path, req_data)

            finally:
                if os.path.exists(raw_file_path) and raw_file_path != final_path:
                    os.remove(raw_file_path)

        final_config = req_data.ingestion_config or {}
        final_config.update(extracted_metadata)

        async with AsyncSessionLocal() as session:
            new_source = DataSource(
                dataset_name=req_data.dataset_name,
                description=req_data.description,
                source_type=req_data.source_type,
                artifact_url=artifact_url,
                ingestion_config=final_config,
                connection_string=req_data.connection_string,
                user_id=current_user.id
            )
            session.add(new_source)
            await session.commit()
            await session.refresh(new_source)

        return {
            "status": "success",
            "id": str(new_source.id),
            "type": req_data.source_type,
            "message": "Source registered successfully."
        }

    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# --- UPDATE DATA SOURCE ---
@router.patch("/data/{source_id}")
async def update_source(
        source_id: str,
        req: DataSourceUpdate,
        current_user: User = Depends(get_current_user)
):
    async with AsyncSessionLocal() as session:
        stmt = select(DataSource).where(
            DataSource.id == uuid.UUID(source_id),
            DataSource.user_id == current_user.id
        )
        source = (await session.execute(stmt)).scalar_one_or_none()

        if not source:
            raise HTTPException(status_code=404, detail="Data source not found or access denied")

        if req.dataset_name is not None:
            source.dataset_name = req.dataset_name
        if req.description is not None:
            source.description = req.description

        await session.commit()
        await session.refresh(source)
        return {"status": "success", "id": str(source.id), "name": source.dataset_name}


# --- DELETE DATA SOURCE ---
@router.delete("/data/{source_id}")
async def delete_source(source_id: str, current_user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        stmt = select(DataSource).where(
            DataSource.id == uuid.UUID(source_id),
            DataSource.user_id == current_user.id
        )
        source = (await session.execute(stmt)).scalar_one_or_none()

        if not source:
            raise HTTPException(status_code=404, detail="Data source not found or access denied")

        # Note: In a production app, you would also delete the file from S3 here
        # using your s3_client.delete_object(Bucket='raw-data', Key=source.artifact_url)

        await session.delete(source)
        await session.commit()
        return {"status": "success", "deleted": source_id}


@router.get("/data/{source_id}/explore")
async def explore_source(source_id: str, current_user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        stmt = select(DataSource).where(
            DataSource.id == uuid.UUID(source_id),
            DataSource.user_id == current_user.id
        )
        source = (await session.execute(stmt)).scalar_one_or_none()

        if not source:
            raise HTTPException(status_code=404, detail="Data source not found")

        profile = generate_data_profile(source.source_type, source.artifact_url, source.connection_string)
        return profile


@router.post("/data/{source_id}/explore/table")
async def get_table_data(
        source_id: str,
        req: TableQueryRequest,
        current_user: User = Depends(get_current_user)
):
    async with AsyncSessionLocal() as session:
        stmt = select(DataSource).where(
            DataSource.id == uuid.UUID(source_id),
            DataSource.user_id == current_user.id
        )
        source = (await session.execute(stmt)).scalar_one_or_none()

        if not source:
            raise HTTPException(status_code=404, detail="Data source not found")

        # 🔥 FIX 1: Use your configured connection that has S3 credentials loaded!
        con = get_duckdb_connection()

        try:
            if source.source_type in [SourceType.POSTGRES_DB, SourceType.MYSQL_DB]:
                if not req.table_name:
                    raise HTTPException(status_code=400, detail="table_name is required for database sources")

                db_ext = "postgres" if source.source_type == SourceType.POSTGRES_DB else "mysql"
                con.execute(f"INSTALL {db_ext}; LOAD {db_ext};")
                con.execute(f"ATTACH '{source.connection_string}' AS live_db (TYPE {db_ext})")

                safe_table = req.table_name.replace('"', '""')
                table_ref = f'live_db."{safe_table}"'
            else:
                import os
                local_path = os.path.join("temp_storage", source.artifact_url)
                read_path = local_path if os.path.exists(local_path) else f"s3://raw-data/{source.artifact_url}"
                safe_path = read_path.replace("'", "''")
                table_ref = f"read_parquet('{safe_path}')"

            base_query = f"SELECT * FROM {table_ref}"
            count_query = f"SELECT COUNT(*) FROM {table_ref}"

            if req.sort_column:
                safe_col = req.sort_column.replace('"', '""')
                direction = "DESC" if req.sort_desc else "ASC"
                base_query += f' ORDER BY "{safe_col}" {direction} NULLS LAST'

            base_query += f" LIMIT {req.limit} OFFSET {req.offset}"

            total_rows = con.execute(count_query).fetchone()[0]
            df = con.execute(base_query).df()

            # 🔥 FIX 2: Safely handle NaN and Datetime objects so FastAPI doesn't crash
            for col in df.select_dtypes(include=['datetime64', 'datetimetz']).columns:
                df[col] = df[col].astype(str)
            df = df.fillna("")

            return {
                "total_rows": total_rows,
                "limit": req.limit,
                "offset": req.offset,
                "columns": df.columns.tolist(),
                "data": df.to_dict(orient="records")
            }

        except Exception as e:
            import traceback
            traceback.print_exc()  # This will print the exact error to your terminal if it fails again
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            con.close()
