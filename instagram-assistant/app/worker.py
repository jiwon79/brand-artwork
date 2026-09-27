from __future__ import annotations

import json

from .db import initialize
from .instagram_client import instagram_service


def run_once() -> dict[str, object]:
    initialize()
    return {"sync": instagram_service.sync()}


def main() -> None:
    print(json.dumps(run_once(), ensure_ascii=False))


if __name__ == "__main__":
    main()
