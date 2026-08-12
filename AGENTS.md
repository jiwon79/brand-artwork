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
- 문서에서 사용하는 SVG와 이미지는 사용 범위와 관계없이 모두 `docs/assets/`에 둔다. `docs/artworks/**/figures/`처럼 문서 옆에 별도 이미지 폴더를 만들지 않는다.
- 문서의 범위가 지정되면 범위 밖의 파이프라인은 설명하지 않는다. 예를 들어 “색상 제외” 요청에서는 색상 계산을 문서 본문에서 제외한다.
- 그래픽스·수학·렌더링 문서를 작성하거나 수정할 때는 `docs/explanation-guide.md`를 따른다.
- 핵심 공간 관계를 ASCII 그림에 의존하지 말고 `docs/assets/`의 검증된 SVG로 설명한다.
- 작품의 현재 구현 흐름은 `docs/artworks/<name>/`, 재사용 가능한 수학 원리는 `docs/concepts/`에 분리한다.

## Workflow

- QA 비교 이미지, 측정 JSON, 분석 스크립트와 `design-qa.md` 같은 검증 기록은 커밋하지 않는다. 필요하면 gitignore된 `qa/` 또는 `.qa/`에서 임시로 만들고 작업이 끝나면 제거한다.
- 작업을 완료하면 항상 커밋하고 푸시한다. (별도 확인 없이 바로 진행)
- 렌더링 확인은 Playwright로 새 브라우저 창을 띄우지 말고, 기존 Chrome 창을 활용한다.
