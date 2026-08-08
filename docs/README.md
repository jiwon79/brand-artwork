# Documentation

문서는 목적에 따라 다음 네 영역으로 나눈다.

## Structure

```text
docs/
├── artowkr/    Color Changes 프로젝트의 아키텍처 문서와 전용 도식
├── artworks/   실제 작품의 현재 구조와 구현 이력
├── concepts/   여러 작품에 재사용할 수 있는 그래픽 원리
├── research/   외부 구현과 레퍼런스 조사
└── assets/     문서에서 사용하는 이미지와 도식
```

## Artowkr

- [`architecture.md`](./artowkr/architecture.md) - Color Changes의 Falloff, 시간 기억, Metaball field, 실루엣 추출 구조

## Artworks

### Guseul

- [`architecture.md`](./artworks/guseul/architecture.md) - 현재 코드, 입력, SDF, 렌더링 전체 구조
- [`surface-refraction.md`](./artworks/guseul/surface-refraction.md) - Guseul의 contact SDF, 유리 단면, 굴절 구현

## Concepts

- [`fragment-shader-execution.md`](./concepts/fragment-shader-execution.md) - 2x2 quad, warp/wave, helper invocation과 mipmap 선택 과정
- [`golden-angle-sphere-distribution.md`](./concepts/golden-angle-sphere-distribution.md) - 사진 원을 구 전체에 분산하는 Fibonacci sphere 원리
- [`mean-value-coordinates.md`](./concepts/mean-value-coordinates.md) - cage의 거리와 이웃 각도로 내부 좌표 weights를 만들고 다른 cage에 옮기는 원리
- [`sdf-glass-rendering.md`](./concepts/sdf-glass-rendering.md) - SDF에서 normal, 가상 유리 단면, 굴절 offset을 만드는 공통 원리
- [`smooth-union.md`](./concepts/smooth-union.md) - signed-distance field의 union과 부드러운 접합 원리

## Research

- [`guseul-liquid-glass.md`](./research/guseul-liquid-glass.md) - liquid glass 레퍼런스와 외부 구현 조사

## Placement Rules

- 아키텍처 및 구현 원리 정리의 기본 형식은 Markdown이다. DOCX, PDF, HTML, Figma/FigJam은 사용자가 해당 형식을 명시했을 때만 만든다.
- 사용자가 `docs/...` 경로를 명시하면 그 경로를 우선한다.
- 특정 작품의 현재 코드와 직접 연결된 설명은 `artworks/<name>/`에 둔다.
- 다른 작품에도 적용할 수 있는 수학 및 렌더링 원리는 `concepts/`에 둔다.
- 외부 프로젝트, 논문, 시각 레퍼런스를 조사한 기록은 `research/`에 둔다.
- 한 문서에만 쓰이는 SVG와 이미지는 문서 옆 `figures/`에 둘 수 있다. 여러 문서에서 재사용하는 도식은 `assets/`에 둔다.
- 더 이상 현재 구조를 설명하지 않는 실험 기록과 개인 메모는 유지하지 않는다.
