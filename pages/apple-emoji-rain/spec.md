# Apple Brand Artwork — Emoji Rain 스펙

## 1. 파일 구성

```
apple-emoji-rain/
  index.html   — 캔버스, 리셋 버튼, flash 오버레이
  script.ts    — 전체 로직 (TypeScript)
  assets/
    paper.jpeg — 배경 종이 텍스처
```

`/common/touch-cursor.ts`를 추가로 로드한다.

---

## 2. 컨셉

iOS 26.2 신규 이모지(🫍 🫈 🪎 🫯 🛘 🪊 🫪) 7종과 기존 얼굴 이모지 50종이 위에서부터 순서대로 떨어져 직사각형 박스 안에 쌓인다. 빈티지 종이 질감 위에 중력·충돌·척력 기반의 부드러운 물리 애니메이션으로 표현한다.

- **드래그**: 스와이프 방향으로 중력이 전환되고 이모지 더미가 그 방향으로 쏟아진다.
- **더블탭/더블클릭**: 척력 모드 토글, 이모지들이 벽·서로에게서 밀어내며 공중을 떠다닌다.

---

## 3. 박스 레이아웃

4:5 세로 비율의 박스를 화면 중앙에 배치한다.

```
vw/vh > 4/5 → H = vh - 2·PAD, W = H·4/5
vw/vh ≤ 4/5 → W = vw - 2·PAD, H = W·5/4
OX = (innerWidth - W) / 2
OY = (innerHeight - H) / 2
```

- `PAD = 20` px
- 캔버스는 뷰포트 전체를 덮고 DPR 스케일 적용, 내부 박스(OX, OY, W, H)만 클립하여 그린다.
- 박스 배경: `#FFFFFF` 위에 `paper.jpeg` 반복 패턴 (기본 opacity 0.7).
- 캔버스 바깥 배경: `#E8DDD0` (크래프트 톤).

---

## 4. 이모지 카탈로그

### 새 이모지 (큰 원)

| emoji | color |
|-------|-------|
| 🫍 | `#8B6F47` |
| 🫈 | `#CE93D8` |
| 🪎 | `#FFD93D` |
| 🫯 | `#FFA726` |
| 🛘 | `#4FC3F7` |
| 🪊 | `#A5D6A7` |
| 🫪 | `#FF6B6B` |

각 새 이모지는 지정 색상의 단색 원 + 흰색 외곽선(`lineWidth = max(1.5, r×0.07)`) 위에 이모지 글리프를 얹어 스티커처럼 렌더.

### 얼굴 이모지 (작은 원)

기본 Apple Color Emoji 50종 (😀~🤯). 배경 원 없이 텍스트만 그리며 선택적 drop shadow 적용.

### 폰트 스택

`"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`

---

## 5. 스폰 큐

```
mode === 'new'  → 새 이모지 7종 셔플
mode === 'face' → 얼굴 이모지 50종 셔플
mode === 'all'  → stepN = ceil(reg.length / newE.length) 간격으로 섞음
```

`tickSpawn(now)`이 매 프레임 호출되어 `spawnInterval` (기본 40 ms) 경과 시 큐의 다음 이모지를 상단에서 drop.

```
x = OX + r + random × (W - 2r)
y = OY - r                         // 박스 위쪽에서 진입
vx = (random - 0.5) × 2
vy = random + 0.5
opacity = 0 → 프레임당 +0.08로 fade in
```

---

## 6. 파티클 속성

```ts
interface Particle {
  emoji:   string
  isNew:   boolean
  color:   string    // 새 이모지만 사용
  x, y:    number
  vx, vy:  number
  r:       number    // 충돌 반지름
  size:    number    // 폰트 크기
  rand:    number    // 스폰 시 크기 배율
  opacity: number    // 0→1 fade in
}
```

### 크기 & 충돌 반지름

| 종류 | rand | size | r |
|------|------|------|---|
| 새 이모지 | 0.85 ~ 1.15 | `W × newEmojiSize × rand` | `size × 0.70` |
| 얼굴 이모지 | 0.75 ~ 1.50 | `W × faceEmojiSize × rand` | `size × 0.62` |

기본값: `newEmojiSize = 0.125`, `faceEmojiSize = 0.06`.

---

## 7. 물리

### 중력 모드 (기본)

```
vx += gx
vy += gy
x  += vx
y  += vy
```

- 초기값: `gx=0, gy=0.4`.
- 스와이프로 `(gx, gy)`가 4방향 중 하나로 회전하며 크기는 `params.gravity`로 유지.

### 벽 충돌 (박스 4면)

```
RESTITUTION = 0.25
FRICTION    = 0.80   (중력 수직 방향 속도에 적용)
```

벽 침투 시 위치 보정 + 정반대 방향 속도 성분 반전 × RESTITUTION. 중력 방향과 일치하는 벽에서 FRICTION을 수직 속도에 곱함.

### 파티클 간 충돌

매 프레임 `COLLISION_PASSES = 8`회 순회:

```
overlap = (a.r + b.r - d) / 2
a, b를 법선 방향으로 overlap만큼 분리
dvDot = (b.v - a.v) · n
dvDot < 0 → imp = dvDot × (1 + RESTITUTION) × 0.5
```

### 척력 모드

더블탭 토글. 활성화 시 `gx = gy = 0`.

```
REPULSION_DIST       = 130 px   // 파티클 표면-표면
REPULSION_FORCE      = 0.6
WALL_REPULSION_DIST  = 120 px   // 파티클 표면-벽
WALL_REPULSION_FORCE = 2.5
REPULSE_DAMP         = 0.94      // 프레임당 감쇠
```

- `repulseT`가 `repulseEase` (기본 0.01) 씩 0→1로 증가하면서 힘이 ease-in.
- 벽·이웃 척력 적용 후 전 속도에 `REPULSE_DAMP` 곱.
- 벽에 붙어 멈추는 현상 방지를 위해 벽 근처 파티클은 `MIN_VEL = 1.5` 이상 속도를 강제.
- 기준 크기 `baseR = W × faceEmojiSize × 0.62` 대비 파티클 크기 비율로 힘 스케일링 → 크기 무관한 일관된 척력.

### 척력 진입 킥

토글되는 순간 중심으로부터 바깥 방향으로 `6 ~ 10` px/frame 즉각 속도 부여.

---

## 8. 스프라이트 캐시

매 프레임 `fillText` / shadow blur를 피하기 위해 `OffscreenCanvas` + `transferToImageBitmap()`로 사전 렌더한 ImageBitmap을 사용한다.

### 이모지 스프라이트 (`emojiCache`)

```
key       = `${emoji}_${round(fontSize/3)×3}`   // 3 px 그룹핑
physSize  = ceil(fontSize × 1.6 × DPR)
off.font  = `${fontSize×DPR}px ${EMOJI_FONT}`
fillText(..., baseline middle, y offset = fontSize×DPR×0.04)
```

### 그림자 스프라이트 (`shadowCache`)

```
key    = round(r)
rP     = r × DPR
blur   = rP × 0.75
offX   = rP × 0.08,  offY = rP × 0.13
pad    = blur + max(offX, offY) + 4
size   = ceil((rP + pad) × 2)
```

trick: `shadowOffsetY += hideY` 만큼 오프셋하고 원을 `hideY`만큼 위로 올려 그려 원 본체는 캔버스 밖, 그림자만 남김 → `destination-out` 없이 GPU 가속 유지.

크기 변경/강도 변경 시 각각 `clearEmojiCache()` / `clearShadowCache()` 호출.

---

## 9. 렌더 파이프라인

```
fillRect(bgColor #E8DDD0)             // 전체 배경
fillRect(OX,OY,W,H, #FFFFFF)          // 박스 배경
if paperPattern: fill(OX,OY,W,H, paperOpacity)
clip(OX,OY,W,H)
for each particle:
  globalAlpha = p.opacity
  if shadow: drawImage(shadowSprite)
  if isNew: circle(fill p.color) + stroke(rgba(255,255,255,0.9))
  drawImage(emojiSprite)
if dirOverlay: fillText(emoji) at 중앙
```

---

## 10. 스와이프 제스처

```
distThreshold = isTouch ? 40 : 50 (px)
timeThreshold = isTouch ? 500 : 800 (ms)
```

방향 판정은 `|dx| vs |dy|` 비교. 스와이프 성공 시:

1. `(gx, gy)` 를 해당 4방향 × `params.gravity`로 설정.
2. `repulseMode = false`.
3. 각 파티클에 방향별 kick 속도(±5 px/frame) 추가.
4. `flashEl`에 0.5초 ease-out 색 플래시.
5. 박스 중앙에 방향 이모지(⬆️⬇️⬅️➡️)를 alpha 2.0 → 프레임당 -0.025로 페이드.

| 방향 | flash color | kick |
|------|-------------|------|
| down  | `rgba(255,213,79,0.5)`  | `(0,  5)` |
| up    | `rgba(77,182,172,0.5)`  | `(0, -5)` |
| right | `rgba(255,167,38,0.5)`  | `( 5, 0)` |
| left  | `rgba(79,195,247,0.5)`  | `(-5, 0)` |

---

## 11. 더블탭 → 척력 토글

- 단일 탭(dist < 10px 마우스 / 20px 터치) 2회가 350 ms 이내에 들어오면 `toggleRepulse()`.
- 토글 시 `rgba(186,104,200,0.5)` 보라 플래시.

---

## 12. 리셋 버튼

- 하단 중앙 고정, `↺ 다시 시작`.
- 클릭 시: `repulseMode=false`, `repulseT=0`, `(gx,gy)=(0,params.gravity)`, `restartQueue()` (파티클 전체 제거 + 큐 재구성).

---

## 13. Debug GUI (lil-gui)

| 항목 | 범위 | 기본값 | 설명 |
|------|------|--------|------|
| 중력 | 0.1 ~ 3.0 | 0.4 | `(gx,gy)` 크기 유지하며 스케일 |
| 큰 이모지 크기 | 0.05 ~ 0.25 | 0.125 | W 대비 비율 |
| 작은 이모지 크기 | 0.02 ~ 0.12 | 0.06 | W 대비 비율 |
| 스폰 간격 (ms) | 20 ~ 200 | 40 | 큐 drop 주기 |
| 척력 전환속도 | 0.0001 ~ 0.2 | 0.01 | `repulseT` 증가량 |
| 쉐도우 | toggle | on | drop shadow 사용 |
| 쉐도우 강도 | 0 ~ 1 | 0.2 | shadow alpha |
| 종이 질감 | 0 ~ 1 | 0.7 | paper overlay opacity |
| 이모지 종류 | new/face/all | all | 스폰 큐 종류 |

크기/쉐도우 변경 시 관련 스프라이트 캐시 자동 flush.
