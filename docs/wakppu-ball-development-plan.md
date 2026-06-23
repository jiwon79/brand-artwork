---
title: 왁뿌볼 개발 계획
tags: [wakppu, canvas, fracture, interaction, asmr]
updated: 2026-06-23
---

# 왁뿌볼 개발 계획

릴스 제목: **"왁뿌볼 비싸서 직접 만들었습니다"**

목표는 실제 왁뿌볼을 그대로 3D로 재현하는 것이 아니라, 터치 화면에서 **단일 왁스판이 오래 누를수록 큰 조각에서 작은 조각으로 깨지는 감각**을 만드는 것이다.

## 결정된 방향

- 손가락은 화면에 보이지 않는다.
- `PointerEvent.pressure`는 사용하지 않는다.
- 입력은 `pointerdown` 이후의 **hold time**과 위치만 사용한다.
- 젤/슬라임/내부 색 리빌은 없다.
- 단일 파스텔 왁스 또는 초콜릿 같은 재질만 사용한다.
- 사실적인 파괴보다 **clean polygonal 2.5D**가 목표다.
- 소리는 합성하지 않고 실제 녹음 오디오 샘플을 이벤트에 맞춰 재생한다.

## 사용자 경험

첫 화면은 화면을 크게 채우는 매끈한 원형 왁스판이다. 사용자가 화면을 길게 누르면 보이지 않는 압점 주변에서 균열이 생긴다.

시간이 지날수록:

```txt
매끈한 표면
→ 큰 polygon crack
→ 조각 사이 gap 오픈
→ 중심부 조각 재분할
→ 작은 shard 증가
→ 일부 작은 파편 분리
```

릴스 첫 1초 안에 큰 조각과 작은 조각의 차이가 보여야 한다.

## 시간 기반 fracture 설계

전체 진행은 continuous value와 discrete event를 섞는다.

```txt
0.00s  intact
0.12s  hairline crack
0.28s  큰 polygon crack 3~5개
0.50s  큰 조각 사이 gap 열림
0.75s  중심 주변 큰 조각 일부 split
1.05s  중심부 작은 shard 밀도 증가
1.40s  작은 shard 일부 detached
1.80s+ 주변부로 천천히 확장
```

각 shard는 자기 threshold를 가진다. threshold에 작은 랜덤을 넣어 모든 조각이 동시에 깨지는 문제를 피한다.

```ts
crackAt    = 0.12 + jitter;
separateAt = 0.32 + jitter;
splitAt    = 0.58 + jitter;
detachAt   = 0.95 + jitter;
```

매 프레임에는 polygon을 새로 만들지 않는다. 매 프레임 업데이트하는 값은 `energy`, `gap`, `lift`, `angle`뿐이다. polygon 재생성은 `splitShard()` 이벤트에서만 한다.

## Hold Energy 모델

`pressure` API 없이 hold time으로 energy를 누적한다.

```ts
const dt = (now - prevNow) / 1000;
const dist = distance(pointer, shard.center);
const falloff = smoothstep(1 - dist / pressRadius);

if (isHolding && falloff > 0) {
  shard.energy += dt * falloff;
}
```

권장 값:

```txt
pressRadius: 140~190px
crackAt:     0.12~0.20
separateAt:  0.30~0.45
splitAt:     0.55~0.80
detachAt:    0.95~1.40
```

`falloff`는 중심이 빠르게 깨지고 외곽은 천천히 반응하도록 smoothstep을 사용한다.

```ts
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}
```

## Polygon 생성

라이브러리 후보는 `d3-delaunay`다. 이 라이브러리는 점(seed)을 넣으면 Voronoi cell을 만들고, `cellPolygon(i)`로 각 cell의 좌표를 꺼낼 수 있다.

```ts
import { Delaunay } from 'd3-delaunay';

const delaunay = Delaunay.from(points);
const voronoi = delaunay.voronoi([0, 0, width, height]);
const cell = voronoi.cellPolygon(i);
```

필요 의존성:

```txt
d3-delaunay
@types/d3-delaunay
```

초기 왁스판:

- 원형 디스크를 96~128각형으로 근사한다.
- 큰 seed 12~18개를 디스크 안에 배치한다.
- Voronoi cell을 원형 디스크 polygon으로 clip한다.
- 너무 작은 조각은 버리거나 이웃과 병합한다.

재분할:

- `splitAt`을 넘은 shard만 다시 나눈다.
- 부모 polygon 내부에 seed 3~7개를 생성한다.
- 자식 Voronoi cell을 부모 polygon으로 clip한다.
- 부모 shard는 렌더에서 숨기고 children만 그린다.
- 한 프레임에 `splitShard()`는 1~3개만 처리한다.

MVP에서는 부모와 cell을 convex에 가깝게 유지하고 Sutherland-Hodgman clipping을 직접 구현한다. 복잡한 concave 문제가 생기면 `polygon-clipping` 추가를 검토한다.

## Shard 데이터 모델

```ts
type Point = { x: number; y: number };

type Shard = {
  id: number;
  parentId: number | null;
  polygon: Point[];
  children: number[];
  center: Point;
  area: number;
  state: 'solid' | 'cracked' | 'separated' | 'split' | 'detached';
  energy: number;
  crackAt: number;
  separateAt: number;
  splitAt: number;
  detachAt: number;
  gap: number;
  lift: number;
  thickness: number;
  angle: number;
  targetGap: number;
  targetLift: number;
  targetAngle: number;
  path?: Path2D;
};
```

## 2.5D 렌더링

실제 z축 물리는 계산하지 않는다. 각 shard가 가진 `gap`, `lift`, `thickness`, `angle`만으로 깊이감을 만든다.

렌더 순서:

```txt
1. base shadow      전체 왁스판 밑 그림자
2. ambient gap      조각 사이 어두운 틈
3. contact shadow   들뜬 조각 밑 그림자
4. underside        조각 단면
5. top face         왁스 표면
6. bevel highlight  밝은 edge
7. bevel shade      어두운 edge
```

권장 값:

```txt
gap:        0 → 7px
lift:       0 → 5px
thickness:  1.5 → 4px
angle:     -0.06 → 0.06rad
shadowBlur: 0 → 8px
```

위-left에서 빛이 오는 것으로 고정한다.

```ts
const LIGHT = normalize({ x: -0.45, y: -0.75 });
```

edge별 bevel은 edge normal과 빛 방향의 dot product로 결정한다.

```ts
const brightness = dot(edgeNormal, LIGHT);

if (brightness > 0.25) {
  strokeEdge(edge, 'rgba(255,255,255,0.38)');
} else if (brightness < -0.25) {
  strokeEdge(edge, 'rgba(45,105,95,0.30)');
}
```

조각 위치:

```ts
const dir = normalize(sub(shard.center, holdCenter));
const offset = mul(dir, shard.gap);
const liftY = -shard.lift;
```

단면은 같은 polygon을 아래/오른쪽으로 한 번 더 그린다.

```ts
drawPolygon(shard.polygon, {
  translate: {
    x: offset.x + shard.thickness * 0.45,
    y: offset.y + shard.thickness * 0.75,
  },
  fill: edgeColor,
});
```

top face는 위에 그린다.

```ts
drawPolygon(shard.polygon, {
  translate: { x: offset.x, y: offset.y + liftY },
  rotate: shard.angle,
  fill: waxColor,
});
```

2.5D 느낌은 큰 shadow보다 **단면 offset + edge highlight**에서 나온다. 조각이 과하게 떠 보이면 `lift`를 줄이고 `gap`과 bevel만 유지한다.

## 애니메이션

target 값은 state와 energy에 따라 계산하고, 실제 값은 easing으로 따라간다.

```ts
shard.gap += (shard.targetGap - shard.gap) * 0.18;
shard.lift += (shard.targetLift - shard.lift) * 0.16;
shard.angle += (shard.targetAngle - shard.angle) * 0.12;
```

state별 target:

```txt
solid:     gap 0, lift 0
cracked:   gap 0.5~1.5, lift 0
separated: gap 2~5, lift 1~2
split:     gap 3~7, lift 1~4
detached:  독립 particle로 전환
```

## 실제 오디오 재생

소리는 합성하지 않는다. 실제 녹음 sample을 이벤트에 맞춰 재생한다.

샘플 카테고리:

```txt
crack-small/*.mp3   hairline crack
snap-clean/*.mp3    큰 조각 분리
crackle/*.mp3       작은 shard split
flake/*.mp3         작은 파편 detach
```

이벤트 매핑:

```txt
cracked   → small tick
separated → clean snap
split     → brittle crackle
detached  → tiny chip
```

반복 티가 나지 않도록 같은 카테고리 안에서 랜덤 파일을 고른다. pitch 변조는 선택사항이다. 실제 샘플 질감이 좋으면 pitch 변조 없이 랜덤 선택만으로 충분하다.

## 구현 순서

1. `pages/wakppu-ball/` 생성
2. Canvas 2D full-screen 9:16 대응
3. 원형 왁스판 렌더링
4. `d3-delaunay`로 초기 큰 shard 생성
5. hold center와 hold energy update
6. `cracked` / `separated` state 구현
7. `splitShard()`로 recursive split 구현
8. 2.5D 렌더 레이어 추가
9. 실제 오디오 샘플 연결
10. `lil-gui`로 threshold, radius, gap, lift, shard density 튜닝
11. 모바일 Chrome에서 터치 hold 검증
12. 릴스 녹화용 파라미터 고정

## 검증 체크리스트

- 첫 0.3초 안에 큰 crack이 보이는가?
- 1초 안에 중심부 작은 shard가 보이는가?
- 조각이 너무 진흙/세라믹처럼 보이지 않는가?
- 단일 왁스/초콜릿 재질로 보이는가?
- 손가락 없이도 hold 중심이 읽히는가?
- 오래 누를수록 분리가 진행되는가?
- 오디오 이벤트가 fracture 타이밍과 맞는가?
- 모바일에서 shard 수 250개 이하로 60fps에 근접하는가?

## 관련 문서

- Vault notes: `sources/2026-06-17-wakppu-ball/notes.md`
- Technique: `wiki/techniques/progressive-polygon-fracture.md`
- d3-delaunay docs: https://d3js.org/d3-delaunay/voronoi
- Canvas 2D docs: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D
- Web Audio docs: https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode

