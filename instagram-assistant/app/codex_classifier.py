from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .config import ROOT, paths


STYLE = """응대 문체:
- 짧고 친근한 한국어 존댓말
- 필요한 경우 ㅎㅎ, ㅠㅠ, !!를 가볍게 사용
- 먼저 요청한 정보를 주고 구매 안내는 부가적으로 한다
- 이모지, 감사 인사, 단순 칭찬은 답하지 않는다
- 협업, 환불, 오류, 맞춤 제작, 불명확한 요청은 manual_review로 보낸다
- 공개 댓글에서는 링크를 직접 공개하지 않고 DM으로 유도한다
"""


def classify_with_codex(event: dict[str, Any], artworks: list[dict[str, Any]]) -> dict[str, Any]:
    prompt = f"""Instagram 응대 분류기다. 아래 이벤트의 다음 행동을 JSON으로 결정하라.

{STYLE}

가능한 작품:
{json.dumps(artworks, ensure_ascii=False, indent=2)}

이벤트:
{json.dumps(event, ensure_ascii=False, indent=2)}

사용 가능한 action은 ignore, reply_comment, reply_dm, manual_review뿐이다.
작품과 링크가 확실하지 않으면 추측하지 말고 manual_review를 선택하라.
"""
    with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as output:
        output_path = Path(output.name)
    try:
        result = subprocess.run(
            [
                "codex", "exec", "--ephemeral", "--skip-git-repo-check",
                "--sandbox", "read-only", "--output-schema", str(paths.codex_schema),
                "--output-last-message", str(output_path), "-C", str(ROOT), "-",
            ],
            input=prompt,
            text=True,
            capture_output=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Codex 분류에 실패했습니다.")
        return json.loads(output_path.read_text())
    finally:
        output_path.unlink(missing_ok=True)
