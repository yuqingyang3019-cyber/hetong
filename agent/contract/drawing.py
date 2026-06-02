from __future__ import annotations

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
        raise DrawingConvertError("仅支持 DXF 图纸附件")

    doc, auditor = _load_dxf(dxf_path)
    if auditor.has_errors:
        errors = "; ".join(str(error) for error in auditor.errors[:5])
        raise DrawingConvertError(f"DXF 图纸审计发现严重错误：{errors}")

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
