# Toss Brand Artwork — 파티클 애니메이션 스펙

## 1. 파일 구성

```
toss/
  index.html   — 캔버스, 버튼, lil-gui CDN
  style.css    — 전역 스타일, 배경색
  script.js    — 애니메이션 전체 로직
```

---

## 2. 토스 로고 구조

### 핵심 4개 점 (A, B, C, D)

```
        A (256.784, 2.236)
        │  ← 블레이드 AB (cubic bezier)
        B (248.784, 91.236)
       ╱ ╲
  왼쪽    오른쪽
  외곽    외곽
       ╲ ╱
        C (177.784, 313.236)
        │  ← 블레이드 CD (cubic bezier)
        D (169.784, 402.236)
```

| 점 | 좌표 | 설명 |
|----|------|------|
| A | `(256.784, 2.236)` | 블레이드 최상단 |
| B | `(248.784, 91.236)` | 상단 접합점 |
| C | `(177.784, 313.236)` | 하단 접합점 |
| D | `(169.784, 402.236)` | 블레이드 최하단 |

### 외곽 호

- **outerL** (왼쪽 호): C(t=0) → 왼쪽 → A(t=1) — 2개의 cubic bezier
- **outerR** (오른쪽 호): B(t=0) → 오른쪽 → D(t=1) — 2개의 cubic bezier

---

## 3. 경로 구성

### 외곽 보간 선 (각 호 40개, 총 80개)

`alpha = i/N (0→1)` 로 quadratic bezier를 생성:

```
tStart = alpha × 0.5        // 시작점이 외곽 위를 슬라이드
tEnd   = 1.0 - alpha × 0.5  // 끝점이 외곽 위를 슬라이드
CP     = midLine + alpha × (Mid - midLine)  // 외곽 극단 방향으로 휘어짐
```

- alpha=0: 외곽선에 가까운 넓은 호
- alpha=1: 중심에 가까운 좁은 호

**weight (밀도 가중치):**
```
alpha < 0.1  → alpha / 0.1          (가장자리 fade-in)
alpha >= 0.1 → 0.2 + 1.1 × alpha²  (이차함수, 중앙으로 갈수록 밀도 증가)
```

### 블레이드 선 (3개)

- A↔B: cubic bezier (상단 짧은 곡선), weight 1
- C↔D: cubic bezier (하단 짧은 곡선), weight 1
- A→D: 직선 (중심축), weight 1

### 내부 세로 선 (각 그룹 8개, 총 16개)

ABCD 내부를 채우는 두 방향의 부채꼴:

- **A → lerp(C, D, t)**: A에서 시작해 CD 구간으로 fan out
- **lerp(A, B, t) → D**: AB 구간에서 시작해 D로 fan out

weight 0.45 (외곽 선의 절반 밀도)

---

## 4. 좌표 변환

```
뷰박스: VX=-65, VY=-10, VW=570, VH=435
scl = min(W/VW, H/VH) × 0.92
OX  = (W - VW×scl) / 2 - VX×scl
OY  = (H - VH×scl) / 2 - VY×scl

sc(x, y) = [x×scl + OX, y×scl + OY]
```

DPR(devicePixelRatio) 적용: canvas 물리 해상도, 렌더링은 CSS px 기준.

---

## 5. 파티클(dot) 속성

| 속성 | 값 | 설명 |
|------|-----|------|
| `pathIdx` | 정수 | 소속 경로 인덱스 |
| `phase` | 0~1 (랜덤 초기값) | 경로 위 위치, 매 프레임 증가 후 wrap |
| `speed` | `BASE_SPEED × (0.5~1.5)` | phase 증가 속도 |
| `radius` | 0.8 ~ 2.2 CSS px | 점 반지름 (랜덤) |
| `alpha` | 0.5 ~ 1.0 | 기본 불투명도 (랜덤) |
| `jitter` | ±2 CSS px | 경로 수직 방향 오프셋 |
| `rx, ry` | CSS px | 터치 반발 rubber band 오프셋 |
| `vx, vy` | CSS px/s | rubber band 속도 |

### 밀도 계산

```
count = max(1, round(pathLength × DOTS_PER_SVG_UNIT × weight))
```

기본값 `DOTS_PER_SVG_UNIT = 0.2`, GUI로 실시간 조정 가능.

### 텍스트 경로 속도 정규화

시각적 이동 속도를 경로 길이에 관계없이 균일하게:
```
dot.speed = dot.speed × avgLogoLen / pathLen
```

### 페이드 인/아웃

경로 양 끝 10% 구간에서 alpha → 0:
```
phase < 0.1  → fade = phase / 0.1
phase > 0.9  → fade = (1 - phase) / 0.1
실제 alpha   = dot.alpha × fade
```

### 흐름 방향

모든 경로는 위→아래(y 오름차순) 방향으로 정규화 (`ensureDownward`).

---

## 6. "toss" 텍스트 경로 생성

1. 오프스크린 canvas에 bold 폰트로 "toss" 렌더링
2. 열(x축) 방향으로 `TEXT_SCAN_STEP=4` px 간격으로 스캔
3. 각 열에서 연속 픽셀 세그먼트 감지 (o, s 등 hollow 글자 처리)
4. 세그먼트 최소 높이 `TEXT_MIN_HEIGHT_PX=10` px 필터링
5. SVG 좌표로 변환 → 수직 2점 경로 생성

**잘림 방지:**
```
inkW    = actualBoundingBoxLeft + actualBoundingBoxRight
halfOff = max(inkW × 0.75, W×DPR/2)
offW    = halfOff × 2
xCSSOff = W/2 - offW/(2×DPR)   // viewport 중앙 정렬 보정
```

---

## 7. 모핑

버튼 클릭 시 로고 ↔ 텍스트 전환. `MORPH_DURATION = 700ms`.

### 동작 방식

**트리거 시점 (`triggerMorph`):**
1. 현재 `activeDots`의 화면 위치(jitter + rubber band), radius, alpha(fade 반영) → `morphFrom[]` 스냅샷
2. 목적지 형태의 새 dots 생성 (랜덤 phase/radius/alpha) → `pendingDots`
3. `pendingDots`의 초기 위치 계산 → `morphTo[]` (고정값)

**모핑 중:**
- phase 진행 없음 (모든 dots 정지)
- 매 프레임: `pos/radius/alpha = lerp(from, to, easeInOut(t/T))`

**완료 시:**
- `activeDots = pendingDots`, `activePaths = pendingPaths`
- 정상 flow 재개 (phase 진행 시작)

### easing
```
easeInOut(t) = t < 0.5 ? 2t² : 1 - 2(1-t)²
```

---

## 8. 인터랙션 — 터치/마우스 반발

드래그 시 반경 `REPULSE_RADIUS = 110px` 내의 dot을 경로 수직 방향으로 밀어냄.

```
mag = latNorm × (1 - dist/R) × MAX_DEFLECT(90px)

spring: vx += (tgtRx - rx) × SPRING_K(56) × dt
damp:   vx ×= max(0, 1 - DAMP_RATE(10) × dt)
rx     += vx × dt
```

---

## 9. 색상

| 항목 | 기본값 | Toss Blue |
|------|--------|-----------|
| 배경 | `#202632` (Toss Gray, R32 G38 B50) | 동일 |
| 파티클 | `rgb(255,255,255)` | `rgb(0,100,255)` (Toss Blue, #0064FF) |

---

## 10. Debug GUI (lil-gui)

| 항목 | 범위 | 기본값 | 설명 |
|------|------|--------|------|
| font size | 10 ~ 화면 80% | W×0.25 | 텍스트 경로 폰트 크기 (CSS px) |
| speed | 0.02 ~ 1.0 | 0.12 | 파티클 속도, activeDots 즉시 반영 |
| density | 0.05 ~ 0.6 | 0.2 | DOTS_PER_SVG_UNIT, activeDots 재생성 |
| toss blue | toggle | off | 파티클 색상 흰색 ↔ 토스 블루 |

---

## 11. 레이아웃

- 버튼: 로고 하단(`H/2 + VH×scl/2`) + 48px 아래에 fixed 배치
- 폰트: `system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`
