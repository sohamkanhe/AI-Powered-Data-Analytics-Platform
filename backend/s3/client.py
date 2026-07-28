import boto3
from botocore.config import Config
from config import config

MINIO_URL = config["MINIO_URL"] # Replace with your MinIO server address and port
ACCESS_KEY = config["ACCESS_KEY"]     # Replace with your MinIO access key
SECRET_KEY = config["SECRET_KEY"]       # Replace with your MinIO secret key
REGION_NAME = config["REGION_NAME"]

s3_client = boto3.client(
    's3',
    endpoint_url=MINIO_URL,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    config=Config(signature_version='s3v4'),
    region_name=REGION_NAME
)