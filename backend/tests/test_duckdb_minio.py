import os
import duckdb
import pandas as pd
import pytest

def test_duckdb_query_and_parquet(tmp_path):
    # Verify DuckDB in-memory query execution and Parquet read/write
    parquet_file = tmp_path / "test_output.parquet"
    
    df = pd.DataFrame({"id": [101, 102, 103], "val": [10.5, 20.0, 30.5]})
    df.to_parquet(parquet_file)
    
    con = duckdb.connect(database=":memory:")
    query_res = con.execute(f"SELECT COUNT(*) as total, SUM(val) as sum_val FROM '{parquet_file}'").df()
    
    assert query_res["total"][0] == 3
    assert query_res["sum_val"][0] == 61.0

def test_minio_connection_if_available():
    import boto3
    minio_url = os.getenv("MINIO_URL", "http://localhost:9000")
    access_key = os.getenv("ACCESS_KEY", "minioadmin")
    secret_key = os.getenv("SECRET_KEY", "minioadmin")

    try:
        s3 = boto3.client(
            "s3",
            endpoint_url=minio_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="us-east-1"
        )
        response = s3.list_buckets()
        assert "Buckets" in response
    except Exception as e:
        pytest.skip(f"MinIO server not available at {minio_url}: {e}")
