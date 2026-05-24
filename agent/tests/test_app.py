from pathlib import Path
import base64
import json
import os
from unittest.mock import ANY, patch

import pytest
from fastapi.testclient import TestClient

from agent.contract.config import DRAFTS_DIR, UPLOADS_DIR, get_template_config
from agent.contract.render import build_docxtpl_context
from agent.main import app, contract_download_payload, generate_contract, sign_session_payload


os.environ.setdefault("APP_SESSION_SECRET", "test-session-secret-123456789012")

client = TestClient(app)


def agent_auth_header(userid: str = "uid1", unionid: str = "union-x") -> dict[str, str]:
    token = sign_session_payload({
        "typ": "agent",
        "exp": 4_102_444_800,
        "userid": userid,
        "name": "张三",
        "unionid": unionid,
    })
    return {"Authorization": f"Bearer {token}"}


def upload_quote(
    original_name: str = "quote.pdf",
    mime_type: str = "application/pdf",
    content: bytes = b"%PDF-1.4 quote",
    headers: dict[str, str] | None = None,
) -> dict:
    response = client.post(
        "/api/uploads",
        headers=headers or agent_auth_header(),
        json={
            "originalName": original_name,
            "mimeType": mime_type,
            "size": len(content),
            "data": base64.b64encode(content).decode("ascii"),
        },
    )
    assert response.status_code == 200
    return response.json()


def upload_record(upload_id: str) -> dict:
    return json.loads((UPLOADS_DIR / f"{upload_id}.json").read_text(encoding="utf-8"))


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_h5_page_is_not_served_by_agent() -> None:
    response = client.get("/h5")
    assert response.status_code == 404


def test_upload_multipart_pdf() -> None:
    response = client.post(
        "/api/uploads",
        headers=agent_auth_header(),
        files={"file": ("quote.pdf", b"%PDF-1.4 quote", "application/pdf")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"]
    assert body["ok"] is True
    assert "path" not in body


def test_upload_json_base64_pdf() -> None:
    content = b"%PDF-1.4 hello quote"
    body = upload_quote(content=content)
    assert body["size"] == len(content)
    assert body["ok"] is True


def test_upload_rejects_txt() -> None:
    response = client.post(
        "/api/uploads",
        headers=agent_auth_header(),
        json={
            "originalName": "quote.txt",
            "mimeType": "text/plain",
            "size": len(b"hello quote"),
            "data": base64.b64encode(b"hello quote").decode("ascii"),
        },
    )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "UNSUPPORTED_FILE_TYPE"


def test_upload_owner_cannot_access_other_user_upload() -> None:
    upload_body = upload_quote()
    response = client.post(
        f"/api/uploads/{upload_body['id']}/quote-text",
        headers=agent_auth_header(userid="uid2", unionid="union-y"),
        json={"templateType": "caigouhetong"},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"


def test_parse_uploaded_quote_image_text() -> None:
    upload = client.post(
        "/api/uploads",
        headers=agent_auth_header(),
        json={
            "originalName": "quote.png",
            "mimeType": "image/png",
            "size": len(b"image-bytes"),
            "data": base64.b64encode(b"image-bytes").decode("ascii"),
        },
    )
    assert upload.status_code == 200
    upload_body = upload.json()

    with patch("agent.contract.extract.extract_image_text", return_value="报价单文本"):
        response = client.post(
            f"/api/uploads/{upload_body['id']}/quote-text",
            headers=agent_auth_header(),
            json={"templateType": "caigouhetong"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["uploadId"] == upload_body["id"]
    assert body["originalName"] == "quote.png"
    assert body["quoteText"] == "报价单文本"
    assert body["textLength"] == len("报价单文本")
    assert body["parser"] == {"type": "image", "ocrUsed": True}


def test_parse_uploaded_image_uses_ocr() -> None:
    upload = client.post(
        "/api/uploads",
        headers=agent_auth_header(),
        json={
            "originalName": "quote.png",
            "mimeType": "image/png",
            "size": len(b"image-bytes"),
            "data": base64.b64encode(b"image-bytes").decode("ascii"),
        },
    )
    assert upload.status_code == 200
    upload_body = upload.json()

    with patch("agent.contract.extract.extract_image_text", return_value="OCR 报价单文本"):
        response = client.post(
            f"/api/uploads/{upload_body['id']}/quote-text",
            headers=agent_auth_header(),
            json={"templateType": "caigouhetong"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["quoteText"] == "OCR 报价单文本"
    assert body["parser"] == {"type": "image", "ocrUsed": True}


def test_upload_rejects_empty_file() -> None:
    response = client.post(
        "/api/uploads",
        headers=agent_auth_header(),
        json={
            "originalName": "empty.pdf",
            "mimeType": "application/pdf",
            "size": 0,
            "data": "",
        },
    )
    assert response.status_code == 400
    assert "文件内容" in response.json()["message"]


def test_agui_uses_confirmed_quote_text() -> None:
    upload_id = upload_quote(content=b"%PDF-1.4 raw quote")["id"]

    with patch("agent.main.generate_contract") as generate_contract:
        generate_contract.return_value = {"contractId": "contract_test", "templateType": "caigouhetong", "quoteTextLength": 4}
        response = client.post(
            "/ag-ui/agent",
            headers=agent_auth_header(),
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
    generate_contract.assert_called_once_with(upload_id, "caigouhetong", "用户确认文本", None, None, ANY)
    assert "已确认报价单文本" in response.text


def test_field_preview_uses_extra_info_and_classifies_fields() -> None:
    upload_id = upload_quote()["id"]

    extracted = {
        "supplierName": "供应商A",
        "buyerPhone": None,
        "items": [{"index": "1", "name": "水泵", "quantity": "2", "unitPrice": "100"}],
    }
    with patch("agent.main.extract_template_render_data", return_value=extracted) as llm:
        response = client.post(
            f"/api/uploads/{upload_id}/field-preview",
            headers=agent_auth_header(),
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
    upload_id = upload_quote()["id"]
    extracted = {"supplierName": "供应商A", "items": []}

    with patch("agent.main.extract_template_render_data") as llm, patch(
        "agent.main.render_contract",
        return_value=Path("agent/storage/contracts/confirmed.docx"),
    ) as render_contract_mock, patch(
        "agent.main.upload_contract_to_dingdrive",
        return_value={"spaceId": "space1", "fileId": "file1", "fileName": "confirmed.docx", "filePath": "/confirmed.docx"},
    ):
        draft = generate_contract(upload_id, "caigouhetong", "确认文本", "补充信息", extracted, {"userid": "uid1", "unionid": "union-x"})

    llm.assert_not_called()
    render_contract_mock.assert_called_once_with(ANY, ANY, ANY, blank_missing=True)
    assert draft["extractedData"] == extracted
    assert draft["extraInfoLength"] == len("补充信息")
    assert draft["dingDrive"]["fileId"] == "file1"


def test_generate_contract_uploads_dingdrive_and_removes_process_files() -> None:
    upload_body = upload_quote()
    upload_id = upload_body["id"]
    record = upload_record(upload_id)
    extracted = {"supplierName": "供应商A", "items": []}
    rendered_path = Path("agent/storage/contracts/20260523_供应商A.docx")

    def fake_render(*args, **kwargs) -> Path:
        rendered_path.parent.mkdir(parents=True, exist_ok=True)
        rendered_path.write_bytes(b"docx")
        return rendered_path

    with patch("agent.main.render_contract", side_effect=fake_render), patch(
        "agent.main.upload_contract_to_dingdrive",
        return_value={"spaceId": "space1", "fileId": "file1", "fileName": "20260523_供应商A.docx", "filePath": "/采购合同测试/20260523_供应商A.docx"},
    ) as upload_dingdrive:
        draft = generate_contract(upload_id, "caigouhetong", "确认文本", "补充信息", extracted, {"userid": "uid1", "unionid": "union-x"})

    upload_dingdrive.assert_called_once()
    assert draft["dingDrive"]["fileId"] == "file1"
    assert "供应商A" in draft["fileName"]
    assert not Path(record["path"]).exists()
    assert not (UPLOADS_DIR / f"{upload_id}.json").exists()
    assert not rendered_path.exists()
    assert not (DRAFTS_DIR / f"{draft['contractId']}.json").exists()


def test_contract_download_payload_returns_dingdrive_preview() -> None:
    draft = {
        "contractId": "contract_test",
        "fileName": "20260523_供应商A.docx",
        "dingDrive": {
            "spaceId": "space1",
            "fileId": "file1",
            "fileName": "20260523_供应商A.docx",
            "filePath": "/采购合同测试/20260523_供应商A.docx",
            "previewUrl": "https://preview.example/file1",
        },
    }

    payload = contract_download_payload(draft)

    assert payload["preview"]["type"] == "dingtalk_drive"
    assert payload["preview"]["previewUrl"] == "https://preview.example/file1"
    assert "downloadPath" not in payload
def test_generate_contract_keeps_process_files_when_dingdrive_fails() -> None:
    upload_body = upload_quote()
    upload_id = upload_body["id"]
    record = upload_record(upload_id)
    rendered_path = Path("agent/storage/contracts/failed-upload.docx")

    def fake_render(*args, **kwargs) -> Path:
        rendered_path.parent.mkdir(parents=True, exist_ok=True)
        rendered_path.write_bytes(b"docx")
        return rendered_path

    with patch("agent.main.render_contract", side_effect=fake_render), patch(
        "agent.main.upload_contract_to_dingdrive",
        side_effect=RuntimeError("钉盘上传失败"),
    ), pytest.raises(RuntimeError):
        generate_contract(upload_id, "caigouhetong", "确认文本", "补充信息", {"supplierName": "供应商A", "items": []}, {"userid": "uid1", "unionid": "union-x"})

    assert Path(record["path"]).exists()
    assert (UPLOADS_DIR / f"{upload_id}.json").exists()
    assert rendered_path.exists()
    rendered_path.unlink(missing_ok=True)


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
    upload_id = upload_quote(content=b"%PDF-1.4 raw quote")["id"]
    extracted = {"supplierName": "供应商A", "items": []}

    with patch("agent.main.generate_contract") as generate_contract_mock:
        generate_contract_mock.return_value = {"contractId": "contract_test", "templateType": "caigouhetong", "quoteTextLength": 4}
        response = client.post(
            "/ag-ui/agent",
            headers=agent_auth_header(),
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
    generate_contract_mock.assert_called_once_with(upload_id, "caigouhetong", "用户确认文本", "补充信息", extracted, ANY)
    assert "已确认字段识别结果" in response.text


def test_templates_exist() -> None:
    assert Path("agent/contract/templates/zhanweifu/caigouhetong.docx").exists()
    assert Path("agent/contract/templates/zhanweifu/caigouhetong.placeholders.json").exists()


def test_upload_requires_login_when_enforced(monkeypatch) -> None:
    monkeypatch.setenv("APP_SESSION_SECRET", "enforce-secret-key-123456789012")
    isolated = TestClient(app)
    response = isolated.post(
        "/api/uploads",
        json={
            "originalName": "quote.pdf",
            "mimeType": "application/pdf",
            "size": len(b"x"),
            "data": base64.b64encode(b"x").decode("ascii"),
        },
    )
    assert response.status_code == 401


def test_agui_requires_login_when_enforced(monkeypatch) -> None:
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


def test_agent_bearer_token_allows_upload_when_enforced(monkeypatch) -> None:
    monkeypatch.setenv("APP_SESSION_SECRET", "enforce-secret-key-123456789012")
    isolated = TestClient(app)

    upload = isolated.post(
        "/api/uploads",
        headers=agent_auth_header(),
        json={
            "originalName": "quote.pdf",
            "mimeType": "application/pdf",
            "size": len(b"hello quote"),
            "data": base64.b64encode(b"hello quote").decode("ascii"),
        },
    )
    assert upload.status_code == 200


