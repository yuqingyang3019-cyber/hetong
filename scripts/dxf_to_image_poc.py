from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "agent") not in sys.path:
    sys.path.insert(0, str(ROOT / "agent"))

from contract.drawing import DrawingConvertError, render_dxf_to_png


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
