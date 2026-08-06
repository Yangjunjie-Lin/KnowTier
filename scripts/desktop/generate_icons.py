from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

CANVAS_SIZE = 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate deterministic KnowTier desktop icons")
    parser.add_argument("--output", type=Path, default=Path("frontend/src-tauri/icons"))
    return parser.parse_args()


def render_icon() -> Image.Image:
    size = (CANVAS_SIZE, CANVAS_SIZE)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    gradient = ImageOps.colorize(
        Image.linear_gradient("L").resize(size),
        black="#0f172a",
        white="#0f766e",
    ).convert("RGBA")
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((48, 48, 976, 976), radius=220, fill=255)
    canvas.paste(gradient, (0, 0), mask)

    draw = ImageDraw.Draw(canvas)
    tier_color = (45, 212, 191, 105)
    for index, inset in enumerate((0, 44, 88)):
        top = 712 + index * 58
        draw.rounded_rectangle(
            (206 + inset, top, 818 - inset, top + 30),
            radius=15,
            fill=tier_color,
        )

    white = (248, 250, 252, 255)
    accent = (153, 246, 228, 255)
    line_width = 76
    draw.line((320, 252, 320, 676), fill=white, width=line_width)
    draw.line((350, 484, 686, 242), fill=white, width=line_width)
    draw.line((350, 478, 704, 682), fill=white, width=line_width)

    graph_nodes = ((704, 242), (724, 682), (320, 238), (320, 690))
    for x, y in graph_nodes:
        draw.ellipse((x - 47, y - 47, x + 47, y + 47), fill=accent)
        draw.ellipse((x - 21, y - 21, x + 21, y + 21), fill=(15, 23, 42, 255))

    draw.rounded_rectangle((48, 48, 976, 976), radius=220, outline=(255, 255, 255, 42), width=12)
    return canvas


def write_icons(output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    icon = render_icon()
    icon.save(output / "icon.png", format="PNG", optimize=True)
    icon.resize((32, 32), Image.Resampling.LANCZOS).save(
        output / "32x32.png", format="PNG", optimize=True
    )
    icon.resize((128, 128), Image.Resampling.LANCZOS).save(
        output / "128x128.png", format="PNG", optimize=True
    )
    icon.resize((256, 256), Image.Resampling.LANCZOS).save(
        output / "128x128@2x.png", format="PNG", optimize=True
    )
    icon.save(
        output / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    icon.save(output / "icon.icns", format="ICNS")


def main() -> int:
    arguments = parse_args()
    write_icons(arguments.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
