# Google Brand Artwork — Logo Network 스펙

## 1. 파일 구성

```
google-logo-network/
  index.html   — 캔버스, Boom 버튼
  style.css    — 전역 스타일
  script.js    — 전체 로직
```

`/common/touch-cursor.ts`를 추가로 로드한다.

---

## 2. 컨셉

Google / YouTube / Gmail / Gemini 로고의 각 글자 형태 안에서 파티클이 자유롭게 움직이며, 가까운 이웃 파티클들과 선으로 연결되어 동적인 "상수도(constellation)" 효과를 만든다. 글자 경계를 벗어나지 않도록 마스크 기반 충돌을 사용하며, 각 글자는 고유 브랜드 색상을 유지한다.

- **드래그/터치**: 커서 근처 글자들이 커서 쪽으로 끌려오며 자기 모양은 유지.
- **Boom 버튼**: 모든 파티클이 글자 중심에서 밖으로 폭발한 뒤 재배치.

---

## 3. 브랜드 설정

```js
BRANDS = {
  Google:  'Google'  × [G푸랑, o빨강, o노랑, g파랑, l초록, e빨강],
  YouTube: 'YouTube' × 7색 (빨강 계열),
  Gmail:   'Gmail'   × [빨강, 파랑, 초록, 노랑, 빨강],
  Gemini:  'Gemini'  × [파랑, 인디고, 보라, 인디고, 파랑, 보라],
}
```

브랜드 전환 시: `applyBrand()` → `buildMask()` → `initGrid()` → `initParticles()`.

---

## 4. 상수

| 이름 | 값 | 설명 |
|------|----|------|
| `PER_LETTER` | 40 | 글자당 파티클 수 |
| `COLOR_STEP` | 30 | 마스크 인코딩 R 채널 간격 (최대 8글자) |
| `NEAREST_K` | 3 | 파티클당 그려지는 최근접 이웃 수 |
| `BASE_SPEED` | 0.6 | 기본 파티클 속도 |
| `SPEED_LERP` | 0.018 | 속도 복원 보간 계수 |
| `MAX_SPD` | 2.5 | 최대 속도 클램프 |
| `SEARCH_R` | 90 px | 이웃 탐색 반경 |
| `CELL` | = `SEARCH_R` | 공간 해시 셀 크기 |
| `REPEL_R / REPEL_F` | 100 / 1.8 | (예약) |
| `MAX_OFFSET_X/Y` | 60 / 60 | 글자 오프셋 최대치 |
| `EASE` | 0.1 | 오프셋 보간 계수 |
| `SNAP_R` | 150 | 마우스 영향 반경 |
| `BTN_H` | 80 | 상단 버튼 공간 |

---

## 5. 캔버스 크기

4:5 세로 비율 유지:

```
vh = innerHeight - BTN_H
W  = min(vw, vh × 4/5)
H  = round(W × 5/4)
if H > vh: H = vh, W = round(H × 4/5)
```

`canvas.width = W × DPR` / `ctx.scale(DPR, DPR)`.

---

## 6. 글자 마스크

오프스크린 캔버스에 텍스트를 렌더하여 픽셀 단위 마스크를 만든다.

### 폰트 크기 자동 피팅

```
targetW = min(W, H) - 40
fontSize = W × 0.2
반복 14회: fontSize *= targetW / measureText(word).width
```

### 글자별 색상 인코딩

```
i 번째 글자 fillStyle = `rgb(${(i+1)*COLOR_STEP},0,0)`  // COLOR_STEP=30
```

### 마스크 추출

```
for 각 픽셀:
  if alpha < 240: continue       // 반투명 엣지 제거 (불투명만)
  li = round(r / COLOR_STEP) - 1
  mask[idx] = li + 1             // 1..N_LETTERS
  letterPx[li].{xs,ys}.push(...)
  letterC{x,y}[li] 누적
```

각 글자의 픽셀 집합과 중심 좌표를 저장한다. `mask`는 `Uint8Array(W×H)`.

---

## 7. 파티클 초기화

각 글자 `li`에 대해 `PER_LETTER=40`개 파티클을 생성:

```
랜덤 픽셀 (xs[ri], ys[ri]) + ε(±0.5)로 위치
angle = random × 2π
baseSpd = BASE_SPEED × (0.5 + random × 1.0)
(vx, vy) = (cos, sin) × baseSpd
homeIdx[i] = li + 1
```

SoA(Struct of Arrays) `Float32Array`로 저장: `px, py, vx, vy, baseSpd`.

---

## 8. 경계 내 이동 (`bounce`)

파티클이 자기 글자의 마스크를 벗어나지 않도록 한다.

```
nx = px + vx, ny = py + vy
if inBounds(nx, ny): 이동 확정
else:
  flipX = inBounds(px - vx, ny)
  flipY = inBounds(nx, py - vy)
  flipX && !flipY → vx = -vx
  flipY && !flipX → vy = -vy
  둘 다      → (vx, vy) = -(vx, vy)
  재시도 실패 시:
    letterCenter 쪽으로 속도 재설정 + noise
    여전히 out-of-bounds → 원위치 유지
```

`inBounds(x, y) = mask[y·W + x] === homeIdx`.

---

## 9. 속도 복원 & 클램프

```
spd = |v|
newSpd = spd + (baseSpd - spd) × SPEED_LERP
scale  = min(newSpd, MAX_SPD) / spd
v *= scale
```

매 프레임 속도를 baseSpd로 부드럽게 복귀시키며 최대치 클램프.

---

## 10. 글자 드래그 오프셋

마우스/터치 down 상태에서 커서로부터 `SNAP_R = 150 px` 내에 있는 글자 중심을 커서 방향으로 끌어당긴다.

```
t = 1 - dist/SNAP_R
target = clamp(dx × t, ±MAX_OFFSET_X)
lox[li] += (target - lox[li]) × EASE
```

각 글자가 독립적인 `lox, loy` 오프셋을 가지며, 렌더링 시 `(px + lox, py + loy)`로 그린다. 물리 계산(충돌)은 원래 좌표 기준이라 모양이 유지된다.

---

## 11. 공간 해시 그리드

이웃 탐색을 위한 간단한 그리드 해시.

```
gridW × gridH × 40 slots (최대 40개/셀)
매 프레임 buildGrid():
  for i: grid[cell × 40 + slot++] = i
```

---

## 12. 선 그리기 (`drawLines`)

각 파티클 `i`에 대해 3×3 이웃 셀에서 `j > i && homeIdx[j] === homeIdx[i]` 인 이웃을 모은 뒤, 가장 가까운 `NEAREST_K=3`개만 선택.

### Line-of-sight 검사

두 점 사이를 `STEPS=10`으로 샘플링하여 모든 중간 픽셀의 `mask`가 같은 글자여야 선을 그린다. 글자 스트로크의 오목한 부분을 가로지르는 선을 방지.

### 선 스타일

```
d     = sqrt(d²)
t     = 1 - d / SEARCH_R
alpha = t² × 0.8
lineWidth = 1.0 + t × 0.6
strokeStyle = rgba(brand_rgb, alpha)
```

가까울수록 더 진하고 굵게.

---

## 13. 점 그리기 (`drawDots`)

```
for 각 글자:
  if glowRadial:
    글자 파티클 centroid + spread 계산
    createRadialGradient(cx, cy, 0 → glowR)
    alpha = 0.07 × min(1, (baseR/glowR)²)
    fill 원
  for 40 파티클: arc(rx, ry, 2.6, 0, 2π)
  fill(브랜드색)
```

`baseR = SEARCH_R × 1.4`, `glowR = max(baseR, spread × 1.1)`.

---

## 14. Boom 이펙트

```
BOOM_DURATION = 110 frames
```

1. `triggerBoom()`: 각 파티클에 글자 중심→파티클 방향으로 속도 `7 ~ 16 + noise` 부여.
2. Boom 중: 매 프레임 `v *= 0.97`, 선은 그리지 않음.
3. 완료 후: 모든 파티클을 글자 픽셀에서 무작위 샘플링하여 재배치, `baseSpd` 로 재초기화.

---

## 15. 렌더 루프

```
fillRect('#050505', W, H)   // 딥 블랙 배경
updateOffsets()
update()                    // 속도 복원 + bounce (또는 boom)
buildGrid()
drawLines()
drawDots()
requestAnimationFrame
```

---

## 16. 인터랙션

- **마우스**: `mousemove` / `mousedown` / `mouseup`.
- **터치**: `touchstart/move/end` with `preventDefault`.
- **Boom 버튼**: `#boom-btn` 클릭 시 `triggerBoom()`.
- **리사이즈**: `getSize → setCanvasSize → buildMask → initGrid → initParticles`.

---

## 17. GUI (lil-gui)

| 파라미터 | 값 | 설명 |
|----------|-----|------|
| `Radial Glow` | toggle | 글자 주변 방사형 글로우 |
| `Brand` | Google / YouTube / Gmail / Gemini | 브랜드 전환 |
