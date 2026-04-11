# Starbucks Brand Artwork — Bean Matrix 스펙

## 1. 파일 구성

```
starbucks/
  index.html   — 캔버스, 힌트, 슬라이더 UI
  style.css    — 전역 스타일
  script.js    — 전체 로직 (BeanMatrix, AudioEngine, Siren canvas)
  assets/
    Front.png               — 커피 원두 앞면
    Back.png                — 커피 원두 뒷면
    starbucks_logo.png      — (선택) 사용자 로고 이미지
```

`/common/touch-cursor.ts` 추가 로드.

---

## 2. 컨셉

하단 슬라이더(1 → 100)로 커피 원두의 개수(그리드 해상도)를 조절한다. 개수가 늘어날수록 그리드 셀에 로고 픽셀이 매핑되어 **Starbucks 사이렌 로고가 점점 선명해진다**. 커피 원두의 앞/뒷면이 각각 로고의 밝은/어두운 영역을 표현한다. 커서 주변의 원두는 Coulomb 척력으로 밀려났다가 Hooke 스프링으로 제자리로 복귀한다. 슬라이더를 처음 올릴 때 그라인더 ASMR 사운드가 재생된다.

---

## 3. 장면 단계

| 슬라이더 | cols | 씬 |
|---------|------|----|
| 0 | 1 | Single Bean — 화면 중앙에 하나의 거대한 원두 |
| 1 | 2 | 2×2 |
| 2 | 3 | 3×3 |
| 3 | 4 | 4×4 |
| 4..49 | exponential | `round(4 × (MAX_COLS/4)^t)`, t=(v-3)/46 → 최대 100×100 |

`MAX_COLS = 100` (슬라이더 max 49).

---

## 4. Bean (파티클)

```ts
class Bean {
  targetX, targetY   // 그리드 목표 위치
  x, y               // 현재 위치
  vx, vy             // 속도
  size               // 한 변 길이
  isFront            // true = Front.png / false = Back.png
  _repelled          // 이 프레임에 척력 받았는지
}
```

### 힘 적용

**Coulomb-ish 척력** (커서):
```
d² = (x - mx)² + (y - my)²
if d² < RADIUS²:
  str = (1 - d/RADIUS) × FORCE
  v += (Δ/d) × str
  _repelled = true
```

**Hooke 스프링** (원점 복귀):
```
v += (target - pos) × SPRING_K
```

**Symplectic Euler 적분 + 감쇠**:
```
damp = _repelled ? DAMPING : RETURN_DAMPING
v *= damp
pos += v
_repelled = false
```

두 감쇠를 구분한다: 척력 중엔 `DAMPING=0.75` (강), 복귀 중엔 `RETURN_DAMPING=0.92` (약) → 돌아올 때 스프링 진동이 살아있다.

### 정지 최적화

```
isAtRest = |vx|<0.04 && |vy|<0.04 && |x-tx|<0.04 && |y-ty|<0.04
```

`hasInput === false && isAtRest()` 이면 업데이트 스킵 (수천 개 파티클 성능).

### 상수

| 이름 | 값 |
|------|----|
| `REPULSION_RADIUS` | 80 px |
| `REPULSION_FORCE` | 5 |
| `SPRING_K` | 0.031 |
| `DAMPING` | 0.75 |
| `RETURN_DAMPING` | 0.92 |

---

## 5. 그리드 빌드 (`_buildGrid`)

```
cols = _colsFromSlider()
if cols === 1:
  single bean: size = min(W,H) × 0.62, 중앙 배치
  return

rows   = cols
gridSz = W - 48              // 24px 좌우 패딩
cellW  = gridSz / cols
beanSz = cellW × 0.90
offX   = 24
offY   = (H - gridSz) / 2    // 세로 중앙
cx, cy = W/2, H/2
R      = gridSz/2             // 원형 마스크 반경

for each (r, c):
  tx = offX + c × cellW + cellW × 0.5
  ty = offY + r × cellW + cellW × 0.5
  if (tx - cx)² + (ty - cy)² > R²: continue   // 원 밖 skip
  isFront = _logoBrightness(c, cols, r, rows) > 128
  beans.push(new Bean(tx, ty, beanSz, isFront))
```

그리드는 정사각형이지만 원형 마스크를 적용하여 동그란 배열이 만들어진다.

---

## 6. 로고 픽셀 매핑

```
_logoBrightness(col, cols, row, rows):
  px = min(lw-1, floor(((col + 0.5)/cols) × lw))
  py = min(lh-1, floor(((row + 0.5)/rows) × lh))
  i = (py × lw + px) × 4
  return (data[i] + data[i+1] + data[i+2]) / 3
```

`this.sirenPixels`는 로고 canvas의 `getImageData`를 지연 캐시.

### 로고 소스 우선순위

1. `assets/starbucks_logo.png` 로드 성공 시:
   - 검은 배경 위에 로고를 letterbox로 300×300 canvas에 그림.
   - 전 픽셀을 `brightness > 128 ? 255 : 0`로 이진화 → 고대비 흑백 마스크.
   - `sirenPixels` 캐시 무효화 → 재빌드.
2. 로드 실패 시: 프로그래밍으로 그려진 사이렌 (`buildSirenCanvas()`)을 사용.

---

## 7. 프로그래밍 사이렌 로고 (`buildSirenCanvas`)

300×300 오프스크린 canvas. 중심 `(cx, cy)`, `R = SZ × 0.46`.

레이어 (아래→위):
1. 배경 `#000`
2. 외곽 흰 원 `R`
3. 내부 검정 띠 `R × 0.875`
4. 흰 내부 원 `R × 0.8`
5. **왕관 3개 삼각형 스파이크** (좌/중/우, 중앙이 가장 뾰족)
6. 어깨/머리카락 검정 사다리꼴 (`(cx ± 0.34R, cy - 0.30R)` → `(cx ± 0.50R, cy + 0.12R)`)
7. 얼굴 흰 타원 `(cx, cy - 0.12R), rx=0.215R, ry=0.255R`
8. 눈: 검정 점 `(cx ± 0.085R, cy - 0.14R), r=0.028R`
9. 몸통 검정 타원 `(cx, cy + 0.29R), rx=0.29R, ry=0.39R`
10. 좌/우 꼬리 (3구간 bezier curve)
11. 4개의 별 `(R × 0.935, 각도 ±0.12π, ±0.88π)`, `outerR = R × 0.042`

모두 흑/백만 사용 → 픽셀 브라이트니스 샘플링에 최적.

---

## 8. 원두 렌더링

### 이미지 모드 (기본)

- `assets/Front.png`, `assets/Back.png` 로드.
- `isFront`에 따라 선택:
  ```
  ctx.drawImage(img, x - size/2, y - size/2, size, size)
  ```

### Mipmap-like 다운스케일 (`_makeScaledBean`)

작은 셀에서 aliasing을 피하기 위해 step-down 스케일링.

```
while (w > sz*2 || h > sz*2):
  w /= 2; h /= 2
  draw onto tmp canvas (smoothing high)
final: draw onto sz×sz canvas
```

`cols ≤ 6`이면 원본 이미지를 그대로 사용, 그 외엔 셀 크기에 맞춰 사전 축소한 `_cachedFront/_cachedBack`을 사용. `_buildGrid` 호출 시 매번 갱신.

### Fallback (canvas drawing)

이미지 로드 실패 시 (`useFallback = true`) 절차적으로 원두 그림:

```
ellipse(rx=0.62r, ry=0.82r, fill = isFront ? '#5a3410' : '#231308')
if isFront: 스페큘러 하이라이트 (왼쪽 위, 밝은 베이지)
중앙 crease: moveTo(0, -0.58r) bezierCurveTo(±0.22r, ...) → (0, 0.58r)
  isFront: 오른쪽으로 휨, Back: 왼쪽으로 휨
lineWidth = max(0.5, 0.07r), 색 #3a1e06 / #0e0502
```

---

## 9. AudioEngine (Web Audio API)

오디오 파일 없이 모든 사운드를 프로시저럴 생성.

### `_init()`

```
actx = new AudioContext()
if state === 'suspended': actx.resume()
```

첫 사용자 제스처(`mousedown`/`touchstart`, `{ once: true }`)에서 자동 언락.

### `playGrind(intensity = 1.0)` — 그라인딩/ASMR

```
dur = 1.4 × intensity
스테레오 buffer 생성
for each sample:
  env   = (1 - e^(-t×40)) × e^(-t × 2.5/intensity)  // 빠른 어택, 느린 디케이
  noise = random × 0.55                              // brown noise base
  g1    = sin(t × 280 + random×0.8) × 0.2            // 중역 그라인딩
  g2    = sin(t × 960 + random×0.3) × 0.08           // 고역 텍스처
  thud  = sin(t × 60) × e^(-t × 8) × 0.3             // 저역 thud
  out   = (noise + g1 + g2 + thud) × env × 0.42 × intensity
```

### 필터 체인

```
src → highpass(120Hz) → lowpass(1400Hz, Q=0.7) → gain(0.75) → destination
```

### `playSnap()` — 짧은 크리스프 snap

```
dur = 0.18 s
d[i] = random × e^(-t × 60) × 0.9
src → gain(0.5) → destination
```

### 트리거

- 슬라이더가 0 → >0로 첫 진입 시: `audio.playGrind(1.0)`.

---

## 10. 배경 & 카운트

```
fillStyle = '#0d0700'
fillRect(0, 0, W, H)

if not imagesReady:
  fillText('Loading…', W/2, H/2, 'rgba(255,255,255,0.25)', 16px)
  return

draw all beans

if beans.length > 1:
  R = (W - 48) / 2
  topY = H/2 - R - 12
  fillText(beans.length.toLocaleString(), W/2, topY,
           'rgba(255,255,255,0.4)', 11px Apple SD Gothic Neo)
```

---

## 11. 슬라이더 UI

```
#slider-wrap
  .slider-label: 1
  <input type="range" id="slider" min="0" max="49" value="0" step="1">
  .slider-label: 100
```

- CSS: `--pct` 변수로 fill gradient 퍼센티지 갱신.
- 첫 입력 시 `#hint-text` 숨김 (`.hidden` 클래스).
- `prevSliderVal ≤ 0 && v > 0`이면 `playGrind`.

---

## 12. 입력

| 이벤트 | 액션 |
|--------|------|
| `mousemove` | `mouseX/Y` 갱신 |
| `mouseleave` | `(-9999, -9999)` |
| `touchstart/move` | `preventDefault` + 좌표 갱신 |
| `touchend` | `(-9999, -9999)` |
| `mousedown/touchstart` (once) | audio unlock |
| `slider input` | UI 갱신 + grid rebuild + (첫 진입 시) grind 사운드 |
| `resize` | `_resizeAndRebuild()` |

---

## 13. 메인 루프

```
_tick:
  loop() = _update() → _draw() → rAF(loop)
  rAF(loop)
```

`_update()`: 모든 bean에 대해 `applyRepulsion` + `applySpring` + `integrate`. 휴면 bean은 스킵.

---

## 14. 색상

| 요소 | 값 |
|------|----|
| 배경 | `#0d0700` |
| Fallback bean front | `#5a3410` (하이라이트 `rgba(255,200,140,0.18)`, crease `#3a1e06`) |
| Fallback bean back | `#231308` (crease `#0e0502`) |
| 로고 base | `#00704A` (Starbucks Green) — 현재 스크립트는 흑백 마스크만 사용 |
| 카운트 라벨 | `rgba(255,255,255,0.4)` |
