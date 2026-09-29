import multiprocessing
import pandas as pd
from sandbox.sandbox_worker import execute_code

def test_sandbox_code_execution_success():
    df = pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]})
    df_json = df.to_json(orient="split")
    code = "result_dict = {'sum_a': int(df['a'].sum()), 'count': len(df)}"

    result_queue = multiprocessing.Queue()
    p = multiprocessing.Process(target=execute_code, args=(code, df_json, result_queue))
    p.start()
    p.join(timeout=10)

    assert not p.is_alive()
    res = result_queue.get()
    assert res["status"] == "success"
    assert res["result"]["sum_a"] == 6
    assert res["result"]["count"] == 3

def test_sandbox_code_execution_missing_result_dict():
    df_json = "{}"
    code = "x = 10 + 20"

    result_queue = multiprocessing.Queue()
    p = multiprocessing.Process(target=execute_code, args=(code, df_json, result_queue))
    p.start()
    p.join(timeout=10)

    assert not p.is_alive()
    res = result_queue.get()
    assert res["status"] == "error"
    assert "result_dict" in res["error"]
