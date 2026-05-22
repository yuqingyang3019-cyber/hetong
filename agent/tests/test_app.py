from pathlib import Path
import base64
from unittest.mock import ANY, Mock, patch

from fastapi.testclient import TestClient

from agent.contract.config import get_template_config
from agent.contract.render import build_docxtpl_context
from agent.main import app, generate_contract


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
    generate_contract.assert_called_once_with(upload_id, "caigouhetong", "用户确认文本", None, None)
    assert "已确认报价单文本" in response.text


def test_field_preview_uses_extra_info_and_classifies_fields() -> None:
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
    upload_id = upload.json()["id"]

    extracted = {
        "supplierName": "供应商A",
        "buyerPhone": None,
        "items": [{"index": "1", "name": "水泵", "quantity": "2", "unitPrice": "100"}],
    }
    with patch("agent.main.extract_template_render_data", return_value=extracted) as llm:
        response = client.post(
            f"/api/uploads/{upload_id}/field-preview",
            json={
                "templateType": "caigouhetong",
                "quoteText": " 用户确认报价单文本 ",
                "extraInfo": " 付款方式：验收后支付 ",
            },
        )

    assert response.status_code == 200
    llm.assert_called_once_with("用户确认报价单文本", ANY, "付款方式：验收后支付")
    body = response.json()
    assert body["extractedData"] == extracted
    assert any(field["label"] == "乙方名称" and field["value"] == "供应商A" for field in body["recognizedFields"])
    assert any(field["label"] == "甲方电话" for field in body["missingFields"])
    assert body["tableRowCounts"] == {"items": 1}


def test_generate_contract_reuses_confirmed_extracted_data() -> None:
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
    upload_id = upload.json()["id"]
    extracted = {"supplierName": "供应商A", "items": []}

    with patch("agent.main.extract_template_render_data") as llm, patch(
        "agent.main.render_contract",
        return_value=Path("agent/storage/contracts/confirmed.docx"),
    ) as render_contract_mock:
        draft = generate_contract(upload_id, "caigouhetong", "确认文本", "补充信息", extracted)

    llm.assert_not_called()
    render_contract_mock.assert_called_once_with(ANY, ANY, ANY, blank_missing=True)
    assert draft["extractedData"] == extracted
    assert draft["extraInfoLength"] == len("补充信息")


def test_confirmed_blank_fields_render_empty() -> None:
    config = get_template_config("caigouhetong")
    render_data = {"supplierName": "", "items": [{"index": "1", "name": ""}]}

    pending_context = build_docxtpl_context(render_data, config)
    confirmed_context = build_docxtpl_context(render_data, config, blank_missing=True)

    assert pending_context["supplierName"] == "【待填写：乙方名称】"
    assert confirmed_context["supplierName"] == ""
    assert pending_context["items"][0]["name"] == "【待填写：货物名称】"
    assert confirmed_context["items"][0]["name"] == ""


def test_agui_passes_confirmed_extracted_data() -> None:
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
    extracted = {"supplierName": "供应商A", "items": []}

    with patch("agent.main.generate_contract") as generate_contract_mock:
        generate_contract_mock.return_value = {"contractId": "contract_test", "templateType": "caigouhetong", "quoteTextLength": 4}
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
                    "extraInfo": " 补充信息 ",
                    "extractedData": extracted,
                },
            },
        )

    assert response.status_code == 200
    generate_contract_mock.assert_called_once_with(upload_id, "caigouhetong", "用户确认文本", "补充信息", extracted)
    assert "已确认字段识别结果" in response.text


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
    monkeypatch.setenv("DINGTALK_CLIENT_ID", "cid")
    monkeypatch.setenv("DINGTALK_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("DINGTALK_CORP_ID", "corp")

    from agent import dingtalk_oapi

    dingtalk_oapi.clear_token_cache()
    isolated = TestClient(app)
    with patch.object(dingtalk_oapi, "get_app_access_token", return_value="tok") as app_token, patch.object(
        dingtalk_oapi,
        "get_userid_by_login_code",
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
    app_token.assert_called_once_with("corp-x")
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


def test_dingtalk_login_code_uses_h5_microapp_code(monkeypatch) -> None:
    monkeypatch.setenv("DINGTALK_CLIENT_ID", "cid")
    monkeypatch.setenv("DINGTALK_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("DINGTALK_CORP_ID", "corp")

    from agent import dingtalk_oapi

    with patch.object(
        dingtalk_oapi,
        "get_userid_by_auth_code",
        return_value={"userid": "uid1", "unionid": "union-x"},
    ) as by_auth_code:
        result = dingtalk_oapi.get_userid_by_login_code("app-token", "h5-code")

    by_auth_code.assert_called_once_with("app-token", "h5-code")
    assert result["userid"] == "uid1"
    assert result["unionid"] == "union-x"
    assert result["authMode"] == "h5_microapp"


def test_dingtalk_getuserinfo_uses_form_payload() -> None:
    from agent import dingtalk_oapi

    response = Mock()
    response.status_code = 200
    response.json.return_value = {
        "errcode": 0,
        "errmsg": "ok",
        "result": {"userid": "uid1", "unionid": "union-x"},
    }

    with patch.object(dingtalk_oapi.requests, "post", return_value=response) as post:
        result = dingtalk_oapi.get_userid_by_auth_code("app-token", "h5-code")

    post.assert_called_once_with(
        dingtalk_oapi._GETUSERINFO_URL,
        data={"access_token": "app-token", "code": "h5-code"},
        headers={"Content-Type": "application/x-www-form-urlencoded;charset=utf-8"},
        timeout=15,
    )
    assert result["userid"] == "uid1"
