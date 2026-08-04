from __future__ import annotations

import sys

from cognigraph.cli import app


def main() -> None:
    app(args=["seed-demo", *sys.argv[1:]], prog_name="seed_demo.py")


if __name__ == "__main__":
    main()
