from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any


class DrawingConvertError(RuntimeError):
    pass


def _load_dxf(path: Path) -> tuple[Any, Any]:
    try:
        import ezdxf
        from ezdxf import recover
    except ImportError as exc:
        raise DrawingConvertError("未安装 DXF 图纸转换依赖") from exc

    try:
        return recover.readfile(path)
    except OSError as exc:
        raise DrawingConvertError(f"读取 DXF 图纸失败：{exc}") from exc
    except ezdxf.DXFStructureError as exc:
        raise DrawingConvertError(f"DXF 图纸结构损坏或格式不受支持：{exc}") from exc


def render_dxf_to_png(
    dxf_path: Path,
    output_path: Path,
    *,
    dpi: int = 200,
    lineweight_scaling: float = 0.06,
    min_lineweight: float = 0.01,
) -> Path:
    try:
        from ezdxf.addons.drawing import Frontend, RenderContext, config, layout, pymupdf
    except ImportError as exc:
        raise DrawingConvertError("未安装 DXF 图纸转换依赖") from exc

    if dxf_path.suffix.lower() != ".dxf":
        raise DrawingConvertError("仅支持 DXF 图纸")

    load_start = time.perf_counter()
    doc, auditor = _load_dxf(dxf_path)
    if auditor.has_errors:
        errors = "; ".join(str(error) for error in auditor.errors[:5])
        raise DrawingConvertError(f"DXF 图纸审计发现严重错误：{errors}")
    print(f"DXF 读取完成，用时 {int((time.perf_counter() - load_start) * 1000)}ms")

    backend = pymupdf.PyMuPdfBackend()
    render_config = config.Configuration(
        background_policy=config.BackgroundPolicy.WHITE,
        color_policy=config.ColorPolicy.BLACK,
        hatch_policy=config.HatchPolicy.NORMAL,
        lineweight_scaling=lineweight_scaling,
        min_lineweight=min_lineweight,
    )
    Frontend(RenderContext(doc), backend, config=render_config).draw_layout(doc.modelspace(), finalize=True)

    page = layout.Page(216, 279)
    png_bytes = backend.get_pixmap_bytes(page, fmt="png", dpi=dpi, alpha=False)
    if not png_bytes:
        raise DrawingConvertError("DXF 图纸转换结果为空")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(png_bytes)
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="DXF 转 PNG 最小 PoC，使用 ezdxf + PyMuPDF。")
    parser.add_argument("input", help="输入 DXF 文件路径")
    parser.add_argument("output", help="输出 PNG 文件路径")
    parser.add_argument("--dpi", type=int, default=200, help="输出图片 DPI，默认 200")
    parser.add_argument("--lineweight-scaling", type=float, default=0.06, help="线宽缩放系数，默认 0.06")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    if not input_path.exists() or input_path.suffix.lower() != ".dxf":
        print(f"转换失败：输入文件必须是存在的 .dxf 文件：{input_path}", file=sys.stderr)
        return 1
    if output_path.suffix.lower() != ".png":
        print(f"转换失败：输出文件必须是 .png：{output_path}", file=sys.stderr)
        return 1
    try:
        render_dxf_to_png(input_path, output_path, dpi=args.dpi, lineweight_scaling=args.lineweight_scaling)
    except DrawingConvertError as exc:
        print(f"转换失败：{exc}", file=sys.stderr)
        return 1
    print(f"DXF 转 PNG 完成：{input_path} -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
