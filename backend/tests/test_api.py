import pytest
from fastapi.testclient import TestClient
from main import app

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

def test_root_endpoint(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "hello"}

def test_config_import():
    from config import config
    assert isinstance(config, dict)
    assert "DATABASE_URL" in config
