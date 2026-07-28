from pathlib import Path
from urllib.parse import urlparse

import duckdb

from config import config


def get_artifact_read_path(artifact_url: str) -> str:
    """Return a local retained upload when available, otherwise its S3 URI."""
    local_path = Path(__file__).resolve().parents[1] / "temp_storage" / artifact_url
    return str(local_path) if local_path.is_file() else f"s3://raw-data/{artifact_url}"

def get_duckdb_connection():
    """Creates a DuckDB connection configured for local MinIO/S3."""
    con = duckdb.connect(database=':memory:')

    # Load the HTTP/S3 extension
    con.execute("INSTALL httpfs;")
    con.execute("LOAD httpfs;")

    # Keep DuckDB's S3 settings in sync with .env instead of hard-coding the
    # development endpoint and credentials here.
    minio_url = config["MINIO_URL"] or "http://localhost:9000"
    parsed_url = urlparse(minio_url)
    endpoint = parsed_url.netloc or parsed_url.path
    use_ssl = (parsed_url.scheme == "https")
    access_key = config["ACCESS_KEY"] or "minioadmin"
    secret_key = config["SECRET_KEY"] or "minioadmin"
    region = config["REGION_NAME"] or "us-east-1"

    con.execute("""
        CREATE SECRET (
            TYPE S3,
            KEY_ID '{access_key}',
            SECRET '{secret_key}',
            REGION '{region}',
            ENDPOINT '{endpoint}',
            URL_STYLE 'path',
            USE_SSL {use_ssl}
        );
    """.format(
        access_key=access_key.replace("'", "''"),
        secret_key=secret_key.replace("'", "''"),
        region=region.replace("'", "''"),
        endpoint=endpoint.replace("'", "''"),
        use_ssl=str(use_ssl).lower(),
    ))
    return con
