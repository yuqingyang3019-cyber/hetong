from pathlib import Path
import base64
from unittest.mock import patch

from fastapi.testclient import TestClient

from agent.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_h5_page_is_not_served_by_agent() -> None:
    response = client.get("/h5")
    assert response.status_code == 404


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


def test_upload_json_base64_and_download_txt() -> None:
    response = client.post(
        "/api/uploads",
        json={
            "originalName": "quote.txt",
            "mimeType": "text/plain",
            "size": len(b"hello quote"),
            "data": base64.b64encode(b"hello quote").decode("ascii"),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["size"] == len(b"hello quote")

    download = client.get(body["downloadUrl"])
    assert download.status_code == 200
    assert download.text == "hello quote"


def test_parse_uploaded_quote_text() -> None:
    upload = client.post(
        "/api/uploads",
        json={
            "originalName": "quote.txt",
            "mimeType": "text/plain",
            "size": len("报价单文本".encode("utf-8")),
            "data": base64.b64encode("报价单文本".encode("utf-8")).decode("ascii"),
        },
    )
    assert upload.status_code == 200
    upload_body = upload.json()

    response = client.post(
        f"/api/uploads/{upload_body['id']}/quote-text",
        json={"templateType": "caigouhetong"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["uploadId"] == upload_body["id"]
    assert body["originalName"] == "quote.txt"
    assert body["quoteText"] == "报价单文本"
    assert body["textLength"] == len("报价单文本")


def test_upload_rejects_empty_file() -> None:
    response = client.post(
        "/api/uploads",
        json={
            "originalName": "empty.pdf",
            "mimeType": "application/pdf",
            "size": 0,
            "data": "",
        },
    )
    assert response.status_code == 400
    assert "文件内容" in response.json()["detail"]


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


def test_agui_uses_confirmed_quote_text() -> None:
    upload = client.post(
        "/api/uploads",
        json={
            "originalName": "quote.txt",
            "mimeType": "text/plain",
            "size": len(b"raw quote"),
            "data": base64.b64encode(b"raw quote").decode("ascii"),
        },
    )
    assert upload.status_code == 200
    upload_id = upload.json()["id"]

    with patch("agent.main.generate_contract") as generate_contract:
        generate_contract.return_value = {"contractId": "contract_test", "templateType": "caigouhetong", "quoteTextLength": 4}
        response = client.post(
            "/ag-ui/agent",
            json={
                "threadId": "t1",
                "runId": "r1",
                "state": {},
                "messages": [{"id": "m1", "role": "user", "content": "生成合同"}],
                "tools": [],
                "context": [],
                "forwardedProps": {
                    "uploadId": upload_id,
                    "templateType": "caigouhetong",
                    "quoteText": " 用户确认文本 ",
                },
            },
        )

    assert response.status_code == 200
    generate_contract.assert_called_once_with(upload_id, "caigouhetong", "用户确认文本")
    assert "已确认报价单文本" in response.text


def test_templates_exist() -> None:
    assert Path("agent/contract/templates/zhanweifu/caigouhetong.docx").exists()
    assert Path("agent/contract/templates/zhanweifu/caigouhetong.placeholders.json").exists()


def test_auth_status_skip_when_no_session_secret() -> None:
    isolated = TestClient(app)
    response = isolated.get("/api/auth/status")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["skipAuth"] is True


def test_auth_me_skip_mode() -> None:
    isolated = TestClient(app)
    response = isolated.get("/api/auth/me")
    assert response.status_code == 200
    body = response.json()
    assert body["skipAuth"] is True
    assert body["loggedIn"] is True


def test_upload_requires_login_when_enforced(monkeypatch) -> None:
    monkeypatch.setenv("HETONG_SKIP_AUTH", "false")
    monkeypatch.setenv("APP_SESSION_SECRET", "enforce-secret-key-123456789012")
    isolated = TestClient(app)
    response = isolated.post(
        "/api/uploads",
        json={
            "originalName": "quote.txt",
            "mimeType": "text/plain",
            "size": len(b"x"),
            "data": base64.b64encode(b"x").decode("ascii"),
        },
    )
    assert response.status_code == 401


def test_agui_requires_login_when_enforced(monkeypatch) -> None:
    monkeypatch.setenv("HETONG_SKIP_AUTH", "false")
    monkeypatch.setenv("APP_SESSION_SECRET", "enforce-secret-key-123456789012")
    isolated = TestClient(app)
    response = isolated.post(
        "/ag-ui/agent",
        json={
            "threadId": "t1",
            "runId": "r1",
            "state": {},
            "messages": [{"id": "m1", "role": "user", "content": "x"}],
            "tools": [],
            "context": [],
            "forwardedProps": {},
        },
    )
    assert response.status_code == 401


def test_dingtalk_login_sets_session_and_allows_upload(monkeypatch) -> None:
    monkeypatch.setenv("HETONG_SKIP_AUTH", "false")
    monkeypatch.setenv("APP_SESSION_SECRET", "enforce-secret-key-123456789012")
    monkeypatch.setenv("DINGTALK_APP_KEY", "ak")
    monkeypatch.setenv("DINGTALK_APP_SECRET", "sk")

    from agent import dingtalk_oapi

    dingtalk_oapi.clear_token_cache()
    isolated = TestClient(app)
    with patch.object(dingtalk_oapi, "get_app_access_token", return_value="tok"), patch.object(
        dingtalk_oapi,
        "get_userid_by_auth_code",
        return_value={"userid": "uid1", "name": "Nick", "unionid": "union-x"},
    ), patch.object(
        dingtalk_oapi,
        "get_user_detail",
        return_value={
            "userid": "uid1",
            "name": "张三",
            "mobile": "13800000000",
            "title": "工程师",
            "dept_id_list": [10],
        },
    ), patch.object(dingtalk_oapi, "get_department_name", return_value="研发部"):
        login = isolated.post("/api/dingtalk/login", json={"code": "tmpcode", "corpId": "corp-x"})

    assert login.status_code == 200
    login_body = login.json()
    assert login_body["ok"] is True
    assert login_body["user"]["name"] == "张三"
    assert isolated.cookies.get("hetong_session")

    upload = isolated.post(
        "/api/uploads",
        json={
            "originalName": "quote.txt",
            "mimeType": "text/plain",
            "size": len(b"hello quote"),
            "data": base64.b64encode(b"hello quote").decode("ascii"),
        },
    )
    assert upload.status_code == 200
    dingtalk_oapi.clear_token_cache()
