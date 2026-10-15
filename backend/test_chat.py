import os, requests, json, uuid
from dotenv import load_dotenv
load_dotenv()

r = requests.post('http://127.0.0.1:8000/api/v1/auth/login', data={'username': 'admin', 'password': 'admin'})
token = r.json()['access_token']

source_id = '0e0cfce8-fa37-408a-8a48-b219a6424711'
cell_id = str(uuid.uuid4())

print('Testing: how many houses with 4 bedrooms are there?')
r2 = requests.post(
    f'http://127.0.0.1:8000/api/v1/chat/{source_id}',
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
    json={'message': 'how many houses with 4 bedrooms are there?', 'cell_id': cell_id},
    timeout=90
)
print('Status:', r2.status_code)
if r2.status_code == 200:
    for b in r2.json().get('blocks', [])[:3]:
        print(' ', b.get('type'), ':', str(b.get('content', b.get('data', '')))[:300])
else:
    print('Error:', r2.text[:500])
