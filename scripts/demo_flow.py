from __future__ import annotations

import sys

from cognigraph.cli import app


def main() -> None:
    app(args=["demo", *sys.argv[1:]], prog_name="demo_flow.py")


if __name__ == "__main__":
    main()
