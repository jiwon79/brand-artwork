# Documentation

문서는 목적에 따라 다음 네 영역으로 나눈다.

## Structure

```text
docs/
├── artworks/   실제 작품의 현재 구조와 구현 이력
├── concepts/   여러 작품에 재사용할 수 있는 그래픽 원리
├── research/   외부 구현과 레퍼런스 조사
└── assets/     문서에서 사용하는 이미지와 도식
```

## Artworks

### Guseul

- [`architecture.md`](./artworks/guseul/architecture.md) - 현재 코드, 입력, SDF, 렌더링 전체 구조
- [`surface-refraction.md`](./artworks/guseul/surface-refraction.md) - Guseul의 contact SDF, 유리 단면, 굴절 구현

## Concepts

- [`golden-angle-sphere-distribution.md`](./concepts/golden-angle-sphere-distribution.md) - 사진 원을 구 전체에 분산하는 Fibonacci sphere 원리
- [`sdf-glass-rendering.md`](./concepts/sdf-glass-rendering.md) - SDF에서 normal, 가상 유리 단면, 굴절 offset을 만드는 공통 원리
- [`smooth-union.md`](./concepts/smooth-union.md) - signed-distance field의 union과 부드러운 접합 원리

## Research

- [`guseul-liquid-glass.md`](./research/guseul-liquid-glass.md) - liquid glass 레퍼런스와 외부 구현 조사

## Placement Rules

- 특정 작품의 현재 코드와 직접 연결된 설명은 `artworks/<name>/`에 둔다.
- 다른 작품에도 적용할 수 있는 수학 및 렌더링 원리는 `concepts/`에 둔다.
- 외부 프로젝트, 논문, 시각 레퍼런스를 조사한 기록은 `research/`에 둔다.
- 문서에서 직접 사용하는 SVG와 이미지는 `assets/`에 둔다.
- 더 이상 현재 구조를 설명하지 않는 실험 기록과 개인 메모는 유지하지 않는다.
