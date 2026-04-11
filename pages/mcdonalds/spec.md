# McDonald's Brand Artwork — Big Mac Burst 스펙

## 1. 파일 구성

```
mcdonalds/
  index.html  — 캔버스, 카피, press bar, ingredient tag
  style.css   — 전역 스타일 (index.html inline)
  burst.js    — 메인 로직 (실제 로드)
  script.js   — 초기 프로토타입 (The Fry Matrix, 현재 미사용)
  assets/
    top-bun.png, lettuce.png, tomato.png, cheese.png, patty.png, bottom-bun.png
```

`/common/touch-cursor.ts` 추가 로드.

> NOTE: `script.js`(Fry Matrix)는 현재 index.html 에서 로드하지 않는 과거 프로토타입이며, 실제 배포 로직은 `burst.js`이다.

---

## 2. 컨셉

맥도날드 Big Mac 5층 (bun / lettuce / tomato / cheese / patty / bun) 일러스트를 한 곳에 쌓아두고, 사용자가 화면을 **꾹 눌러** 압력을 가득 채우면 버거가 폭발하며 재료가 벽에 튀어 오르고 화면 밖으로 떨어진다. 이후 각 재료가 위에서부터 다시 순차적으로 떨어져 원래 스택으로 복귀한다.

슬로건 카피: **"I'm lovin it Macdonald 🍔"**.

---

## 3. 상태 머신

```
IDLE → PRESSING → EXPLODING → DROPPING → COMPLETE → (탭) IDLE
```

| State | 동작 |
|-------|------|
| `IDLE` | 버거 부유 (bob), 카피 "I'm lovin it Macdonald 🍔" / "Tap to burst" |
| `PRESSING` | 누르는 동안 스쿼시 + 셰이크 + 붉은 비네트 + 프레스 바 채움 |
| `EXPLODING` | 재료들이 위쪽 임의 각도로 튀어나가 벽 반사 + 픽셀 충돌 + 화면 밖 낙하 |
| `DROPPING` | 최상단 재료부터 한 조각씩 떨어져 스택 재건 |
| `COMPLETE` | 완성된 버거가 황금색 글로우와 함께 부유 |

상태 전환:

- `startPress()` (mousedown/touchstart): `IDLE|COMPLETE → PRESSING` (`initPieces` + press bar 표시)
- `endPress()` (mouseup/touchend): `PRESSING → EXPLODING` (단, `pressDuration < 200ms`이면 IDLE로 취소)
- `PRESSING` 중 `pressDuration ≥ MAX_PRESS(2000ms)` → `triggerExplosion()` 자동 호출
- `EXPLODING`: 모든 piece가 `y - h/2 > H + 20`이면 `DROPPING` 전환 + piece들을 `y=-h`로 리셋
- `DROPPING`: 모든 재료 stacked → `setTimeout(500ms) → completeAnimation() → COMPLETE`

---

## 4. 재료 정의

`STACK_ORDER = [5, 4, 3, 2, 1, 0]` (bot_bun → patty → cheese → tomato → lettuce → top_bun 순으로 아래→위).

| idx | id | label | w (px) | gapAbove |
|-----|-----|-------|--------|----------|
| 0 | TOP_BUN | SESAME BUN | 187 | 0 |
| 1 | LETTUCE | FRESH LETTUCE | 187 | -45 |
| 2 | TOMATO  | RIPE TOMATO   | 173 | -52 |
| 3 | CHEESE  | CHEDDAR CHEESE| 187 | -52 |
| 4 | PATTY   | BEEF PATTY    | 180 | -58 |
| 5 | BOT_BUN | SESAME BUN    | 187 | -44 |

- `h`는 로드 후 `ing.w × naturalH/naturalW`로 실측 재계산.
- `gapAbove`는 재료 위쪽으로 겹쳐 쌓일 여유 공간 (음수 = 타이트, PNG 패딩 보정용).
- `circleR = √(w² + h²) / 2` 충돌 pre-filter용 외접원 반지름.

### 스택 좌표

```js
totalH = Σ(h + gapAbove)
startY = BURGER_CY + totalH / 2
cur = startY
for si in STACK_ORDER:   // 아래→위로 반복
  offsets[si] = cur - ing.h/2
  cur -= (ing.h + ing.gapAbove)
```

---

## 5. 알파 맵 (픽셀-퍼펙트 충돌)

이미지 로딩 후 각 재료에 대해:

```js
octx.drawImage(img, 0, 0, ing.w, ing.h)
data = getImageData(...).data
alphaMap = Uint8Array(w × h)   // RGBA의 A 채널만 추출
```

알파 `< ALPHA_THRESH(20)` 픽셀은 투명으로 처리. `PIXEL_STEP = 4` 간격으로 샘플링하여 성능 확보.

---

## 6. 피스 물리 객체

```js
{
  ing,                    // INGREDIENTS 참조
  x, y,                   // 월드 좌표
  vx, vy,                 // 속도
  rotation, vr,           // 회전, 각속도
  scaleX, scaleY,         // 로컬 스케일
  alpha,
  landed, falling, bounced,
  targetY,
}
```

---

## 7. IDLE & COMPLETE: bob

```
bobT += dt
bob = sin(bobT × (IDLE:1.8 | COMPLETE:1.5)) × (IDLE:8 | COMPLETE:6) px
drawIngredient(piece, compressY=bob)
```

COMPLETE 상태에는 추가로 중심 `(CX, BURGER_CY)`에 200px 반경 radial gradient glow (`rgba(255,199,44,0.08)` → 0) 오버레이.

---

## 8. PRESSING 스쿼시

```
t = pressDuration / MAX_PRESS      (0..1)
squashY = 1 - t × 0.55
squashX = 1 + t × 0.3
shakeAmp = t × 6
shake(X, Y) = (random - 0.5) × shakeAmp
```

각 피스:

```
distFromCenter = baseY - BURGER_CY
piece.y = BURGER_CY + distFromCenter × squashY + shakeY
piece.x = CX + shakeX
```

draw 시 `translate + scale(squashX, squashY)`로 한 번 더 스쿼시.

### 비네트

```
r = floor(t × 180)
background = radial-gradient(ellipse center, transparent 30%, rgba(r,0,0, t×0.7) 100%)
```

### Press Bar

```
#pressBarFill.width = (t × 100)%
linear-gradient(90deg, #FFC72C, #FF0000)
```

### Cheese drip

`t > 0.5 && random < 0.3`일 때 중심 주변에 치즈색 큰 파티클 드립 스폰.

---

## 9. EXPLODING

```
triggerExplosion():
  state = EXPLODING
  pressBar opacity 0, vignette 제거
  spawnBurstParticles(CX, BURGER_CY, 80)
  각 piece에:
    angle = angles[i] + (random-0.5) × 0.4
    speed = 500 ~ 900
    vx = cos(angle) × speed × (i%2 ? -1 : 1)
    vy = sin(angle) × speed
    vr = (random - 0.5) × 8
  copy: "I'm lovin it Macdonald 🍔" / "Tap to burst again"
```

`angles = [-0.7π, -0.85π, -0.55π, -0.65π, -0.9π, -0.5π]` — 위쪽 절반 방향.

### 물리 업데이트

```
GRAV = 980 px/s²
piece.vy += GRAV × dt
piece.(x,y) += piece.(vx,vy) × dt
piece.rotation += vr × dt
piece.vr *= 0.98
```

### 벽 반사

- 좌/우 벽: 반발 계수 0.7, 위치 보정.
- 천장: 반발 계수 0.5.
- **바닥 없음** — 화면 밖으로 자유 낙하.

### 피스-피스 픽셀 충돌 (`checkPixelCollision`)

1. **Pre-filter**: 외접원 `dist² > (ra + rb)²` → skip.
2. **픽셀 검사**: A의 local 픽셀을 `PIXEL_STEP=4` 간격으로 순회
   - A local → world → B local 변환 (rotation 행렬 / 역행렬)
   - `alphaMap[A] ≥ 20 && alphaMap[B] ≥ 20`인 첫 매치에서 `found=true`
3. **응답**: 법선 = 중심 차이 방향
   ```
   dvDot = (va - vb) · n
   if dvDot > 0:              // 접근 중일 때만 반응 (지터 방지)
     imp = dvDot × 0.85       // e ≈ 0.7 restitution
     va -= imp·n;  vb += imp·n
     x 위치 ±2px 분리
   ```

`EXPLODING` 중 모든 피스가 `y - h/2 > H + 20`이면 `DROPPING` 전환 (피스 `y=-h`로 재세팅).

---

## 10. DROPPING (재스태킹)

위에서부터 `STACK_ORDER`의 순서대로 한 번에 한 조각씩 떨어뜨림.

```
dropIdx = STACK_ORDER[stackedCount]
첫 진입: piece.y = -h, piece.x = CX, vx/vy/rotation = 0
piece.vy += GRAV × 2.0 × dt      // 2배 중력
piece.y += piece.vy × dt

target = stackY[dropIdx]
if piece.y >= target && vy > 0:
  y = target, x = CX, rotation = 0, vx = 0
  if !bounced:
    spawnLandParticles(CX, y + h/2)
    showIngredientTag(label)     // 700ms opacity 1 → 0
    bounced = true
  if vy > 70: vy = -vy × 0.32    // 작은 바운스
  else:
    vy = 0, landed = true
    stackedCount++
    if all stacked: setTimeout(500, completeAnimation)
```

렌더 순서: 이미 `landed`인 피스들을 `STACK_ORDER` 순으로 먼저 그리고 활성 드롭 피스를 위에 덮어 그림.

### 랜딩 파티클

```
12개, angle ∈ [0, π], speed 30..110
vx = cos(angle) × speed × ±1
vy = -random × 60
color 'rgba(200,160,80,0.8)', decay 0.04
```

### Ingredient Tag

`#ingredientTag`에 재료 label을 표시 (`opacity: 1`, 700ms 후 `0`).

---

## 11. Burst 파티클

```
spawnBurstParticles(cx, cy, count):
  각 파티클:
    angle = random × 2π
    speed = 200 ~ 700
    vx = cos(angle) × speed
    vy = sin(angle) × speed - 200         // 위쪽 편향
    life = 1, decay = 0.015 ~ 0.04
    size = 3 ~ 11
    color ∈ ['#FFC72C','#FF0000','#fff','#FFD600','#FF5722']
    isRect = 50% (rect vs circle)
    rotation, vr
```

`updateParticles(dt)`:

```
GRAV = 600
particles = filter(p.life > 0)
for p:
  vy += GRAV × dt
  x/y += vx/vy × dt
  rotation += vr × dt
  life -= decay
  draw (globalAlpha = max(0, life))
```

---

## 12. 렌더 루프

```
clearRect
fillRect('#0D0500')                 // dark background
grid: 60px spacing, rgba(255,199,44,0.04)
switch(state):
  IDLE       → draw with bob
  PRESSING   → squash + shake + cheese drips
  EXPLODING  → physics + pixel collisions + draw
  DROPPING   → draw landed + active drop
  COMPLETE   → draw with bob + golden glow
updateParticles(dt)
```

---

## 13. 입력

| 이벤트 | 동작 |
|--------|------|
| `mousedown` / `touchstart` | `startPress()` |
| `mouseup` / `touchend` | `endPress()` (< 200ms = 취소, ≥ 200ms = 폭발) |
| `resize` | W/H/CX/CY 재계산 |

---

## 14. 폰트 & 색상

- **폰트**: Bebas Neue, Black Han Sans (Google Fonts).
- **배경 캔버스**: `#0D0500` (거의 검정, 레드 톤).
- **본문 배경**: `#1a0a00`.
- **스택 bob**: 위아래 ±8 / ±6 px.
- **글로우**: `#FFC72C` (맥도날드 옐로우).
- **카피 shadow**: `0 2px 20px rgba(0,0,0,0.8)`.

### 카피 상태별

| 상태 | copyText | copySmall |
|------|----------|-----------|
| IDLE | "I'm lovin it Macdonald 🍔" | "Tap to burst" |
| PRESSING | "KEEP PRESSING..." | (empty) |
| EXPLODING/DROPPING/COMPLETE | "I'm lovin it Macdonald 🍔" | "Tap to burst again" |
