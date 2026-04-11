# Pixar Brand Artwork — Rapunzel Rope Grid 스펙

## 1. 파일 구성

```
pixar-rapunzel/
  index.html   — 9:16 캔버스
  style.css    — 전역 스타일
  script.ts    — 입력, 루프, GUI
  rope.ts      — Verlet Point/Stick/Rope 구현 + config
```

---

## 2. 컨셉

Pixar 《Tangled》 의 **라푼젤 머리카락**을 Verlet 시뮬레이션으로 재현. 9:16 캔버스에 여러 줄의 긴 금발 끈(Rope)을 격자 형태로 늘어뜨려 pin으로 고정하고, 마우스/터치 드래그로 "sweep"하여 머리카락을 쓸어내듯 움직인다. 각 Rope는 위→아래로 다크 브라운에서 밝은 금발로 이어지는 라디얼 그라데이션으로 그려진다.

---

## 3. 캔버스 (9:16 portrait)

```
scale = min(vw/9, (vh - guiHeight)/16)
W = floor(9 × scale)
H = floor(16 × scale)
left = floor((vw - W) / 2)
top  = floor(guiHeight + (vh - guiHeight - H) / 2)
```

GUI (lil-gui)는 상단 전체 너비를 차지하며 `guiHeight = gui.domElement.offsetHeight`만큼 캔버스를 아래로 밀어낸다.

---

## 4. 그리드 생성

`initRopes()`:

```
for row in [0..rows):
  for col in [0..cols):
    t  = col/(cols-1)                    // 0..1
    x  = W × 0.03 + t × W × 0.94         // 좌우 3% 여백
    rt = row/(rows-1)
    pinY = rt × H × 0.7                  // 상단 70% 내

    if uniform:
      lw   = 9.5
      len  = H × ropeLength
      segs = 20
    else:
      lw   = 7 + random × 5
      len  = H × (ropeLength - 0.06 + random × 0.12)
      segs = 16 + floor(random × 8)

    new Rope(x, pinY, len, segs, lw)
```

기본: `cols=22, rows=5, ropeLength=0.2`. 총 110개 끈.

---

## 5. Verlet Point

위치 기반 적분 (Verlet). 각 Point는 `(x, y)`와 이전 프레임 위치 `(ox, oy)`를 보유.

```ts
update(halfW, bounds):
  if pinned: return
  vx = (x - ox) × damping
  vy = (y - oy) × damping
  ox = x; oy = y
  x += vx
  y += vy + gravity

  // 경계 충돌: 위치 클램프 + 속도 0.3 배로 감쇠
  if x < halfW: x = halfW,  ox = x + (x - ox) × 0.3
  if x > W - halfW: ...
  if y < halfW: ...
  if y > H - halfW: ...
```

`halfW = lineWidth / 2`.

### Sweep 반응

```ts
sweep(mx, my, dvx, dvy):
  if pinned: return
  dist = hypot(x-mx, y-my)
  if dist > sweepRadius: return
  falloff = 1 - dist/sweepRadius
  smooth  = falloff²
  ox -= dvx × smooth × sweepStrength    // 이전 위치 이동 = 속도 주입
  oy -= dvy × smooth × sweepStrength
```

`sweepRadius=90`, `sweepStrength=1.4`. 포인터 이동 속도 `(dvx, dvy)`를 raius 내 포인트의 이전 위치에 반대로 적용 → 현재 위치와 이전 위치 차이가 커져서 다음 업데이트에 밀림.

---

## 6. Stick (constraint)

두 Point를 고정된 길이로 묶는다.

```ts
resolve():
  dx = b.x - a.x
  dy = b.y - a.y
  dist = hypot(dx, dy)
  diff = ((dist - len) / dist) × stiffness
  if !a.pinned: a += (dx, dy) × diff
  if !b.pinned: b -= (dx, dy) × diff
```

`len`은 생성 시점 거리, `stiffness=0.3`. 낮은 stiffness × 많은 iterations 조합으로 탄력 있는 긴 머리카락 느낌.

---

## 7. Rope

```ts
constructor(pinX, pinY, length, segments, lineWidth):
  segLen = length / segments
  for i in [0..segments]:
    points.push(Point(pinX, pinY + i×segLen, pinned = i===0))
  for i in [0..segments):
    sticks.push(Stick(points[i], points[i+1]))
```

첫 점만 pinned, 나머지는 세그먼트 길이로 수직으로 초기 배치.

### update

```
for p in points: p.update(halfW, bounds)
for iter in [0..iterations):         // 기본 25회
  for s in sticks: s.resolve()
  for p in points (not pinned): 경계 클램프
  // 핀 포인트 강제 고정 (constraint가 당겨도 원위치 복귀)
  points[0].x = points[0].ox
  points[0].y = points[0].oy
```

iterations 값이 높을수록 stick가 경직되고 끈이 늘어나지 않음.

---

## 8. 렌더링

### Default (catmull-like bezier)

연속 점들을 Catmull-Rom 유도 bezier로 부드럽게 그림. 컨트롤 포인트:

```
cp1 = p1 + (p2 - p0) / 6
cp2 = p2 - (p3 - p1) / 6
bezierCurveTo(cp1, cp2, p2)
```

`p0 = points[max(0, i-1)]`, `p3 = points[min(N-1, i+2)]`.

### Linear gradient (끈 방향)

```
start = pin (pts[0])
end   = tail (pts[N-1])
stops:
  0.00 → #1a0800   (암갈색)
  0.25 → #7a2800
  0.55 → #d06010
  0.80 → #f0a030
  1.00 → #ffe8a0   (밝은 금발)
```

lineCap/Join = round, lineWidth = `Rope.lineWidth` (각 끈마다 7~12px).

### Blueprint mode (debug)

GUI `blueprint` 토글 시 sticks 파란선 + 점 (pinned=빨강, 일반=파랑)만 그림. 내부 구조 확인용.

---

## 9. 입력

### 포인터 상태

```
mouse = { x, y, px, py, down }
setPointer(cx, cy): px=x, py=y, [x,y] = canvasCoords
beginPointer(cx, cy): down=true, (px, py, x, y) = canvasCoords
endPointer():         down=false
```

### applySweep

```
if !mouse.down: return
dvx = x - px
dvy = y - py
for each rope: rope.applySweep(x, y, dvx, dvy)
```

### 이벤트

- `mousedown/up/move`, `touchstart/move/end` 모두 지원. 터치는 `preventDefault`.

---

## 10. 렌더 루프

```
fillRect('rgba(10,10,10,0.88)', W, H)   // 잔상 트레일
for rope in ropes: rope.update(bounds)
for rope reverse: rope.draw(ctx)
rAF
```

불투명도 0.88의 검정 fill을 프레임마다 깔아 짧은 잔상을 남긴다.

---

## 11. GUI (lil-gui)

기본 closed. `widget-height: 20px`.

### grid

| 항목 | 범위 | 기본 | 재초기화 |
|------|------|------|---------|
| columns | 1..40 | 22 | ✓ |
| rows | 1..12 | 5 | ✓ |
| rope length | 0.05..0.8 | 0.2 | ✓ (H 비율) |

### rope

| 항목 | 범위 | 기본 |
|------|------|------|
| gravity | 0..5 | 1.2 |
| damping | 0.9..1.0 | 0.93 |
| stiffness | 0.1..1.0 | 0.3 |
| iterations | 1..80 | 25 |

### 기타

| 항목 | 기본 | 설명 |
|------|------|------|
| uniform | false | 모든 끈이 같은 length/segs/lw |
| blueprint | false | 디버그 wireframe 뷰 |

---

## 12. 상수

| 이름 | 값 |
|------|----|
| `gravity` | 1.2 |
| `damping` | 0.93 |
| `iterations` | 25 |
| `sweepRadius` | 90 px |
| `sweepStrength` | 1.4 |
| `stiffness` | 0.3 |
| `cols × rows` | 22 × 5 |
| `ropeLength` | 0.2 (H 비율) |
