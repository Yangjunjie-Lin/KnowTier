from __future__ import annotations

import sys

from cognigraph.cli import app


def main() -> None:
    app(args=["graph", "export", *sys.argv[1:]], prog_name="export_graph.py")


if __name__ == "__main__":
    main()
