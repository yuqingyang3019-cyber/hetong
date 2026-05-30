from __future__ import annotations

import argparse
import logging
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from agent.yonyou_vendor import (  # noqa: E402
    DEFAULT_PAGE_SIZE,
    EXPLICIT_VENDOR_DATA_FIELDS,
    api_get,
    as_text,
    dedupe_vendors,
    env_int,
    get_access_token,
    optional_env,
    query_vendor_page,
    resolve_endpoints,
    success_code,
    vendor_cache_row,
    vendor_is_available,
    write_supplier_cache_xlsx,
    now_shanghai,
)


logger = logging.getLogger("yonyou_supplier_sync")
VENDOR_DETAIL_PATH = "/yonbip/digitalModel/vendor/detail"


def configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def load_env_file(path: Path) -> None:
    if not path.exists():
        logger.warning("env 文件不存在：%s", path)
        return
    loaded: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
            loaded.append(key)
    logger.info("已加载 env 文件：%s", path)
    logger.info("env 文件注入键：%s", ", ".join(loaded) if loaded else "无新增")


def mask_presence(name: str) -> str:
    value = optional_env(name)
    if not value:
        return "缺失"
    if "SECRET" in name or "KEY" in name:
        return f"已配置（长度 {len(value)}）"
    return value


def log_config() -> None:
    logger.info("YONBIP_APP_KEY：%s", mask_presence("YONBIP_APP_KEY"))
    logger.info("YONBIP_APP_SECRET：%s", mask_presence("YONBIP_APP_SECRET"))
    logger.info("YONBIP_GATEWAY_URL：%s", mask_presence("YONBIP_GATEWAY_URL") or "使用默认")
    logger.info("YONBIP_TOKEN_URL：%s", mask_presence("YONBIP_TOKEN_URL") or "使用默认")
    logger.info("YONBIP_ORG_ID：%s", mask_presence("YONBIP_ORG_ID") or "未配置")
    logger.info("YONBIP_VENDOR_PAGE_SIZE：%s", mask_presence("YONBIP_VENDOR_PAGE_SIZE") or str(DEFAULT_PAGE_SIZE))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="本地同步用友供应商档案并生成 Excel 调试脚本")
    parser.add_argument("--env-file", default=".env.yonbip.local", help="本地 env 文件路径")
    parser.add_argument("--output-dir", default="tmp", help="Excel 输出目录")
    parser.add_argument("--page-size", type=int, default=None, help="覆盖 YONBIP_VENDOR_PAGE_SIZE")
    parser.add_argument("--max-pages", type=int, default=0, help="最多抓取页数；0 表示抓全量")
    parser.add_argument("--fetch-detail-missing", action="store_true", help="对缺关键字段的供应商调用 vendor/detail 尝试补齐")
    parser.add_argument("--detail-limit", type=int, default=0, help="最多查询详情条数；0 表示不限制")
    parser.add_argument("--detail-interval", type=float, default=1.1, help="详情接口调用间隔秒数，默认避开 60 次/分钟限流")
    parser.add_argument("--timestamped", action="store_true", help="输出带时间戳的文件名，默认覆盖 supplier-cache-debug.xlsx")
    parser.add_argument("--verbose", action="store_true", help="输出更详细日志")
    return parser.parse_args()


def build_manifest(
    *,
    synced_at: str,
    source_record_count: int,
    fetched_count: int,
    available_count: int,
    unique_count: int,
    page_size: int,
    max_pages: int,
    token_expire: int,
) -> dict[str, Any]:
    return {
        "syncedAt": synced_at,
        "sourceRecordCount": source_record_count,
        "fetchedRecordCount": fetched_count,
        "availableRecordCount": available_count,
        "uniqueVendorCount": unique_count,
        "pageSize": page_size,
        "maxPages": max_pages or "all",
        "sourceApi": "vendor/queryByPage",
        "tokenExpire": token_expire,
    }


def cache_row_from_record(record: dict[str, Any]) -> dict[str, Any]:
    return vendor_cache_row(record)


def row_missing_detail_fields(row: dict[str, Any]) -> bool:
    return not all([
        row.get("creditcode"),
        row.get("address"),
        row.get("contactphone"),
        row.get("openaccountbankName"),
        row.get("bankAccount"),
        row.get("vendorFax"),
    ])


def detail_vendor(gateway_url: str, access_token: str, record: dict[str, Any]) -> dict[str, Any]:
    vendor_id = as_text(record.get("id"))
    if not vendor_id:
        return {}
    params: dict[str, Any] = {"access_token": access_token, "id": vendor_id}
    org_id = optional_env("YONBIP_ORG_ID")
    if org_id:
        params["orgId"] = org_id
    body = api_get(f"{gateway_url}{VENDOR_DETAIL_PATH}", params)
    if not success_code(body, "200"):
        raise RuntimeError(f"供应商详情查询失败：{body.get('message') or body}")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    return data


def merge_record_detail(record: dict[str, Any], detail: dict[str, Any]) -> dict[str, Any]:
    merged = dict(record)
    for key in (
        "creditcode",
        "address",
        "vendoraddress",
        "contactphone",
        "vendorphone",
        "vendorfax",
        "org_name",
        "orgName",
        "accessstatus",
        "freezestatus",
        "pubts",
    ):
        if not as_text(merged.get(key)) and as_text(detail.get(key)):
            merged[key] = detail.get(key)
    if not merged.get("vendorbanks") and detail.get("vendorbanks"):
        merged["vendorbanks"] = detail.get("vendorbanks")
    return merged


def fill_missing_from_detail(
    gateway_url: str,
    access_token: str,
    records: list[dict[str, Any]],
    detail_limit: int,
    detail_interval: float,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    filled: list[dict[str, Any]] = []
    stats = {
        "detailChecked": 0,
        "detailFailed": 0,
        "creditcodeFilled": 0,
        "addressFilled": 0,
        "phoneFilled": 0,
        "bankFilled": 0,
        "faxFilled": 0,
    }
    for index, record in enumerate(records, 1):
        before = cache_row_from_record(record)
        should_fetch = row_missing_detail_fields(before)
        detail_attempts = stats["detailChecked"] + stats["detailFailed"]
        if detail_limit and detail_attempts >= detail_limit:
            should_fetch = False
        if not should_fetch:
            filled.append(record)
            continue
        try:
            detail = detail_vendor(gateway_url, access_token, record)
            stats["detailChecked"] += 1
            merged = merge_record_detail(record, detail)
            after = cache_row_from_record(merged)
            if not before.get("creditcode") and after.get("creditcode"):
                stats["creditcodeFilled"] += 1
            if not before.get("address") and after.get("address"):
                stats["addressFilled"] += 1
            if not before.get("contactphone") and after.get("contactphone"):
                stats["phoneFilled"] += 1
            if (not before.get("bankAccount") or not before.get("openaccountbankName")) and (after.get("bankAccount") or after.get("openaccountbankName")):
                stats["bankFilled"] += 1
            if not before.get("vendorFax") and after.get("vendorFax"):
                stats["faxFilled"] += 1
            filled.append(merged)
        except Exception as exc:
            stats["detailFailed"] += 1
            response = getattr(exc, "response", None)
            status_code = getattr(response, "status_code", None)
            error_text = f"HTTP {status_code}" if status_code else exc.__class__.__name__
            logger.warning("详情查询失败：index=%s id=%s name=%s error=%s", index, as_text(record.get("id")), as_text(record.get("name")), error_text)
            filled.append(record)
        detail_attempts = stats["detailChecked"] + stats["detailFailed"]
        if detail_attempts and detail_attempts % 50 == 0:
            logger.info("详情补齐进度：已请求 %s，成功 %s，失败 %s", detail_attempts, stats["detailChecked"], stats["detailFailed"])
        if detail_interval > 0:
            time.sleep(detail_interval)
    return filled, stats


def main() -> int:
    args = parse_args()
    configure_logging(args.verbose)

    try:
        load_env_file(PROJECT_ROOT / args.env_file)
        if args.page_size:
            os.environ["YONBIP_VENDOR_PAGE_SIZE"] = str(args.page_size)
        log_config()

        logger.info("解析用友接口地址...")
        gateway_url, token_url = resolve_endpoints()
        logger.info("gatewayUrl=%s", gateway_url)
        logger.info("tokenUrl=%s", token_url)

        logger.info("开始获取用友 access_token...")
        access_token, expire = get_access_token(token_url)
        logger.info("access_token 获取成功：长度=%s，expire=%s", len(access_token), expire)

        page_size = env_int("YONBIP_VENDOR_PAGE_SIZE", DEFAULT_PAGE_SIZE)
        org_id = optional_env("YONBIP_ORG_ID")
        all_records: list[dict[str, Any]] = []
        source_record_count = 0
        page_index = 1

        logger.info("开始分页读取供应商：pageSize=%s，maxPages=%s", page_size, args.max_pages or "all")
        logger.info("使用显式字段 data：%s", EXPLICIT_VENDOR_DATA_FIELDS)
        while True:
            page = query_vendor_page(gateway_url, access_token, page_index, page_size)
            if page_index == 1:
                source_record_count = page["recordCount"]
            records = page["records"]
            all_records.extend(records)
            logger.info(
                "分页完成：page=%s/%s，本页=%s，累计=%s，recordCount=%s",
                page_index,
                page["pageCount"] or "?",
                len(records),
                len(all_records),
                source_record_count,
            )

            if args.max_pages and page_index >= args.max_pages:
                logger.info("达到 --max-pages=%s，停止继续抓取", args.max_pages)
                break
            if not records or (page["pageCount"] and page_index >= page["pageCount"]):
                break
            if source_record_count and len(all_records) >= source_record_count:
                break
            page_index += 1

        logger.info("开始过滤冻结/停用供应商...")
        available_records = [record for record in all_records if vendor_is_available(record)]
        logger.info("过滤完成：原始抓取=%s，可用=%s", len(all_records), len(available_records))

        logger.info("开始按供应商 id 去重...")
        unique_records = dedupe_vendors(available_records, org_id)
        detail_stats: dict[str, int] = {}
        if args.fetch_detail_missing:
            logger.info("开始调用 vendor/detail 补齐缺失字段：detailLimit=%s，detailInterval=%ss", args.detail_limit or "all", args.detail_interval)
            unique_records, detail_stats = fill_missing_from_detail(gateway_url, access_token, unique_records, args.detail_limit, args.detail_interval)
            logger.info("详情补齐完成：%s", detail_stats)
        rows = [cache_row_from_record(record) for record in unique_records]
        logger.info("去重完成：uniqueVendorCount=%s", len(rows))

        output_dir = (PROJECT_ROOT / args.output_dir).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        synced_at = now_shanghai().isoformat(timespec="seconds")
        file_name = f"supplier-cache-debug_{now_shanghai().strftime('%Y%m%d_%H%M%S')}.xlsx" if args.timestamped else "supplier-cache-debug.xlsx"
        output_path = output_dir / file_name
        manifest = build_manifest(
            synced_at=synced_at,
            source_record_count=source_record_count or len(all_records),
            fetched_count=len(all_records),
            available_count=len(available_records),
            unique_count=len(rows),
            page_size=page_size,
            max_pages=args.max_pages,
            token_expire=expire,
        )
        manifest.update(detail_stats)

        logger.info("开始写入 Excel：%s", output_path)
        write_supplier_cache_xlsx(output_path, rows, manifest)
        logger.info("Excel 写入完成：%s（%s bytes）", output_path, output_path.stat().st_size)
        logger.info("同步调试完成")
        return 0
    except Exception as exc:
        logger.error("同步调试失败：%s: %s", exc.__class__.__name__, exc)
        logger.error("异常堆栈：\n%s", traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
