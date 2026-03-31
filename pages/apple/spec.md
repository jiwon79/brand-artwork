# Apple Brand Artwork — 슈퍼앨립스 그리드 스펙

## 1. 파일 구성

```
apple/
  index.html   — 캔버스, UI 레이어, touch-cursor 로드
  style.css    — 전역 스타일 (cursor: none, UI 텍스트)
  script.ts    — 전체 로직 (TypeScript)
```

---

## 2. 컨셉

화면을 35×35px 셀 그리드로 채운다. 마우스/터치 드래그 시 브러시 범위 내의 격자 교차점(corner vertex)에 n값이 주입된다. 각 셀은 주변 4개 교차점의 n값을 읽어 코너를 슈퍼앨립스 곡선으로 둥글게 그린다. 브러시를 떼면 2초 유지 후 지수 감쇠로 원래 사각형으로 돌아온다.

애플이 40년간 유지해온 아이콘 형태인 **슈퍼앨립스(squircle)**를 탐구한다.

---

## 3. 그리드 구조

```
corner(c,r) ── corner(c+1,r)
    │                │
    │   cell(c,r)    │
    │                │
corner(c,r+1) ─ corner(c+1,r+1)
```

- **corner vertex**: 격자 교차점. 인접한 최대 4개 셀이 공유한다.
- `cornerN: Float32Array` — 각 교차점의 현재 n값 (0 ~ MAX_N=4)
- `cornerTime: Float64Array` — 마지막으로 브러시가 닿은 시각 (ms)
- 그리드 크기: `cW × cH = (⌈W/STEP⌉+3) × (⌈H/STEP⌉+3)`

### 상수

| 이름 | 값 | 설명 |
|------|----|------|
| `CELL` | 35px | 셀 한 변 길이 |
| `GAP` | 0.5px | 셀 간격 |
| `STEP` | 35.5px | 격자 간격 (CELL + GAP) |
| `MAX_N` | 4 | n값 최대치 |
| `MAX_R` | 17.5px | 코너 반지름 최대치 (CELL/2) |
| `HOLD_MS` | 2000ms | 감쇠 전 유지 시간 |
| `DECAY` | 0.9601 | 프레임당 감쇠 계수 |

---

## 4. 브러시

드래그 중 매 프레임 `applyBrush(bx, by)` 호출.

```
각 교차점 (px, py) = (cx × STEP, cy × STEP)
dist = √((px-bx)² + (py-by)²)
t    = 1 - dist / brushR
target = falloffFn(t, dist, brushR)
```

`target > cornerN[idx]` 이면 n값 갱신, 아니면 hold 타이머만 리셋.

### Falloff 함수 (GUI 선택)

| 이름 | 식 | 특징 |
|------|----|------|
| `linear` | `MAX_N × t` | 균등 감소 |
| `quadratic` | `MAX_N × t²` | 중심 강조 (기본값) |
| `cubic` | `MAX_N × t³` | 날카로운 중심 집중 |
| `sqrt` | `MAX_N × √t` | 넓고 평탄 |
| `gaussian` | `MAX_N × exp(-dist²/(2σ²))`, σ=brushR×0.4 | 자연스러운 종 모양 |
| `cosine` | `MAX_N × (cos((1-t)π)+1)/2` | S커브 |
| `smoothstep` | `MAX_N × t²(3-2t)` | 양끝 완만 |

---

## 5. 감쇠 (Decay)

매 프레임 `decayCells(now)` 호출.

```
elapsed = now - cornerTime[i]
elapsed > HOLD_MS → cornerN[i] *= DECAY
cornerN[i] < 0.005 → 0 으로 클램프
```

---

## 6. 코너 렌더링

### n값 → 반지름 변환

```ts
nToRadius(n) = pow(n / MAX_N, radiusCurve) * MAX_R
```

- `radiusCurve < 1`: 낮은 n값도 반지름이 크게 나옴 → 대비 강조 (기본값 0.4)
- `radiusCurve = 1`: 선형
- `radiusCurve > 1`: 높은 n값에서만 코너가 생김

### 슈퍼앨립스 코너 (`squircleCorner`)

`arcTo` 대신 파라메트릭 초타원으로 코너를 그린다.

**수식**: `|x|^superN + |y|^superN = r^superN`

**호의 중심**: `arcCenter = corner + (d1 + d2) × r` (셀 내부)

```
t ∈ [0, π/2]
u = cos(t)^(2/superN),  v = sin(t)^(2/superN)
point = arcCenter - r × (u×d2 + v×d1)
```

- `t=0`: 시작점 (corner + d1×r) ✓
- `t=π/2`: 끝점 (corner + d2×r) ✓
- `superN=2`: 원 (arcTo와 동일)
- `superN=5`: Apple squircle (기본값) — 코너가 원보다 더 날카롭게 꺾임
- `superN→∞`: 직각에 수렴

10스텝으로 샘플링 → `lineTo`로 연결.

### drawCell

각 셀을 4개 교차점의 n값으로 독립적으로 그린다.

```
top edge    → squircleCorner(top-right,  d1=(-1,0), d2=(0,1))
right edge  → squircleCorner(bot-right,  d1=(0,-1), d2=(-1,0))
bottom edge → squircleCorner(bot-left,   d1=(1,0),  d2=(0,-1))
left edge   → squircleCorner(top-left,   d1=(0,1),  d2=(1,0))
```

r=0이면 `lineTo(corner)`로 직각.

---

## 7. 렌더 루프

```
requestAnimationFrame(render)
  → decayCells(now)
  → fillRect(bgColor)          // 배경
  → for each cell:
       drawCell(...4 corner n values...)
       ctx.fill()
```

---

## 8. GUI (lil-gui)

| 파라미터 | 범위 | 기본값 | 설명 |
|----------|------|--------|------|
| `falloff` | 7가지 선택 | `quadratic` | 브러시 falloff 함수 |
| `brushSize` | 20 ~ 200px | 80 | 브러시 반지름 |
| `superN` | 2 ~ 12 | 5 | 초타원 지수 (2=원, 5=squircle) |
| `radiusCurve` | 0.1 ~ 2.0 | 0.4 | n→반지름 파워 커브 |
| `bgColor` | color | `#ffffff` | 배경색 |
| `cellColor` | color | `#1c1c1e` | 셀 색상 |

---

## 9. 인터랙션

- **마우스 드래그** / **터치 드래그**: 브러시 적용
- **clear 버튼**: `cornerN.fill(0)`, `cornerTime.fill(-Infinity)`
- **리사이즈**: `setupCanvas()` + `initGrid()` 재실행
- **touch-cursor.ts**: 터치 기기에서 손가락 위치에 dot + ring 표시 (터치 기기 전용)

---

## 10. DPR 처리

```
canvas.width  = innerWidth  × dpr
canvas.height = innerHeight × dpr
ctx.scale(dpr, dpr)
// 이후 모든 좌표는 CSS px 기준
```
