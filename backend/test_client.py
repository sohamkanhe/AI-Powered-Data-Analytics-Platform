import requests
import json
import pandas as pd
import os

# Configuration
API_URL = "http://127.0.0.1:8000/api/v1/upload"

# ---------------------------------------------------------
# Helper: Generator Functions
# ---------------------------------------------------------

def create_dummy_csv(filename="test_data.csv"):
    df = pd.DataFrame({'id': [1, 2, 3], 'product': ['Apple', 'Banana', 'Cherry'], 'price': [1.2, 0.5, 2.0]})
    df.to_csv(filename, index=False)
    return filename

def create_dummy_json(filename="test_data.json"):
    # DuckDB read_json_auto prefers list of objects
    data = [
        {'id': 1, 'user': 'Alice', 'role': 'Admin'},
        {'id': 2, 'user': 'Bob', 'role': 'User'}
    ]
    with open(filename, 'w') as f:
        json.dump(data, f)
    return filename

def create_dummy_excel(filename="test_data.xlsx"):
    df = pd.DataFrame({'month': ['Jan', 'Feb'], 'revenue': [1000, 1500]})
    df.to_excel(filename, index=False)
    return filename

def create_dummy_parquet(filename="test_data.parquet"):
    df = pd.DataFrame({'sensor_id': [101, 102], 'temp': [23.5, 24.1]})
    df.to_parquet(filename)
    return filename

# ---------------------------------------------------------
# Helper: Request Sender
# ---------------------------------------------------------

def send_request(source_type, dataset_name, file_path=None, connection_string=None):
    print(f"--- Testing {source_type} ---")
    
    # 1. Prepare Metadata Pydantic Model
    metadata = {
        "dataset_name": dataset_name,
        "description": f"Automated test for {source_type}",
        "source_type": source_type,
        "ingestion_config": {"auto_map": True}
    }

    if connection_string:
        metadata["connection_string"] = connection_string

    # 2. Prepare Form Data
    # 'metadata_json' matches the variable name in your FastAPI endpoint
    data = {
        "metadata_json": json.dumps(metadata)
    }

    files = None
    if file_path:
        # ('file', (filename, file_object, content_type))
        files = {'file': (file_path, open(file_path, 'rb'), 'application/octet-stream')}

    try:
        response = requests.post(API_URL, data=data, files=files)
        
        if response.status_code == 200:
            print(f"✅ Success: {response.json()}")
        else:
            print(f"❌ Failed ({response.status_code}): {response.text}")
            
    except Exception as e:
        print(f"❌ Error: {e}")

    # Close file if it was opened
    if files:
        files['file'][1].close()
    print("\n")


# ---------------------------------------------------------
# Main Execution
# ---------------------------------------------------------

if __name__ == "__main__":
    # Generate Files
    print("Generating dummy files...")
    csv_file = 'Housing.csv'
    # csv_file = create_dummy_csv()
    # json_file = create_dummy_json()
    # xlsx_file = create_dummy_excel()
    # parquet_file = create_dummy_parquet()

    # 1. Test CSV
    send_request("csv", "Test CSV Dataset", file_path=csv_file)

    # 2. Test JSON
    # send_request("json", "Test JSON Dataset", file_path=json_file)

    # 3. Test Excel
    # send_request("excel", "Test Excel Dataset", file_path=xlsx_file)

    # 4. Test Parquet (Direct upload, no conversion needed)
    # send_request("parquet", "Test Parquet Dataset", file_path=parquet_file)

    # 5. Test Postgres (Metadata only, no file)
    # Note: Using a dummy connection string just to validate validation logic
    # send_request("postgres_db", "Test Postgres DB", connection_string="postgresql://user:pass@localhost:5432/mydb")

    # Cleanup
    # print("Cleaning up files...")
    # for f in [csv_file, json_file, xlsx_file, parquet_file]:
    #     if os.path.exists(f):
    #         os.remove(f)
