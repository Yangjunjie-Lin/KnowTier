"""Generate deterministic raster and scanned-PDF fixtures for live OCR CI."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def _first_existing(paths: tuple[Path, ...]) -> Path:
    for path in paths:
        if path.is_file():
            return path
    raise FileNotFoundError("no suitable test font is installed")


def _text_image(
    text: str,
    font: ImageFont.FreeTypeFont,
    *,
    foreground: tuple[int, int, int] = (0, 0, 0),
    background: tuple[int, int, int] = (255, 255, 255),
    size: tuple[int, int] = (1_400, 260),
) -> Image.Image:
    image = Image.new("RGB", size, background)
    ImageDraw.Draw(image).text((50, 80), text, fill=foreground, font=font)
    return image


def generate(output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    latin_path = _first_existing(
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("C:/Windows/Fonts/arial.ttf"),
        )
    )
    chinese_path = _first_existing(
        (
            Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
            Path("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf"),
            Path("C:/Windows/Fonts/msyh.ttc"),
            Path("C:/Windows/Fonts/simhei.ttf"),
            Path("C:/Windows/Fonts/simsun.ttc"),
        )
    )
    latin = ImageFont.truetype(str(latin_path), 64)
    chinese = ImageFont.truetype(str(chinese_path), 64)

    _text_image("Knowledge graphs preserve evidence.", latin).save(output / "english.png")
    _text_image("\u77e5\u8bc6\u56fe\u8c31\u4fdd\u7559\u8bc1\u636e\u6765\u6e90", chinese).save(
        output / "chinese.png"
    )
    _text_image("Rotated evidence remains readable.", latin, size=(1_500, 260)).rotate(
        8,
        expand=True,
        fillcolor="white",
    ).save(output / "rotated.png")
    _text_image(
        "Low contrast source text.",
        latin,
        foreground=(155, 155, 155),
        background=(235, 235, 235),
    ).save(output / "low-contrast.png")

    multicolumn = Image.new("RGB", (1_600, 700), "white")
    draw = ImageDraw.Draw(multicolumn)
    draw.text((50, 60), "First column", fill="black", font=latin)
    draw.text((50, 180), "Evidence source", fill="black", font=latin)
    draw.text((850, 60), "Second column", fill="black", font=latin)
    draw.text((850, 180), "Graph revision", fill="black", font=latin)
    multicolumn.save(output / "multicolumn.png")

    _text_image("Scanned PDF evidence page.", latin, size=(1_400, 900)).save(
        output / "scanned.pdf",
        "PDF",
        resolution=150.0,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    generate(arguments.output.resolve())


if __name__ == "__main__":
    main()
