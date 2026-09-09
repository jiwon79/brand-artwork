# Documentation

문서는 목적에 따라 다음 네 영역으로 나눈다.

## Structure

```text
docs/
├── artworks/   실제 작품의 현재 구조와 구현 이력
├── concepts/   여러 작품에 재사용할 수 있는 그래픽 원리
├── guides/     여러 작업에 재사용할 수 있는 절차와 판단 기준
├── research/   외부 구현과 레퍼런스 조사
├── assets/     문서에서 사용하는 이미지와 도식
└── explanation-guide.md  그래픽스 설명과 SVG 작성 기준
```

## Writing Guide

- [`explanation-guide.md`](./explanation-guide.md) - 직관, SVG, 수식, 코드가 끊기지 않도록 그래픽스 개념을 설명하는 공통 작성 기준

## Guides

- [`social-performance-tracking.md`](./guides/social-performance-tracking.md) - Instagram 성과 조회 조건과 스냅샷 보존 기준

- [`social-share-images.md`](./guides/social-share-images.md) - 실제 작품 화면을 PNG로 캡처하고 제목·회차 합성 및 소셜 공유 메타데이터 연결·검증을 수행하는 공통 절차
- [`reference-extension-workflow.md`](./guides/reference-extension-workflow.md) - 레퍼런스 복원 뒤 정체성을 유지하며 새로운 상호작용을 제안·비교·선택하는 공통 작업 방식
- [`cursor-animal-creation.md`](./guides/cursor-animal-creation.md) - AI 코딩 도구와 이미지·영상 생성 도구로 반려동물 Cursor Artwork를 만드는 전달용 가이드
- [`cursor-cat-registration.md`](./guides/cursor-cat-registration.md) - flat 120-frame pack을 R2 main 또는 10자리 랜덤 경로에 등록하는 절차

## Artworks

### Body Echo

- [`architecture.md`](./artworks/body-echo/architecture.md) - SVG rope hold, wave-gated particle dissolve, Canvas 2D 합성 구조

### Color Text

- [`architecture.md`](./artworks/color-text/architecture.md) - Color Text의 물 packet, 글자 atlas, geometry·color field, spring feedback 전체 구조
- [`interaction-ideation.md`](./artworks/color-text/interaction-ideation.md) - 터치 드립과 글자 반응을 실제로 제안·비교·수정한 Color Text 결정 기록

### Cursor Cat

- [`architecture.md`](./artworks/cursor-cat/architecture.md) - R2 manifest, 시선 기준점, 원형 frame 선택과 모바일 출력 구조
- [`generation.md`](./artworks/cursor-cat/generation.md) - Seedance 생성, 각도 샘플링, 색·배경·크기 보정과 검증 절차

### Guseul

- [`architecture.md`](./artworks/guseul/architecture.md) - 현재 코드, 입력, SDF, 렌더링 전체 구조
- [`surface-refraction.md`](./artworks/guseul/surface-refraction.md) - Guseul의 contact SDF, 유리 단면, 굴절 구현

### Line Pull

- [`architecture.md`](./artworks/line-pull/architecture.md) - 포인터 교차 선택, SVG 선 분리·중첩 클립, 문구 fitting, 프레임 루프와 질감 합성 구조
- [`social-share-image.md`](./artworks/line-pull/social-share-image.md) - 실제 캡처의 왼쪽 위에 작품명만 합성하는 PNG 제작 도구와 재생성 방법

## Concepts

Concept는 다음 중 하나를 만족할 때 독립 문서로 둔다.

- 여러 구현에서 같은 이름과 원리로 쓰이는 그래픽스·수학 기법 또는 GPU 실행 모델
- 표준 기법명은 아니지만 입력, 중간 상태, 수식, 출력과 한계가 분명하고 작품과 독립적으로 다시 적용할 수 있는 비단순 절차

반대로 단일 작품의 파라미터 선택, 좌표 변환이나 역함수 한 번으로 끝나는 계산은 다른 곳에 응용할 수 있더라도 artwork architecture에 포함한다. 여러 원리를 조합한 자체 방법을 Concept로 유지할 때는 제목이 설명용 이름임을 본문 첫머리에 밝힌다.

- [`fragment-shader-execution.md`](./concepts/fragment-shader-execution.md) - 2x2 quad, warp/wave, helper invocation과 mipmap 선택 과정
- [`golden-angle-sphere-distribution.md`](./concepts/golden-angle-sphere-distribution.md) - 점을 구 표면 전체에 분산하는 Fibonacci sphere 원리
- [`jump-flood-nearest-seed.md`](./concepts/jump-flood-nearest-seed.md) - GPU pass가 큰 jump부터 가까운 seed 좌표를 전달하는 JFA 원리와 bounded 근사
- [`mean-value-coordinates.md`](./concepts/mean-value-coordinates.md) - cage의 거리와 이웃 각도로 내부 좌표 weights를 만들고 다른 cage에 옮기는 원리
- [`pixel-metaball-field.md`](./concepts/pixel-metaball-field.md) - 활성 픽셀의 황금각 주변 표본을 누적해 threshold 실루엣을 만드는 원리
- [`sdf-glass-rendering.md`](./concepts/sdf-glass-rendering.md) - SDF에서 normal, 가상 유리 단면, 굴절 offset을 만드는 공통 원리
- [`smooth-union.md`](./concepts/smooth-union.md) - signed-distance field의 union과 부드러운 접합 원리
- [`svg-path-rope-tension.md`](./concepts/svg-path-rope-tension.md) - SVG contour를 graph로 바꾸고 거리 감쇠로 rope 장력을 전달하는 원리

## Research

- [`guseul-liquid-glass.md`](./research/guseul-liquid-glass.md) - liquid glass 레퍼런스와 외부 구현 조사

## External Records

소셜 운영 기록과 외부에 전달하는 제작 자료는 [Project → Vibe](https://app.notion.com/p/3cca89f7e31a80fda5a6c203adf4a04d)에서 관리한다. 저장소에는 찾는 경로와 직접 링크만 유지하고, 캡션·성과 스냅샷·공유 페이지 본문은 복제하지 않는다.

### 작품별 기록

Vibe의 **작품별 기록**에서 게시 상태, 캡션·초안, 크레딧과 날짜별 성과 스냅샷을 확인한다.

| 작품 | 운영 기록 |
| --- | --- |
| Guseul | [Guseul · 1일차](https://app.notion.com/p/3cda89f7e31a81abb5d4e400ee742826) |
| Color Text | [Color Text · 2일차](https://app.notion.com/p/3cda89f7e31a81d0b566fe5dd0d0b993) |
| Body Echo | [Body Echo · 3일차](https://app.notion.com/p/3cda89f7e31a8147a835fcce47562c3d) |
| Line Pull | [Line Pull · 4일차](https://app.notion.com/p/3d3a89f7e31a8105855ee61f7f14092b) |
| Cat Cursor | [Cat Cursor · 회차 미정](https://app.notion.com/p/3cda89f7e31a8110962fe86d18b400f2) |

### 외부 공유

Vibe의 **외부 공유**에는 독자가 직접 따라 만들 수 있는 제작 설명서와 프롬프트, 참고 자료가 있다. 소셜 게시물을 준비할 때 해당 작품의 운영 기록과 함께 아래 전달용 페이지를 확인한다.

| 작품 | 외부 공유 페이지 | 주요 내용 |
| --- | --- | --- |
| Cat Cursor | [반려동물 Cursor Artwork 제작 설명서](https://app.notion.com/p/3cda89f7e31a8110961ac9bf73dff3d4) | 반려동물 사진 준비, 이미지·영상 생성, 시선 프레임 정리와 웹 구현 |
| Guseul | [Guseul — 빛과 색을 품은 유리구슬 만들기](https://app.notion.com/p/3d6a89f7e31a8107a06fd47ffb45716f) | 세 단계 제작 프롬프트, 참고 사진과 내부 이미지 에셋 |
| Color Text | [Color Text — 글자에서 액체가 흐르는 포스터 만들기](https://app.notion.com/p/3d6a89f7e31a816d9fd2ca03d39bac36) | 세 단계 제작 프롬프트, 참고 사진과 포스터 문구 |
| Body Echo | [Body Echo — 몸의 선을 당기고 파동으로 흩뜨리기](https://app.notion.com/p/3d6a89f7e31a8124a56cc44c7e1e3ae4) | 세 단계 제작 프롬프트, 참고 사진과 인체 SVG 에셋 |
| Line Pull | [Line Pull — 선 사이에 숨겨진 자기소개 만들기](https://app.notion.com/p/3d6a89f7e31a81418657d9a7aeaf1b21) | 세 단계 제작 프롬프트, 참고 사진과 폰트·표면 질감 에셋 |

위 목록은 2026-09-09에 Vibe와 외부 공유 페이지에서 확인했다. 첨부 자료의 준비 상태와 최신 내용은 각 Notion 페이지에서 확인한다. 새 작품은 Vibe 아래 기존 페이지를 먼저 찾고, 확인한 주소만 이 목록에 추가한다.

## Placement Rules

- 아키텍처 및 구현 원리 정리의 기본 형식은 Markdown이다. DOCX, PDF, HTML, Figma/FigJam은 사용자가 해당 형식을 명시했을 때만 만든다.
- 사용자가 `docs/...` 경로를 명시하면 그 경로를 우선한다.
- 특정 작품의 현재 코드와 직접 연결된 설명은 `artworks/<name>/`에 둔다.
- 특정 작품에서 실제로 시도한 후보, 실패 장면, 선택 이유와 구현 이력은 `artworks/<name>/`에 큐레이션된 결정 기록으로 둔다.
- 여러 작품에서 반복 사용할 작업 절차, 질문 템플릿과 선택 기준은 `guides/`에 두고 특정 작품의 함수명·기본값·커밋 이력을 넣지 않는다.
- 다른 작품에도 적용할 수 있는 수학 및 렌더링 원리는 `concepts/`에 둔다.
- `concepts/` 본문에는 작품명, 작품 전용 함수명, 현재 기본값, pass 구성, 튜닝 기록을 넣지 않는다. 실제 적용은 문서 끝의 `구현 참고`에서 `artworks/<name>/` 문서 링크로만 연결한다.
- 외부 프로젝트, 논문, 시각 레퍼런스를 조사한 기록은 `research/`에 둔다.
- 작품별 소셜 게시 이력, 캡션·초안·번역·문체 분석과 성과 스냅샷은 Notion의 `Project > Vibe > 작품별 기록`에, 전달용 제작 자료는 `외부 공유`에 둔다. 찾는 경로와 직접 링크는 이 문서의 External Records에 유지한다.
- 공통 소셜 조회 조건과 지표 정의는 `guides/social-performance-tracking.md`에 둔다.
- 문서에서 사용하는 SVG와 이미지는 모두 `assets/`에 둔다. 문서 옆 `figures/`나 `images/` 폴더는 만들지 않는다.
- QA 비교 이미지, 측정값, 분석 스크립트와 `design-qa.md` 같은 검증 기록은 문서로 보관하지 않는다. 필요하면 gitignore된 `qa/` 또는 `.qa/`에서 임시로 생성한다.
- 선택 근거가 없는 원본 실험 로그와 개인 메모는 유지하지 않는다. 이후 판단에 필요한 문제 → 원인 → 결정의 변화만 작품별 결정 기록으로 정리한다.
- 새 artwork 및 concept 설명은 [`explanation-guide.md`](./explanation-guide.md)의 순서와 검증 기준을 따른다.
