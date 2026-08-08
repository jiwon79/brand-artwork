# Brand Artwork

Interactive web implementations of brand artworks.

## Tech Stack

- TypeScript + Vite
- lil-gui (debug/parameter tuning UI)
- pnpm (package manager)

## Project Structure

- `common/` — shared modules (touch cursor, etc.)
- `pages/<brand>/` — per-brand artwork (`index.html`, `script.ts(js)`, `style.css`, etc.)
- `docs/` — architecture, concepts, research, and supporting diagrams

## Documentation

- 아키텍처나 구현 원리 정리 요청의 기본 산출물은 Markdown이다. 사용자가 별도 형식을 명시하지 않으면 DOCX, PDF, HTML, Figma/FigJam 문서를 만들지 않는다.
- 사용자가 문서 경로를 지정하면 그 경로를 그대로 따른다. 경로가 없으면 기존 `docs/README.md`의 배치 규칙을 따른다.
- 액체 타이포그래피 프로젝트의 공식 이름은 `color-text`이다. 코드 경로는 `pages/color-text/`, 문서 경로는 `docs/artworks/color-text/`로 고정한다. 첨부 파일명이나 작가 이름을 프로젝트 폴더명으로 사용하지 않는다.
- 작품 아키텍처 문서는 `architecture.md`로 만들고, 현재 코드의 입력 → 중간 상태 → 렌더 패스 → 출력 → 검증 순서를 설명한다.
- 해당 문서에서만 사용하는 SVG는 문서 옆 `figures/`에 둘 수 있다. 여러 문서에서 재사용하는 도식은 `docs/assets/`에 둔다.
- 문서의 범위가 지정되면 범위 밖의 파이프라인은 설명하지 않는다. 예를 들어 “색상 제외” 요청에서는 색상 계산을 문서 본문에서 제외한다.

## Workflow

- 작업을 완료하면 항상 커밋하고 푸시한다. (별도 확인 없이 바로 진행)
- 렌더링 확인은 Playwright로 새 브라우저 창을 띄우지 말고, 기존 Chrome 창을 활용한다.
