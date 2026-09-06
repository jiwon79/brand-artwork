# Brand Artwork

Interactive web implementations of brand artworks.

## Tech Stack

- TypeScript + Vite
- lil-gui (debug/parameter tuning UI)
- pnpm (package manager)
- Vitest (unit tests)

## Project Structure

- `common/` — shared modules (touch cursor, etc.)
- `pages/<brand>/` — per-brand artwork (`index.html`, `script.ts(js)`, `style.css`, etc.)
- `docs/` — architecture, concepts, reusable guides, research, and supporting diagrams

## Documentation

- 캡션 원문·초안·번역·문체 분석은 로컬에 보관하지 않는다. Notion의 [Project → Vibe](https://app.notion.com/p/3cca89f7e31a80fda5a6c203adf4a04d) → 작품별 기록에서 확인·관리하고, 작품별 직접 링크와 찾는 방법은 `docs/social/README.md`에 기록한다.
- 아키텍처나 구현 원리 정리 요청의 기본 산출물은 Markdown이다. 사용자가 별도 형식을 명시하지 않으면 DOCX, PDF, HTML, Figma/FigJam 문서를 만들지 않는다.
- 사용자가 문서 경로를 지정하면 그 경로를 그대로 따른다. 경로가 없으면 기존 `docs/README.md`의 배치 규칙을 따른다.
- 액체 타이포그래피 프로젝트의 공식 이름은 `color-text`이다. 코드 경로는 `pages/color-text/`, 문서 경로는 `docs/artworks/color-text/`로 고정한다. 첨부 파일명이나 작가 이름을 프로젝트 폴더명으로 사용하지 않는다.
- 작품 아키텍처 문서는 `architecture.md`로 만들고, 현재 코드의 입력 → 중간 상태 → 렌더 패스 → 출력 → 검증 순서를 설명한다.
- 문서에서 사용하는 SVG와 이미지는 사용 범위와 관계없이 모두 `docs/assets/`에 둔다. `docs/artworks/**/figures/`처럼 문서 옆에 별도 이미지 폴더를 만들지 않는다.
- 문서의 범위가 지정되면 범위 밖의 파이프라인은 설명하지 않는다. 예를 들어 “색상 제외” 요청에서는 색상 계산을 문서 본문에서 제외한다.
- 그래픽스·수학·렌더링 문서를 작성하거나 수정할 때는 `docs/explanation-guide.md`를 따른다.
- 핵심 공간 관계를 ASCII 그림에 의존하지 말고 `docs/assets/`의 검증된 SVG로 설명한다.
- 곡선, blur, gradient와 정밀 외곽선은 투명 배경 SVG로 만들고, 텍스트·화살표·패널 배치는 draw.io에서 조립한 뒤 최종 SVG 한 장으로 export한다. 정밀 SVG 원본, `.drawio` 편집 원본과 최종 SVG를 모두 `docs/assets/`에 보관한다.
- 작품의 현재 구현 흐름은 `docs/artworks/<name>/`, 재사용 가능한 수학 원리는 `docs/concepts/`에 분리한다.
- 특정 작품의 후보·실패·선택 이력은 `docs/artworks/<name>/`에 두고, 여러 작업에 재사용할 절차·질문·판단 기준은 `docs/guides/`에 둔다. 공통 guide에는 작품 전용 함수명·기본값·커밋 이력을 넣지 않는다.

## Workflow

- 소셜 공유 이미지는 GPT Image 등 생성형 이미지 도구를 쓰지 않고 실제 작품 렌더링을 1200×630 PNG로 직접 캡처한다. 제작·연결·검증은 `docs/guides/social-share-images.md`를 따른다.
- 테스트는 Vitest의 `test`·`expect`로 작성한다. 전체 실행은 `pnpm test`, 변경 감시는 `pnpm test:watch`, 작품별 실행은 `pnpm test pages/<brand>`를 사용한다.
- QA 비교 이미지, 측정 JSON, 분석 스크립트와 `design-qa.md` 같은 검증 기록은 커밋하지 않는다. 필요하면 gitignore된 `qa/` 또는 `.qa/`에서 임시로 만들고 작업이 끝나면 제거한다.
- 하나의 의미 있는 작업 단위가 끝날 때마다 별도 확인 없이 커밋하고 즉시 푸시한다. 서로 독립적인 변경을 하나의 큰 커밋으로 묶지 않는다.
- 작업을 완료하면 항상 Draft PR을 생성하거나, 현재 브랜치의 기존 PR을 최신 상태로 유지한다.
- 사용자가 명시적으로 머지를 요청하기 전에는 PR을 절대 머지하지 않는다. PR 생성이나 리뷰 완료를 머지 승인으로 해석하지 않는다.
- 사용자가 머지를 명시적으로 요청하면 squash merge를 사용한다.
- 렌더링 확인은 Playwright로 새 브라우저 창을 띄우지 말고, 기존 Chrome 창을 활용한다.
