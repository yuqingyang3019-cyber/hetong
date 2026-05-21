from __future__ import annotations

import base64
import json
import logging
import mimetypes
import os
import sys
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

agentrun_logger = logging.getLogger("agentrun")
if not agentrun_logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s [agentrun] %(levelname)s %(message)s"))
    agentrun_logger.addHandler(handler)
agentrun_logger.setLevel(logging.INFO)
agentrun_logger.propagate = False


def elapsed_ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def log_meta(**meta: Any) -> str:
    clean = {key: value for key, value in meta.items() if value is not None}
    if not clean:
        return ""
    try:
        return " " + json.dumps(clean, ensure_ascii=False, default=str)
    except Exception:
        return " [meta_unserializable]"


def log_info(message: str, **meta: Any) -> None:
    agentrun_logger.info("%s%s", message, log_meta(**meta))


def log_warning(message: str, **meta: Any) -> None:
    agentrun_logger.warning("%s%s", message, log_meta(**meta))


def log_exception(message: str, exc: Exception, **meta: Any) -> None:
    agentrun_logger.exception("%s%s", message, log_meta(error=str(exc), **meta))


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
    log_info(
        "upload persisted",
        uploadId=upload_id,
        fileName=file_name,
        originalName=original_name,
        mimeType=record["mimeType"],
        size=record["size"],
    )
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


async def read_upload_payload(request: Request, file: UploadFile | None) -> tuple[bytes, str, str, int | None, str]:
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="上传请求体格式不正确")
        original_name = str(payload.get("originalName") or payload.get("fileName") or "quote.bin")
        mime_type = str(payload.get("mimeType") or "application/octet-stream")
        data = payload.get("data") or payload.get("contentBase64")
        if not isinstance(data, str) or not data:
            raise HTTPException(status_code=400, detail="上传请求缺少文件内容")
        try:
            content, parsed_mime = parse_data_source(data, mime_type)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="上传文件内容不是合法 base64") from exc
        declared_size = payload.get("size")
        return content, original_name, parsed_mime, declared_size if isinstance(declared_size, int) else None, "json-base64"

    if file is None:
        raise HTTPException(status_code=400, detail="请上传报价单文件")
    content = await file.read()
    return content, file.filename or "quote.bin", file.content_type or "application/octet-stream", None, "multipart"


def last_user_message(input_data: dict[str, Any]) -> dict[str, Any] | None:
    messages = input_data.get("messages") or []
    for message in reversed(messages):
        if message.get("role") == "user":
            return message
    return None


def summarize_agui_input(input_data: dict[str, Any]) -> dict[str, Any]:
    messages = input_data.get("messages") if isinstance(input_data.get("messages"), list) else []
    message = last_user_message(input_data)
    content = message.get("content") if message else None
    forwarded = input_data.get("forwardedProps") if isinstance(input_data.get("forwardedProps"), dict) else {}
    state = input_data.get("state") if isinstance(input_data.get("state"), dict) else {}
    return {
        "threadId": input_data.get("threadId"),
        "runId": input_data.get("runId"),
        "messageCount": len(messages),
        "contentKind": "multimodal" if isinstance(content, list) else type(content).__name__,
        "contentTypes": [part.get("type") for part in content if isinstance(part, dict)] if isinstance(content, list) else None,
        "forwardedPropKeys": sorted(forwarded.keys()),
        "stateKeys": sorted(state.keys()),
    }


def table_row_counts(data: dict[str, Any]) -> dict[str, int]:
    return {key: len(value) for key, value in data.items() if isinstance(value, list)}


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
        log_info("agui attachment detected", sourceType=source_type, fileName=file_name, mimeType=mime_type)
        if source_type == "url":
            download_start = time.perf_counter()
            response = requests.get(source.get("value"), timeout=30)
            response.raise_for_status()
            log_info(
                "agui attachment downloaded",
                fileName=file_name,
                mimeType=mime_type,
                size=len(response.content),
                elapsedMs=elapsed_ms(download_start),
            )
            return save_upload_bytes(response.content, file_name, mime_type)
        if source_type == "data":
            parse_start = time.perf_counter()
            content_bytes, parsed_mime = parse_data_source(source.get("value", ""), mime_type)
            log_info(
                "agui attachment decoded",
                fileName=file_name,
                mimeType=parsed_mime,
                size=len(content_bytes),
                elapsedMs=elapsed_ms(parse_start),
            )
            return save_upload_bytes(content_bytes, file_name, parsed_mime)
    return None


def extract_quote_text(upload_id: str) -> tuple[dict[str, Any], str]:
    upload = load_upload(upload_id)
    extract_start = time.perf_counter()
    quote_text = extract_text_from_file(Path(upload["path"]), upload.get("mimeType", ""))
    log_info(
        "quote text extracted",
        uploadId=upload_id,
        fileName=upload.get("fileName"),
        quoteTextLength=len(quote_text),
        elapsedMs=elapsed_ms(extract_start),
    )
    return upload, quote_text


def generate_contract(upload_id: str, template_type: str, quote_text: str | None = None) -> dict[str, Any]:
    start = time.perf_counter()
    has_confirmed_text = bool(quote_text and quote_text.strip())
    log_info("contract generation start", uploadId=upload_id, templateType=template_type, confirmedQuoteText=has_confirmed_text)
    try:
        upload = load_upload(upload_id)
        log_info(
            "contract upload loaded",
            uploadId=upload_id,
            fileName=upload.get("fileName"),
            originalName=upload.get("originalName"),
            mimeType=upload.get("mimeType"),
            size=upload.get("size"),
        )

        config = get_template_config(template_type)
        log_info("contract template loaded", uploadId=upload_id, templateType=config.type)

        if has_confirmed_text:
            quote_text = quote_text.strip()
            log_info(
                "quote text confirmed by user",
                uploadId=upload_id,
                fileName=upload.get("fileName"),
                quoteTextLength=len(quote_text),
            )
        else:
            upload, quote_text = extract_quote_text(upload_id)

        llm_start = time.perf_counter()
        log_info("llm extraction start", uploadId=upload_id, templateType=config.type, quoteTextLength=len(quote_text))
        extracted = extract_template_render_data(quote_text, config)
        log_info(
            "llm extraction finished",
            uploadId=upload_id,
            templateType=config.type,
            tableRowCounts=table_row_counts(extracted),
            elapsedMs=elapsed_ms(llm_start),
        )

        render_data = merge_render_data(extracted, config)
        contract_id = new_id("contract")

        render_start = time.perf_counter()
        log_info("contract render start", uploadId=upload_id, contractId=contract_id, templateType=config.type)
        contract_path = render_contract(render_data, config, contract_id)
        log_info(
            "contract render finished",
            uploadId=upload_id,
            contractId=contract_id,
            outputFile=contract_path.name,
            elapsedMs=elapsed_ms(render_start),
        )

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
        log_info(
            "contract generation finished",
            uploadId=upload_id,
            contractId=contract_id,
            templateType=config.type,
            elapsedMs=elapsed_ms(start),
        )
        return draft
    except Exception as exc:
        log_exception("contract generation failed", exc, uploadId=upload_id, templateType=template_type, elapsedMs=elapsed_ms(start))
        raise


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
async def upload_file(request: Request, file: UploadFile | None = File(None)) -> dict[str, Any]:
    start = time.perf_counter()
    client_host = request.client.host if request.client else None
    content_type = request.headers.get("content-type", "")
    log_info("upload request start", clientHost=client_host, contentType=content_type)
    try:
        content, original_name, mime_type, declared_size, uploadMode = await read_upload_payload(request, file)
        log_info(
            "upload bytes read",
            originalName=original_name,
            mimeType=mime_type,
            size=len(content),
            declaredSize=declared_size,
            uploadMode=uploadMode,
        )
        if not content:
            log_warning(
                "upload request rejected empty file",
                clientHost=client_host,
                originalName=original_name,
                mimeType=mime_type,
                declaredSize=declared_size,
                uploadMode=uploadMode,
                elapsedMs=elapsed_ms(start),
            )
            raise HTTPException(status_code=400, detail="上传文件为空，请重新选择报价单文件")
        if declared_size is not None and declared_size != len(content):
            log_warning(
                "upload size mismatch",
                clientHost=client_host,
                originalName=original_name,
                declaredSize=declared_size,
                decodedSize=len(content),
                uploadMode=uploadMode,
            )
        record = save_upload_bytes(content, original_name, mime_type)
        log_info(
            "upload request finished",
            clientHost=client_host,
            uploadId=record["id"],
            fileName=record["fileName"],
            uploadMode=uploadMode,
            elapsedMs=elapsed_ms(start),
        )
        return {**record, "downloadUrl": upload_download_path(record["fileName"])}
    except HTTPException:
        raise
    except Exception as exc:
        log_exception("upload request failed", exc, clientHost=client_host, originalName=original_name, elapsedMs=elapsed_ms(start))
        raise


@app.get("/api/uploads/{file_name}/download")
def download_upload(file_name: str) -> FileResponse:
    path = UPLOADS_DIR / Path(file_name).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="上传文件不存在")
    return FileResponse(path, media_type=content_type_for_file(path), filename=path.name)


@app.post("/api/uploads/{upload_id}/quote-text")
async def parse_quote_text_api(upload_id: str, request: Request) -> dict[str, Any]:
    start = time.perf_counter()
    client_host = request.client.host if request.client else None
    template_type = "caigouhetong"
    if "application/json" in request.headers.get("content-type", ""):
        payload = await request.json()
        if isinstance(payload, dict) and payload.get("templateType"):
            template_type = str(payload["templateType"])
    log_info("quote text api request start", clientHost=client_host, uploadId=upload_id, templateType=template_type)
    upload, quote_text = extract_quote_text(upload_id)
    config = get_template_config(template_type)
    response = {
        "uploadId": upload_id,
        "originalName": upload.get("originalName"),
        "fileName": upload.get("fileName"),
        "mimeType": upload.get("mimeType"),
        "templateType": config.type,
        "quoteText": quote_text,
        "textLength": len(quote_text),
    }
    log_info(
        "quote text api request finished",
        clientHost=client_host,
        uploadId=upload_id,
        templateType=config.type,
        quoteTextLength=len(quote_text),
        elapsedMs=elapsed_ms(start),
    )
    return response


@app.post("/api/contracts/generate")
def generate_contract_api(
    request: Request,
    uploadId: str = Form(...),
    templateType: str = Form("caigouhetong"),
    quoteText: str | None = Form(None),
) -> dict[str, Any]:
    start = time.perf_counter()
    client_host = request.client.host if request.client else None
    log_info("contract api request start", clientHost=client_host, uploadId=uploadId, templateType=templateType)
    draft = generate_contract(uploadId, templateType, quoteText)
    url = contract_download_path(draft["contractId"])
    response = {
        "contractId": draft["contractId"],
        "downloadUrl": absolute_url(request, url),
        "templateType": draft["templateType"],
        "quoteTextLength": draft["quoteTextLength"],
    }
    log_info(
        "contract api request finished",
        clientHost=client_host,
        uploadId=uploadId,
        contractId=draft["contractId"],
        elapsedMs=elapsed_ms(start),
    )
    return response


@app.get("/api/contracts/{contract_id}/download")
def download_contract(contract_id: str) -> FileResponse:
    path = CONTRACTS_DIR / f"{Path(contract_id).name}.docx"
    if not path.exists():
        raise HTTPException(status_code=404, detail="合同文件不存在")
    return FileResponse(path, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename=path.name)


async def agui_stream(input_data: dict[str, Any], request: Request) -> AsyncGenerator[bytes, None]:
    start = time.perf_counter()
    thread_id = input_data.get("threadId") or new_id("thread")
    run_id = input_data.get("runId") or new_id("run")
    message_id = new_id("msg")
    run_summary = summarize_agui_input(input_data)
    run_summary.update({"threadId": thread_id, "runId": run_id, "messageId": message_id})
    log_info("agui run start", **run_summary)
    yield sse_event({"type": "RUN_STARTED", "threadId": thread_id, "runId": run_id})
    yield sse_event({"type": "TEXT_MESSAGE_START", "messageId": message_id, "role": "assistant"})
    try:
        forwarded = input_data.get("forwardedProps") if isinstance(input_data.get("forwardedProps"), dict) else {}
        if forwarded.get("healthCheck"):
            log_info("agui health check", threadId=thread_id, runId=run_id)
            yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "AGUI H5 服务正常。"})
            yield sse_event({"type": "TEXT_MESSAGE_END", "messageId": message_id})
            yield sse_event({"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id, "result": {"ok": True}})
            log_info("agui run finished", threadId=thread_id, runId=run_id, result="healthCheck", elapsedMs=elapsed_ms(start))
            return

        state = input_data.get("state") if isinstance(input_data.get("state"), dict) else {}
        upload_id = forwarded.get("uploadId") or state.get("uploadId")
        template_type = forwarded.get("templateType") or state.get("templateType") or "caigouhetong"
        quote_text_value = forwarded.get("quoteText") or state.get("quoteText")
        quote_text = quote_text_value.strip() if isinstance(quote_text_value, str) and quote_text_value.strip() else None
        log_info(
            "agui run context resolved",
            threadId=thread_id,
            runId=run_id,
            uploadId=upload_id,
            templateType=template_type,
            confirmedQuoteText=bool(quote_text),
        )
        if not upload_id:
            log_info("agui attachment lookup start", threadId=thread_id, runId=run_id)
            attachment = extract_agui_attachment(input_data)
            if attachment:
                upload_id = attachment["id"]
                log_info(
                    "agui attachment saved",
                    threadId=thread_id,
                    runId=run_id,
                    uploadId=upload_id,
                    originalName=attachment["originalName"],
                    size=attachment["size"],
                )
                yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": f"已收到附件：{attachment['originalName']}\n"})
            else:
                log_warning("agui run missing upload", threadId=thread_id, runId=run_id)
                yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "未收到报价单文件，请在 H5 页面上传文件或提供 AGUI document/image。"})
                yield sse_event({"type": "TEXT_MESSAGE_END", "messageId": message_id})
                yield sse_event({"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id, "result": {"needsUpload": True}})
                log_info("agui run finished", threadId=thread_id, runId=run_id, result="needsUpload", elapsedMs=elapsed_ms(start))
                return

        if quote_text:
            yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "已确认报价单文本。\n"})
        else:
            yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "正在解析报价单...\n"})
        yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "正在生成合同...\n"})
        log_info(
            "agui contract generation dispatch",
            threadId=thread_id,
            runId=run_id,
            uploadId=upload_id,
            templateType=template_type,
            confirmedQuoteText=bool(quote_text),
        )
        draft = generate_contract(upload_id, template_type, quote_text)
        download_url = absolute_url(request, contract_download_path(draft["contractId"]))
        yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": f"合同已生成，点击下载：{download_url}"})
        yield sse_event({"type": "CUSTOM", "name": "contract_generated", "value": {"contractId": draft["contractId"], "downloadUrl": download_url}})
        yield sse_event({"type": "TEXT_MESSAGE_END", "messageId": message_id})
        yield sse_event({"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id, "result": {"contractId": draft["contractId"], "downloadUrl": download_url}})
        log_info(
            "agui run finished",
            threadId=thread_id,
            runId=run_id,
            uploadId=upload_id,
            contractId=draft["contractId"],
            elapsedMs=elapsed_ms(start),
        )
    except Exception as exc:
        log_exception("agui run failed", exc, threadId=thread_id, runId=run_id, elapsedMs=elapsed_ms(start))
        yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": f"处理失败：{exc}"})
        yield sse_event({"type": "TEXT_MESSAGE_END", "messageId": message_id})
        yield sse_event({"type": "RUN_ERROR", "message": str(exc)})


@app.post("/ag-ui/agent")
async def agui_agent(request: Request) -> StreamingResponse:
    start = time.perf_counter()
    client_host = request.client.host if request.client else None
    try:
        input_data = await request.json()
    except Exception as exc:
        log_exception("agui request json parse failed", exc, clientHost=client_host, elapsedMs=elapsed_ms(start))
        raise
    log_info("agui request received", clientHost=client_host, elapsedMs=elapsed_ms(start), **summarize_agui_input(input_data))
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
