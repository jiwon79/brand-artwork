# Netflix Brand Artwork — Warp Tunnel 스펙

## 1. 파일 구성

```
netflix/
  index.html      — app shell (393×852), canvas, card layer, slider, overlays
  script.js       — 메인 로직
  contents.json   — SHOWS 데이터 (title, img, …)
```

`/common/touch-cursor.ts` 추가 로드.

의존성: `three`, `gsap` (ES 모듈).

---

## 2. 컨셉

393×852 모바일 프레임(iPhone 기준) 안에서 Netflix 콘텐츠 포스터 90장이 카메라를 향해 터널처럼 돌진한다. 우측 세로 페이더 슬라이더로 속도를 제어하며, 값이 0→1로 커질수록:

1. 카드가 빨라지고 포스터가 페이드 아웃 → **컬러 바**(스트리크 팔레트 색 그라데이션)로 크로스페이드.
2. 별이 도트에서 세로 광선(streak) 으로 변한다.
3. 카드가 세로로 늘어나며 `> 0.80`부터 **HYPER** 가속.
4. 화면 가장자리에 레드 비네트 (`#E50914`).
5. 블러가 증가.

슬라이더를 놓으면 값이 자동 감쇠(0.008/30ms)하여 정지 상태로 복귀.

---

## 3. App Frame

```
#app: 393 × 852 px (iPhone-sized portrait)
  #canvas        z-index 1
  #cards-layer   z-index 2  (DOM 카드)
  #vignette      z-index 5
  #grain         z-index 8  (SVG fractalNoise, opacity 0.04)
  #slider-…      z-index 10
  glitchLabel    z-index 9
```

`appWidth = 393`, `appHeight = 852`.

---

## 4. 카메라 & 투영

Three.js `PerspectiveCamera(fov=70°, near=0.1, far=300)`, origin (0,0,0).

수동 DOM 투영 (Three 동기화):

```
FOV_RAD   = 70 × π/180
FOCAL_PIX = (appHeight/2) / tan(FOV_RAD/2)   ≈ 608 px/unit @ depth=1
```

3D → 2D:

```
depth = -card.z
pixelScale = FOCAL_PIX / depth
screenX = appWidth/2 + card.x × pixelScale
screenY = appHeight/2 - card.y × pixelScale
cssScale = CARD_W × pixelScale / CARD_BASE_W
```

---

## 5. Stars

### 생성

```
STAR_COUNT = 300
starBasePos[i] = (±40, ±40, -0~160)    // 균일 랜덤
```

### 스프라이트

32×32 canvas에 radial gradient (white 1.0 → 0.85 @ 0.35 → 0)으로 소프트 디스크. `CanvasTexture`로 Points material에 매핑.

### Points material

```
color: 0xffffff
size: 0.6 (기본)
sizeAttenuation: true
transparent: true
alphaTest: 0.01
```

### Streak LineSegments

각 star마다 2 vertex(base + tip). 초기 opacity 0.

### 슬라이더에 따른 변화

```
streakFade = clamp((sliderValue - 0.3) / 0.3, 0..1)
starMat.size    = 0.2 + max(0, sv-0.5) × 0.5
starMat.opacity = max(0.15, 1 - streakFade)
streakMat.opacity = streakFade × 0.85
```

`streakMat.opacity > 0.02`일 때만 geometry 갱신:

```
streakLen = sv × 10 × hyperMult
for each star:
  vertex0 = (sx, sy - len/2, sz)   // 세로 광선
  vertex1 = (sx, sy + len/2, sz)
```

Stars + Streaks `rotation.z = t × 0.003` (느린 회전).

Scene fog: `FogExp2(0x000000, 0.016)`.

---

## 6. Cards (DOM)

```
CARD_COUNT    = 90
TUNNEL_RADIUS = 5.5
CARD_W × CARD_H = 2.0 × 1.3
TUNNEL_LENGTH = 80
CARD_BASE_W = 520 (DOM px)
CARD_BASE_H = round(520 × 1.3/2.0) = 338
```

### 초기 배치

```js
placeCard(card, i):
  angle = i × 2.39996   // golden angle
  r = TUNNEL_RADIUS + sin(i × 2.3) × 1.5
  card.x = cos(angle) × r
  card.y = sin(angle) × r × 1.5
  card.z = -(2 + (i/CARD_COUNT) × TUNNEL_LENGTH)
```

### 재활용

`card.z > 3`이면 `placeCard(card, i, isRecycle=true)` 호출, z를 `-(TUNNEL_LENGTH + 2 + random × 10)` 로 다시 뒤쪽에 배치.

### 엘리먼트 구조

```html
<div class="card-el">
  <img src="show.img" />
  <div class="card-meta"><div class="card-title-text">${title}</div></div>
</div>
```

- 520×338 DOM 크기, `transform-origin: center`.
- `background`는 랜덤 streak 팔레트 색의 좌→우 그라데이션 (카드가 컬러바로 전환될 때 이 배경이 드러남):
  ```
  linear-gradient(to right, transparent, color+bb 18%, color 42-58%, color+bb 82%, transparent)
  ```

### STREAK 팔레트

레퍼런스 이미지에서 샘플한 31색: 빨강/크림슨, 오렌지레드, 오렌지/앰버, 골드, 핑크/핫핑크, 로즈, 브라운/카파, 딥블루, 브라이트블루, 틸/블루그린, 그린. `pickStreakColor()`로 무작위.

### 포스터 → 컬러바 크로스페이드

```
img.opacity = max(0, 1 - (sv - 0.35) / 0.45)
```

`sv = 0.35`에서 시작 `sv = 0.80`에서 완전 투명.

### 메타 텍스트

```
meta.opacity = (sv < 0.4 && depth < 44)
  ? min(1, (44 - depth)/16)
  : 0
```

---

## 7. 속도 & Hyper Mode

```
hyperMult  = sv > 0.80 ? 1 + (sv - 0.80) × 5 : 1      // 0.80→1.0 → 1×→2×
baseSpeed  = 7.0 + sv × 34
speed      = baseSpeed × hyperMult × dt
card.z    += speed
```

### Vignette

```
vignette.opacity = max(0, (sv - 0.55) / 0.45) × 0.55
```

`#E50914` radial gradient, `mix-blend-mode: screen`.

### Blur (카드 레이어 통합 필터)

```
blurBase = max(0, sv - 0.25) × 4.0
layerFilter = blurBase > 0.2 ? `blur(${blurBase × 0.35}px)` : ''
cardsLayer.style.filter = layerFilter
```

개별 카드 이미지에는 필터를 걸지 않아 리페인트 부하를 줄인다.

---

## 8. 수직 Stretch (HYPER)

각 카드에 수직 스케일을 적용한다.

```
depth        = -card.z
depthFactor  = max(0, 1 - depth/12)
baseStretch  = sv² × 1.5
formulaStretchY = 1 + baseStretch × (1 + depthFactor × 4) × 1.8

hyperTraw = clamp((sv - 0.40) / 0.60, 0..1)
hyperT    = smoothstep(hyperTraw) = hyperTraw² × (3 - 2×hyperTraw)
targetStretch = 2 × appHeight / visH   // 화면 2배 채움
stretchY = formulaStretchY + (targetStretch - formulaStretchY) × hyperT
```

`scale(finalScale, finalScale × stretchY)`.

---

## 9. 호버 & Glitch Label

### 호버 scale

`sv ≤ 0.60` 일 때만:

```
targetScale = isHovered ? 1.3 : 1.0
scaleVal   += (targetScale - scaleVal) × 0.12
```

`sv > 0.60`이면 `scaleVal = 1`, `cardsLayer.pointerEvents = 'none'`.

### Glitch label

`sv < 0.25` SLOW 모드 + 호버된 카드만:

- 카드 바로 아래(y + CARD_H×px/2 + 6) 위치.
- fontSize = `clamp(6, FOCAL_PIX/depth × 0.25, 20)`.
- 타이틀 문자 중 `sin(t×10 + c×1.3) > 0.7`인 글자만 `!@#$%^&*ABCDEF` 중 랜덤으로 치환.
- `textShadow: ${sin(t×20)×3}px 0 #E50914, -(...)px 0 #4a90d9` — 크로마 지터.
- 폰트: `Arial Black`, weight 900, letter-spacing 2px, uppercase.

---

## 10. Frustum Cull & Near/Far Fade

```
if depth ≤ 0.3 || depth > TUNNEL_LENGTH + 15: display = none
if screen outside ±visSize: display = none

farFade  = min(1, max(0, (TUNNEL_LENGTH - depth) / 20))
nearRaw  = clamp((depth - 0.5) / 17.5, 0..1)
nearFade = nearRaw²                       // ease-in
alpha    = farFade × nearFade
```

`zIndex = floor(10000 - depth × 10)` (매 3프레임만 갱신).

---

## 11. 슬라이더 (세로 페이더)

### UI

```
우측, top:50% 고정, 52×300 px
track: 중앙 세로 2px 라인
ticks: 21개 (4단위마다 major, 7px / 4px)
fill:  gradient(#E50914 아래 → 위)
thumb: 52×28, glass (blur 12px), 활성 시 레드 글로우
```

### 상태

```
sliderValue = 현재 값
targetSlider = 목표 (드래그 또는 감쇠 주도)
매 프레임: sliderValue += (targetSlider - sliderValue) × 0.12
```

### 드래그

```
onDragStart: isDragging=true, dragStartY, dragStartVal
onDragMove:  dy = startY - currentY
             sliderValue = clamp(dragStartVal + dy/TRACK_H(300))
             targetSlider = sliderValue
onDragEnd:   startDecay()
```

### 레일 클릭 점프

```
fromBottom = rect.bottom - clientY
sliderValue = clamp(fromBottom / 300)
```

### 자동 감쇠

```
startDecay():
  100ms 지연 후
  매 30ms: targetSlider = max(0, targetSlider - 0.008)
  0 도달 또는 isDragging이면 정지
```

---

## 12. 렌더 루프 (`animate`)

```
1. 슬라이더 smoothing
2. speed 계산
3. vignette 업데이트
4. Star / Streak material 갱신
5. (streak가 보일 때만) streak geometry 업데이트
6. cardsLayer.filter 갱신
7. 각 카드 업데이트:
   - z += speed
   - recycle 체크
   - depth cull
   - 2D 투영
   - stretchY 계산
   - hover scale
   - near/far fade
   - transform + opacity + zIndex(throttled)
   - img.opacity (포스터 crossfade)
   - meta.opacity
8. Glitch label (호버 + SLOW)
9. 4프레임마다 animateGrain() (±2px translate jitter)
10. renderer.render
```

### 쓰기 최소화 최적화

- `card._alpha`, `_imgOp`, `_metaOp`, `_imgFilter` 캐시 후 변경시에만 `style.*` 쓰기.
- `zIndex`는 매 3프레임, grain은 매 4프레임만 갱신.
- streak geometry는 opacity > 0.02 일 때만.

---

## 13. 데이터 (`contents.json`)

`SHOWS = [{ title: string, img: string, ... }]` 형태. 90 카드는 `SHOWS[i % SHOWS.length]`로 순환.

---

## 14. 상수 요약

| 이름 | 값 | 설명 |
|------|----|------|
| `STAR_COUNT` | 300 | 별 개수 |
| `CARD_COUNT` | 90 | 카드 개수 |
| `TUNNEL_RADIUS` | 5.5 | 터널 반경 |
| `CARD_W × H` | 2.0 × 1.3 | 3D 카드 크기 |
| `TUNNEL_LENGTH` | 80 | 터널 길이 |
| `CARD_BASE_W` | 520 px | DOM base width |
| `FOV` | 70° | 카메라 |
| `TRACK_H` | 300 px | 슬라이더 트랙 |
| decay step | 0.008 / 30ms | 슬라이더 복귀 속도 |
| `baseSpeed` | 7 + 34×sv | 카드 이동 속도 base |
| `hyperMult` | 1..2× @ sv∈[0.80..1.0] | HYPER 배율 |

---

## 15. 폰트 & 색상

- **폰트**: `Arial Black`, `Arial`, sans-serif (Netflix의 블랙 타이포 느낌).
- **배경**: `#000`.
- **브랜드 레드**: `#E50914` (슬라이더 fill, 비네트, glitch chroma).
- **글리치 보조색**: `#4a90d9` (chroma 반대편).
- **카드 타이틀**: 흰색, 9 px, letter-spacing 1px, uppercase.
