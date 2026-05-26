from __future__ import annotations

import json
import logging
import os
import time
from typing import Any
from urllib.parse import urlparse

from openai import APITimeoutError, OpenAI

from .config import TemplateConfig

logger = logging.getLogger("agentrun")


SYSTEM_PROMPT = """你是合同占位符字段匹配助手。你的任务是根据用户提供的报价单解析文本和用户补充信息，理解采购内容与表格结构，再按「合同模板字段契约」输出 JSON。
规则：
1. 只输出严格 JSON，不要 Markdown、解释或其它文本。
2. 输出中的字段名必须与字段契约中的英文 key 完全一致；禁止输出契约中未声明的字段名。
3. 标量字段在报价单中找不到依据时填 null；不要凭常识编造公司税号、银行账号等商务标识信息。
4. 可以根据同义词、列名、上下文做合理匹配。
5. 用户补充信息用于补足报价单中缺失或不清晰的字段；当报价单文本和补充信息冲突时，优先使用用户补充信息。
6. 表格为数组：报价单中凡单独计价的一行各占一行；每行对象只包含契约声明的列，无法确定的列填 null。
7. 不要合并多笔计价到一行；不要把页脚总价误填到某一明细行的 totalPrice。
8. 表格示例行仅为结构示意，你必须按报价单实际行数输出多行。"""


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"缺少环境变量 {name}")
    return value


def env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise RuntimeError(f"环境变量 {name} 必须是数字") from exc
    if value <= 0:
        raise RuntimeError(f"环境变量 {name} 必须大于 0")
    return value


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"环境变量 {name} 必须是整数") from exc
    if value < 0:
        raise RuntimeError(f"环境变量 {name} 不能小于 0")
    return value


def log_meta(**meta: Any) -> str:
    clean = {key: value for key, value in meta.items() if value is not None}
    if not clean:
        return ""
    try:
        return " " + json.dumps(clean, ensure_ascii=False, default=str)
    except Exception:
        return " [meta_unserializable]"


def base_url_host(base_url: str) -> str:
    parsed = urlparse(base_url)
    return parsed.netloc or parsed.path or "unknown"


def elapsed_ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def is_timeout_error(exc: BaseException) -> bool:
    if isinstance(exc, (APITimeoutError, TimeoutError)):
        return True
    class_name = exc.__class__.__name__.lower()
    message = str(exc).lower()
    return "timeout" in class_name or "timed out" in message or "timeout" in message


def _set_by_dot_path(target: dict[str, Any], dot_path: str, value: Any) -> None:
    parts = dot_path.split(".")
    current = target
    for part in parts[:-1]:
        next_value = current.get(part)
        if not isinstance(next_value, dict):
            next_value = {}
            current[part] = next_value
        current = next_value
    current[parts[-1]] = value


def build_output_shape(config: TemplateConfig) -> dict[str, Any]:
    shape: dict[str, Any] = {}
    for key in config.scalar_keys:
        _set_by_dot_path(shape, key, None)
    for table_name, columns in config.table_bindings.items():
        empty_row = {column: None for column in columns}
        shape[table_name] = [empty_row, empty_row.copy()]
    return shape


def prune_to_shape(shape: Any, patch: Any) -> Any:
    if shape is None:
        return patch if patch is not None else None
    if isinstance(shape, list) and shape and isinstance(shape[0], dict):
        if not isinstance(patch, list):
            return []
        columns = list(shape[0].keys())
        return [
            {column: row.get(column) if isinstance(row, dict) else None for column in columns}
            for row in patch
        ]
    if isinstance(shape, dict):
        source = patch if isinstance(patch, dict) else {}
        return {key: prune_to_shape(value, source.get(key)) for key, value in shape.items()}
    return shape


def extract_template_render_data(quote_text: str, config: TemplateConfig, extra_info: str | None = None) -> dict[str, Any]:
    api_key = require_env("DASHSCOPE_API_KEY")
    model = require_env("DASHSCOPE_MODEL")
    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").strip()
    enable_thinking = os.getenv("DASHSCOPE_ENABLE_THINKING", "false").lower() == "true"
    timeout_seconds = env_float("DASHSCOPE_TIMEOUT_SECONDS", 60.0)
    max_retries = env_int("DASHSCOPE_MAX_RETRIES", 1)
    output_shape = build_output_shape(config)
    user_payload = {
        "quoteText": quote_text,
        "extraInfo": (extra_info or "").strip(),
        "templateFieldDefinitions": {
            "scalars": config.schema.get("scalars", []),
            "tables": config.schema.get("tables", {}),
        },
        "outputShapeExample": output_shape,
    }
    start = time.perf_counter()
    logger.info(
        "%s%s",
        "dashscope request start",
        log_meta(
            model=model,
            baseUrlHost=base_url_host(base_url),
            enableThinking=enable_thinking,
            timeoutSeconds=timeout_seconds,
            maxRetries=max_retries,
            templateType=config.type,
            quoteTextLength=len(quote_text),
            extraInfoLength=len(user_payload["extraInfo"]),
            scalarCount=len(config.scalar_keys),
            tableCount=len(config.table_bindings),
        ),
    )
    try:
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout_seconds, max_retries=max_retries)
        completion = client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            extra_body={"enable_thinking": enable_thinking},
        )
    except Exception as exc:
        error_type = "timeout" if is_timeout_error(exc) else exc.__class__.__name__
        logger.exception(
            "%s%s",
            "dashscope request failed",
            log_meta(
                model=model,
                baseUrlHost=base_url_host(base_url),
                enableThinking=enable_thinking,
                timeoutSeconds=timeout_seconds,
                maxRetries=max_retries,
                templateType=config.type,
                elapsedMs=elapsed_ms(start),
                errorType=error_type,
                error=str(exc),
            ),
        )
        raise
    content = completion.choices[0].message.content
    logger.info(
        "%s%s",
        "dashscope request finished",
        log_meta(
            model=model,
            templateType=config.type,
            contentLength=len(content or ""),
            elapsedMs=elapsed_ms(start),
        ),
    )
    if not content or not content.strip():
        raise RuntimeError("百炼模型返回内容为空")
    parsed = json.loads(content)
    return prune_to_shape(output_shape, parsed)
