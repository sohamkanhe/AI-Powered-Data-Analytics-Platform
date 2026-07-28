import os
import json
import uuid
from agent.state import AgentState

TASK_QUEUE = "sandbox_tasks"
POLL_TIMEOUT = 120  # seconds to wait for the 60s worker + overhead


def _get_redis():
    """Lazily create Redis connection using current env vars (loaded after dotenv)."""
    import redis
    host = os.getenv("REDIS_HOST", "localhost")
    port = int(os.getenv("REDIS_PORT", "6379"))
    return redis.Redis(host=host, port=port, decode_responses=True)


def execute_sandbox_node(state: AgentState):
    print("[Sandbox Executor] Dispatching code to isolated worker...")

    code = state.get("current_code")
    df_json = state.get("df_json")

    if not code:
        print("[Sandbox Executor] No code to execute.")
        return {"sandbox_result": None}

    try:
        r = _get_redis()
        r.ping()  # Verify connection is alive before proceeding
    except Exception as e:
        print(f"[Sandbox Executor] Cannot connect to Redis: {e}")
        return {"sandbox_result": {"status": "error", "error": f"Redis unavailable: {e}"}}

    execution_id = str(uuid.uuid4())

    payload = {
        "execution_id": execution_id,
        "code": code,
        "df_json": df_json,
    }

    # 1. Push payload to sandbox worker queue
    try:
        r.rpush(TASK_QUEUE, json.dumps(payload))
    except Exception as e:
        print(f"[Sandbox Executor] Failed to queue task: {e}")
        return {"sandbox_result": {"status": "error", "error": f"Failed to queue task to Redis: {e}"}}

    # 2. Block and wait for result
    result_key = f"sandbox_results:{execution_id}"
    print(f"[Sandbox Executor] Waiting for result on {result_key}...")

    try:
        result_data = r.blpop(result_key, timeout=POLL_TIMEOUT)

        if result_data:
            _, result_json = result_data
            result_dict = json.loads(result_json)
            print(f"[Sandbox Executor] Received result status: {result_dict.get('status')}")
            return {"sandbox_result": result_dict}
        else:
            print("[Sandbox Executor] Timed out waiting for sandbox worker!")
            return {"sandbox_result": {"status": "error", "error": "Backend timed out waiting for the Sandbox worker (>120s)."}}

    except Exception as e:
        print(f"[Sandbox Executor] Error retrieving result: {e}")
        return {"sandbox_result": {"status": "error", "error": f"Failed to retrieve result from Redis: {e}"}}
