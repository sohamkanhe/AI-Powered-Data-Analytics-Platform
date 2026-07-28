import os
import io
import sys
import json
import time
import uuid
import numpy as np
import traceback
import multiprocessing
import pandas as pd
import redis

# Configuration
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
TASK_QUEUE = "sandbox_tasks"
TIMEOUT_SECONDS = 60

r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)


class NpEncoder(json.JSONEncoder):
    """Safely serializes numpy/pandas types to JSON-compatible primitives."""
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, pd.Series):
            return obj.tolist()
        if hasattr(obj, 'isoformat'):  # datetime objects
            return obj.isoformat()
        return super(NpEncoder, self).default(obj)


def execute_code(code: str, df_json: str, result_queue: multiprocessing.Queue):
    """Executes the generated python code in an isolated child process."""
    try:
        import io as _io
        import numpy as _np
        import pandas as _pd

        # Load df into local scope
        df = _pd.read_json(_io.StringIO(df_json), orient="split") if df_json else _pd.DataFrame()

        # Prepare execution environment - expose scientific stack
        exec_globals = {
            "df": df,
            "pd": _pd,
            "np": _np,
        }

        # Lazily import heavy libs only inside the child process
        try:
            import scipy; exec_globals["scipy"] = scipy
            from scipy import stats; exec_globals["stats"] = stats
        except ImportError:
            pass
        try:
            import sklearn; exec_globals["sklearn"] = sklearn
        except ImportError:
            pass
        try:
            import statsmodels.api as sm; exec_globals["sm"] = sm
        except ImportError:
            pass
        try:
            from prophet import Prophet; exec_globals["Prophet"] = Prophet
        except ImportError:
            pass

        start_time = time.time()

        local_vars = {}
        exec(code, exec_globals, local_vars)

        end_time = time.time()

        if "result_dict" in local_vars:
            import math

            def sanitize_for_json(obj):
                """Recursively make obj JSON-safe: stringify tuple keys, strip NaN/Inf, coerce numpy types."""
                if isinstance(obj, dict):
                    return {
                        (str(k) if not isinstance(k, (str, int, float, bool, type(None))) else k):
                        sanitize_for_json(v)
                        for k, v in obj.items()
                    }
                if isinstance(obj, (list, tuple)):
                    return [sanitize_for_json(i) for i in obj]
                if isinstance(obj, _np.integer):
                    return int(obj)
                if isinstance(obj, _np.floating):
                    v = float(obj)
                    return None if (math.isnan(v) or math.isinf(v)) else v
                if isinstance(obj, _np.ndarray):
                    return sanitize_for_json(obj.tolist())
                if isinstance(obj, _pd.Series):
                    return sanitize_for_json(obj.tolist())
                if isinstance(obj, _pd.DataFrame):
                    return sanitize_for_json(obj.to_dict(orient="list"))
                if isinstance(obj, float):
                    return None if (math.isnan(obj) or math.isinf(obj)) else obj
                if hasattr(obj, 'isoformat'):
                    return obj.isoformat()
                return obj

            safe_result = sanitize_for_json(local_vars["result_dict"])
            result_queue.put({
                "status": "success",
                "result": safe_result,
                "execution_time": round(end_time - start_time, 3)
            })

        else:
            result_queue.put({
                "status": "error",
                "error": "Code executed successfully but 'result_dict' was never assigned. The generated code must end with: result_dict = {...}"
            })

    except Exception:
        result_queue.put({"status": "error", "error": traceback.format_exc()})


def process_tasks():
    print(f"🚀 Sandbox Worker started. Listening on Redis queue '{TASK_QUEUE}'...", flush=True)

    while True:
        try:
            # BLPOP blocks indefinitely until a task arrives
            task_data = r.blpop(TASK_QUEUE, timeout=0)
            if not task_data:
                continue

            queue_name, payload_str = task_data
            payload = json.loads(payload_str)

            execution_id = payload.get("execution_id")
            code = payload.get("code", "")
            df_json = payload.get("df_json")

            if not execution_id or not code:
                print("⚠️ Invalid task payload — missing execution_id or code.", flush=True)
                continue

            print(f"⚙️ EXECUTING TASK {execution_id}", flush=True)

            result_queue = multiprocessing.Queue()
            p = multiprocessing.Process(target=execute_code, args=(code, df_json, result_queue))
            p.start()
            p.join(TIMEOUT_SECONDS)

            if p.is_alive():
                print(f"⏳ TIMEOUT: Task {execution_id} terminated after {TIMEOUT_SECONDS}s.", flush=True)
                p.terminate()
                p.join()
                response = {
                    "status": "error",
                    "error": f"Execution timed out after {TIMEOUT_SECONDS} seconds. The code may contain an infinite loop or a very expensive computation."
                }
            else:
                response = result_queue.get() if not result_queue.empty() else {
                    "status": "error",
                    "error": "Process exited without returning a result."
                }

            print(f"✅ FINISHED TASK {execution_id} — Status: {response['status']}", flush=True)

            result_key = f"sandbox_results:{execution_id}"
            r.rpush(result_key, json.dumps(response))
            r.expire(result_key, 300)  # Auto-cleanup after 5 minutes

        except Exception as e:
            print(f"❌ Worker loop error: {e}", flush=True)
            time.sleep(1)


if __name__ == "__main__":
    # Required for multiprocessing on some platforms
    multiprocessing.set_start_method("spawn", force=True)
    process_tasks()
