from __future__ import annotations

import base64
import json
import mimetypes
import os
import time
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator

import requests
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

try:
    from .contract.config import (
        CONTRACTS_DIR,
        DRAFTS_DIR,
        UPLOADS_DIR,
        ensure_storage,
        get_template_config,
        safe_file_name,
        template_options,
    )
    from .contract.extract import extract_text_from_file
    from .contract.llm import extract_template_render_data
    from .contract.render import merge_render_data, render_contract
except ImportError:
    from contract.config import (
        CONTRACTS_DIR,
        DRAFTS_DIR,
        UPLOADS_DIR,
        ensure_storage,
        get_template_config,
        safe_file_name,
        template_options,
    )
    from contract.extract import extract_text_from_file
    from contract.llm import extract_template_render_data
    from contract.render import merge_render_data, render_contract


app = FastAPI(title="合同生成 Agent")
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")


def new_id(prefix: str) -> str:
    return f"{prefix}_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"


def sse_event(event: dict[str, Any]) -> bytes:
    payload = {"timestamp": int(time.time() * 1000), **event}
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def absolute_url(request: Request, path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    forwarded_host = request.headers.get("x-forwarded-host")
    host = forwarded_host or request.headers.get("host") or ""
    proto = request.headers.get("x-forwarded-proto") or "https"
    return f"{proto}://{host}{path}" if host else path


def upload_download_path(file_name: str) -> str:
    return f"/api/uploads/{file_name}/download"


def contract_download_path(contract_id: str) -> str:
    return f"/api/contracts/{contract_id}/download"


def content_type_for_file(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def save_upload_bytes(content: bytes, original_name: str, mime_type: str) -> dict[str, Any]:
    ensure_storage()
    upload_id = new_id("upload")
    file_name = f"{upload_id}_{safe_file_name(original_name)}"
    path = UPLOADS_DIR / file_name
    path.write_bytes(content)
    record = {
        "id": upload_id,
        "fileName": file_name,
        "originalName": original_name,
        "mimeType": mime_type or "application/octet-stream",
        "size": len(content),
        "path": str(path),
    }
    (UPLOADS_DIR / f"{upload_id}.json").write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    return record


def load_upload(upload_id: str) -> dict[str, Any]:
    record_path = UPLOADS_DIR / f"{upload_id}.json"
    if not record_path.exists():
        raise HTTPException(status_code=404, detail="上传文件不存在")
    return json.loads(record_path.read_text(encoding="utf-8"))


def parse_data_source(value: str, fallback_mime_type: str) -> tuple[bytes, str]:
    prefix = "base64,"
    if value.startswith("data:") and prefix in value:
        metadata, encoded = value.split(prefix, 1)
        mime_type = metadata.removeprefix("data:").removesuffix(";")
        return base64.b64decode(encoded), mime_type or fallback_mime_type
    return base64.b64decode(value), fallback_mime_type


def last_user_message(input_data: dict[str, Any]) -> dict[str, Any] | None:
    messages = input_data.get("messages") or []
    for message in reversed(messages):
        if message.get("role") == "user":
            return message
    return None


def extract_agui_attachment(input_data: dict[str, Any]) -> dict[str, Any] | None:
    message = last_user_message(input_data)
    content = message.get("content") if message else None
    if not isinstance(content, list):
        return None
    for part in content:
        if not isinstance(part, dict) or part.get("type") not in {"document", "image"}:
            continue
        source = part.get("source")
        if not isinstance(source, dict):
            continue
        metadata = part.get("metadata") if isinstance(part.get("metadata"), dict) else {}
        source_type = source.get("type")
        mime_type = source.get("mimeType") or "application/octet-stream"
        file_name = metadata.get("fileName") or metadata.get("filename") or metadata.get("name") or f"quote{mimetypes.guess_extension(mime_type) or '.bin'}"
        if source_type == "url":
            response = requests.get(source.get("value"), timeout=30)
            response.raise_for_status()
            return save_upload_bytes(response.content, file_name, mime_type)
        if source_type == "data":
            content_bytes, parsed_mime = parse_data_source(source.get("value", ""), mime_type)
            return save_upload_bytes(content_bytes, file_name, parsed_mime)
    return None


def generate_contract(upload_id: str, template_type: str) -> dict[str, Any]:
    upload = load_upload(upload_id)
    config = get_template_config(template_type)
    quote_text = extract_text_from_file(Path(upload["path"]), upload.get("mimeType", ""))
    extracted = extract_template_render_data(quote_text, config)
    render_data = merge_render_data(extracted, config)
    contract_id = new_id("contract")
    contract_path = render_contract(render_data, config, contract_id)
    draft = {
        "upload": upload,
        "templateType": config.type,
        "quoteTextLength": len(quote_text),
        "extractedData": extracted,
        "renderData": render_data,
        "contractId": contract_id,
        "contractPath": str(contract_path),
    }
    (DRAFTS_DIR / f"{contract_id}.json").write_text(json.dumps(draft, ensure_ascii=False), encoding="utf-8")
    return draft


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/", response_class=HTMLResponse)
@app.get("/h5", response_class=HTMLResponse)
def h5(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "h5.html",
        {"templates": template_options()},
    )


@app.post("/api/uploads")
async def upload_file(file: UploadFile = File(...)) -> dict[str, Any]:
    content = await file.read()
    record = save_upload_bytes(content, file.filename or "quote.bin", file.content_type or "application/octet-stream")
    return {**record, "downloadUrl": upload_download_path(record["fileName"])}


@app.get("/api/uploads/{file_name}/download")
def download_upload(file_name: str) -> FileResponse:
    path = UPLOADS_DIR / Path(file_name).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="上传文件不存在")
    return FileResponse(path, media_type=content_type_for_file(path), filename=path.name)


@app.post("/api/contracts/generate")
def generate_contract_api(request: Request, uploadId: str = Form(...), templateType: str = Form("caigouhetong")) -> dict[str, Any]:
    draft = generate_contract(uploadId, templateType)
    url = contract_download_path(draft["contractId"])
    return {
        "contractId": draft["contractId"],
        "downloadUrl": absolute_url(request, url),
        "templateType": draft["templateType"],
        "quoteTextLength": draft["quoteTextLength"],
    }


@app.get("/api/contracts/{contract_id}/download")
def download_contract(contract_id: str) -> FileResponse:
    path = CONTRACTS_DIR / f"{Path(contract_id).name}.docx"
    if not path.exists():
        raise HTTPException(status_code=404, detail="合同文件不存在")
    return FileResponse(path, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename=path.name)


async def agui_stream(input_data: dict[str, Any], request: Request) -> AsyncGenerator[bytes, None]:
    thread_id = input_data.get("threadId") or new_id("thread")
    run_id = input_data.get("runId") or new_id("run")
    message_id = new_id("msg")
    yield sse_event({"type": "RUN_STARTED", "threadId": thread_id, "runId": run_id})
    yield sse_event({"type": "TEXT_MESSAGE_START", "messageId": message_id, "role": "assistant"})
    try:
        forwarded = input_data.get("forwardedProps") if isinstance(input_data.get("forwardedProps"), dict) else {}
        if forwarded.get("healthCheck"):
            yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "AGUI H5 服务正常。"})
            yield sse_event({"type": "TEXT_MESSAGE_END", "messageId": message_id})
            yield sse_event({"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id, "result": {"ok": True}})
            return

        upload_id = forwarded.get("uploadId") or (input_data.get("state") or {}).get("uploadId")
        template_type = forwarded.get("templateType") or (input_data.get("state") or {}).get("templateType") or "caigouhetong"
        if not upload_id:
            attachment = extract_agui_attachment(input_data)
            if attachment:
                upload_id = attachment["id"]
                yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": f"已收到附件：{attachment['originalName']}\n"})
            else:
                yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "未收到报价单文件，请在 H5 页面上传文件或提供 AGUI document/image。"})
                yield sse_event({"type": "TEXT_MESSAGE_END", "messageId": message_id})
                yield sse_event({"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id, "result": {"needsUpload": True}})
                return

        yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "正在解析报价单...\n"})
        yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "正在生成合同...\n"})
        draft = generate_contract(upload_id, template_type)
        download_url = absolute_url(request, contract_download_path(draft["contractId"]))
        yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": f"合同已生成，点击下载：{download_url}"})
        yield sse_event({"type": "CUSTOM", "name": "contract_generated", "value": {"contractId": draft["contractId"], "downloadUrl": download_url}})
        yield sse_event({"type": "TEXT_MESSAGE_END", "messageId": message_id})
        yield sse_event({"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id, "result": {"contractId": draft["contractId"], "downloadUrl": download_url}})
    except Exception as exc:
        yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": f"处理失败：{exc}"})
        yield sse_event({"type": "TEXT_MESSAGE_END", "messageId": message_id})
        yield sse_event({"type": "RUN_ERROR", "message": str(exc)})


@app.post("/ag-ui/agent")
async def agui_agent(request: Request) -> StreamingResponse:
    input_data = await request.json()
    return StreamingResponse(agui_stream(input_data, request), media_type="text/event-stream")


@app.post("/api/dingtalk/login")
def dingtalk_login(payload: dict[str, Any]) -> JSONResponse:
    code = payload.get("code")
    client_id = os.getenv("DINGTALK_CLIENT_ID", "").strip()
    client_secret = os.getenv("DINGTALK_CLIENT_SECRET", "").strip()
    configured = bool(client_id and client_secret)
    if not code or not configured:
        return JSONResponse({
            "ok": True,
            "configured": configured,
            "codeReceived": bool(code),
            "corpId": os.getenv("DINGTALK_CORP_ID"),
        })

    token_response = requests.post(
        "https://api.dingtalk.com/v1.0/oauth2/userAccessToken",
        json={
            "clientId": client_id,
            "clientSecret": client_secret,
            "code": code,
            "grantType": "authorization_code",
        },
        timeout=15,
    )
    token_response.raise_for_status()
    token_body = token_response.json()
    access_token = token_body.get("accessToken")
    if not access_token:
        raise HTTPException(status_code=502, detail="钉钉未返回用户 accessToken")

    user_response = requests.get(
        "https://api.dingtalk.com/v1.0/contact/users/me",
        headers={"x-acs-dingtalk-access-token": access_token},
        timeout=15,
    )
    user_response.raise_for_status()
    user = user_response.json()
    return JSONResponse({
        "ok": True,
        "configured": True,
        "corpId": token_body.get("corpId") or os.getenv("DINGTALK_CORP_ID"),
        "user": {
            "unionId": user.get("unionId"),
            "openId": user.get("openId"),
            "nick": user.get("nick"),
            "avatarUrl": user.get("avatarUrl"),
        },
    })


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "9000")))
