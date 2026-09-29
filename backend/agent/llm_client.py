import os
from langchain_google_genai import ChatGoogleGenerativeAI

api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or "dummy_key_for_testing"

llm = ChatGoogleGenerativeAI(
    model="gemini-flash-lite-latest",
    api_key=api_key,
    temperature=0,
    max_tokens=4096,
    timeout=60,
    max_retries=2,
)