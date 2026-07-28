from dotenv import load_dotenv
import os

load_dotenv()

config = {
    "MINIO_URL": os.getenv("MINIO_URL"),
    "ACCESS_KEY": os.getenv("ACCESS_KEY"),
    "SECRET_KEY": os.getenv("SECRET_KEY"),
    "JWT_SECRET_KEY": os.getenv("JWT_SECRET_KEY"),
    "REGION_NAME": os.getenv("REGION_NAME"),
    "DATABASE_URL": os.getenv("DATABASE_URL"),
    "DATABASE_URL_PG": os.getenv("DATABASE_URL_PG"),
    "GROQ_API_KEY": os.getenv("GROQ_API_KEY"),
}