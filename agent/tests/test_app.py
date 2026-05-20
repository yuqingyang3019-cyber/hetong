from pathlib import Path

from fastapi.testclient import TestClient

from agent.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_h5_page_loads() -> None:
    response = client.get("/h5")
    assert response.status_code == 200
    assert "合同生成助手" in response.text


def test_upload_and_download_txt() -> None:
    response = client.post(
        "/api/uploads",
        files={"file": ("quote.txt", b"hello quote", "text/plain")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"]
    assert body["downloadUrl"].endswith("/download")

    download = client.get(body["downloadUrl"])
    assert download.status_code == 200
    assert download.text == "hello quote"


def test_agui_health_check() -> None:
    response = client.post(
        "/ag-ui/agent",
        json={
            "threadId": "t1",
            "runId": "r1",
            "state": {},
            "messages": [{"id": "m1", "role": "user", "content": "健康检查"}],
            "tools": [],
            "context": [],
            "forwardedProps": {"healthCheck": True},
        },
    )
    assert response.status_code == 200
    assert "RUN_STARTED" in response.text
    assert "AGUI H5 服务正常" in response.text


def test_templates_exist() -> None:
    assert Path("agent/contract/templates/zhanweifu/caigouhetong.docx").exists()
    assert Path("agent/contract/templates/zhanweifu/caigouhetong.placeholders.json").exists()
