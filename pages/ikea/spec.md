# IKEA Brand Artwork — Furniture Particle Cloud 스펙

## 1. 파일 구성

```
ikea/
  index.html   — HUD, 가구 피커, gizmo 캔버스
  script.js    — Three.js 기반 전체 로직
```

`/common/touch-cursor.ts` 추가 로드.

의존성: `three` (ES 모듈).

---

## 2. 컨셉

IKEA의 상징적 가구 3종 (POÄNG, BILLY, LACK) 을 3D 포인트 클라우드로 표현한다. 각 가구는 절차적으로 생성된 파티클 분포로 그려지며, 사용자가 가구를 선택하면 5000개 파티클이 새로운 형태로 보간된다. IKEA 블루(`#0058A3`) 배경 위에 흰색/노랑/하늘색 파티클이 떠다닌다.

- **마우스 호버**: 커서가 가리킨 지점 근처 파티클이 원래 무작위 위치로 흩어졌다가 다시 뭉친다.
- **Gizmo 드래그**: 블렌더 스타일 축 기즈모로 수동 회전 / 축 클릭 시 스냅.
- **가구 피커**: 좌측 HUD에서 가구 교체 → targets 보간.

---

## 3. 씬 & 카메라

```
renderer: WebGLRenderer({ antialias: true, alpha: true })
  setPixelRatio(min(DPR, 2))
  clearColor: 0x0058A3 (IKEA Blue)
camera: PerspectiveCamera(fov=50, near=0.01, far=100)
  position: (0, 0.6, 3.2)
  lookAt:  (0, 0.4, 0)
```

---

## 4. 가구 지오메트리 빌더

### 공통 헬퍼

**`sampleTube(curvePts, radius, samples)`**: CatmullRom 곡선을 따라 16각형 링을 samples+1회 펼쳐 튜브 외피를 점으로 샘플링.

```
for i in [0..N]:
  pt   = curve.getPoint(t)
  tang = curve.getTangent(t)
  right = tang × (0,1,0)
  up    = right × tang
  for r in [0..16]:
    angle = r/16 × 2π
    offset = right·cos + up·sin (× radius)
    push(pt + offset)
```

**`sampleBox(cx, cy, cz, w, h, d, count)`**: 박스의 6면 중 랜덤 하나에서 (u, v) 랜덤 표본 → 해당 면 위 점.

### POÄNG (1992)

- **Arch (bentwood frame)**: 11포인트 CatmullRom으로 "앞발 → 좌석 → 암레스트 → 등받이" 곡선. x=±0.30으로 좌우 2개, radius 0.022, 150 samples.
- **Rear foot**: 좌우 각 4포인트 곡선, radius 0.020, 60 samples.
- **Cross bars**: 4개 수평 바 (front low, seat level, back mid, back top), radius 0.018, 40 samples.
- **Armrests**: 좌우 4포인트 곡선, radius 0.025, 50 samples.
- **Seat cushion**: 6면 박스 샘플링 1200점 (x-tilt, u×0.08 Z shear).
- **Back cushion**: 중심 (0, 0.88, -0.20) 6면 박스 샘플링 1400점.

### BILLY (1979)

책장: 양 사이드 패널 × 2 (900pt), 상/하 수평 패널 × 2 (420pt), 중간 선반 4개 (320pt each), 뒷판 (700pt). `W×H×D = 0.80×2.00×0.28`, `thick = 0.022`.

### LACK (1979)

사이드 테이블: 상판 2200pt + 코너 4개 다리 680pt each. `W×D×H = 0.70×0.70×0.60`, `thick=0.04`, `legSide=0.05`.

---

## 5. 파티클 정규화

```js
normalizeToCount(points, N):
  center = mean(points)
  pts    = points - center           // 원점 중심으로 정렬
  for i in [0..N):
    src = pts[floor(i/N × pts.length)]
    out[i*3..+3] = src.xyz
```

각 가구는 `PARTICLE_COUNT = 5000`으로 정규화된 `Float32Array(N×3)` `targets` 버퍼를 보유.

---

## 6. 파티클 초기 상태

```
positions  = Float32Array(N×3)  // 현재 렌더 위치
targets    = Float32Array(N×3)  // 현재 가구의 목표
randoms    = Float32Array(N×3)  // 각 파티클의 무작위 흩뿌림 위치 (±2.5)
velocities = Float32Array(N×3)
currentPos = Float32Array(positions 사본)
phases     = i × 2.399            // 황금비 기반 고유 위상
particleForm = 1.0                // 1=뭉침, 0=흩어짐
```

`randoms[i]`는 처음엔 초기 위치로, 이후엔 scatter 상태의 목적지로 재사용.

### 색상 팔레트

5개 색 중 랜덤 선택 (가중치: 흰색 3 / 노랑 1 / 라이트블루 1):

| 색상 | HEX |
|------|-----|
| 흰색 | `#FFFFFF` × 3 |
| 노랑 | `#FFDA1A` |
| 라이트블루 | `#ADD8FF` |

크기: `random × 0.06 + 0.02`.

---

## 7. 셰이더 (ShaderMaterial)

### vertex

```glsl
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (320.0 / -mvPos.z);
  gl_Position = projectionMatrix * mvPos;
  vAlpha = 0.8 + 0.2 * (aSize / 0.08);
}
```

### fragment

```glsl
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float alpha = smoothstep(0.5, 0.1, d) * vAlpha;
  gl_FragColor = vec4(vColor, alpha);
}
```

`transparent: true`, `depthWrite: false`, `blending: AdditiveBlending`.

---

## 8. 회전 (자동/수동)

```
rotY = 0.3, rotX = 0.15
autoRotate 기본 true → rotY += 0.005/frame
particles.rotation = (rotX, rotY, 0)
```

포인트 클라우드 `position.y = 0.14`로 올려 HUD 라벨과 겹침 방지.

---

## 9. Gizmo (블렌더 스타일)

상단 우측 74×74 캔버스. 매 프레임 `drawGizmo()` 호출.

### 축 정의

| 축 | 양 | 음 |
|----|-----|-----|
| X | `#ff4d4d` | `#7a1a1a` |
| Y | `#7aff4d` | `#2a6010` |
| Z | `#4da8ff` | `#1a3e7a` |

### 렌더링

1. 현재 `(rotX, rotY)` 로 rotation matrix 생성.
2. 양/음 6개 축 방향을 변환 → 스크린 좌표 `(GZ + vx×26, GZ - vy×26)`, depth z 저장.
3. depth 오름차순 정렬 (뒤 → 앞).
4. 원형 배경 (`rgba(0,20,50,0.45)`) + 점선 가이드 십자.
5. 각 축 라인 (음축 dashed, alpha `0.35 ~ 1.0` depth에 매핑) + 끝점 원 (양축 `r=5`, 음축 `r=3`) + 양축에만 shadow blur 8 + 하이라이트.
6. 양축 끝점에 6px bold 라벨.

### 인터랙션

- **pointerdown**: `gizmoDragging=true`, auto-rotate 중지, pointer capture.
- **pointermove**: `rotY += dx × 0.012`, `rotX += dy × 0.012`, rotX 클램프 `±π/2`.
- **pointerup/cancel**: drag 해제, auto-rotate 재개.
- **click**: 양축/음축 dot 히트 테스트 (`hypot < 5|7`) → 해당 축으로 스냅 회전. 스냅 타겟:

| label | rotX, rotY |
|-------|-----------|
| X / -X  | (0, ∓π/2) |
| Y / -Y  | (∓π/2, 0) |
| Z / -Z  | (0, 0) / (0, π) |

스냅 후 auto-rotate는 중단 상태 유지.

---

## 10. 호버 scatter

```
SCATTER_RADIUS = 0.5    (local space)
SPEED_SCATTER  = 0.07   (form 감소량)
SPEED_REFORM   = 0.025  (form 복귀량)
DAMP           = 0.82   (velocity 감쇠)
```

### hover 좌표 변환

`raycaster` + `z=0 plane` intersect로 world 좌표 얻은 뒤 `particles.worldToLocal(localHover)`로 회전 보정된 local 공간 좌표 계산.

### 파티클 업데이트 (매 프레임 N=5000)

```
d      = dist(targets[i], localHover)
inRange = isHovering && d < SCATTER_RADIUS
if inRange:
  particleForm[i] -= SPEED_SCATTER × (1 - d/SCATTER_RADIUS)
else:
  particleForm[i] += SPEED_REFORM

f = particleForm[i]                       // 0..1
floatAmp = 0.018 × f
floatX/Y/Z = sin(time × (0.7~0.9) + phase × k) × floatAmp

target_lerp = (targets[i] + float) × f + randoms[i] × (1 - f)

spring = 0.04 + f × 0.04
velocities[i] = velocities[i] × DAMP + (target_lerp - currentPos[i]) × spring
currentPos[i] += velocities[i]
pos[i] = currentPos[i]
```

`f=1` (뭉침)일 때만 부유 흔들림 적용. `f=0` (완전 흩어짐)이면 random 점으로 수렴.

---

## 11. 가구 스위칭

좌측 세로 피커 `#furniture-picker`:

```
● POÄNG  (1992)
● BILLY  (1979)
● LACK   (1979)
```

- 기본: 첫 번째 active (`#FFDA1A` 색).
- 클릭 시: `targets.set(FURNITURE[idx].targets)` 만 교체 → 기존 `particleForm`/`velocities` 유지하여 부드럽게 보간.
- 활성 스타일: 색 노랑 + dot scale 1.5.

---

## 12. 렌더 루프

```
animate:
  time += 0.016
  uTime = time
  if autoRotate: rotY += 0.005
  particles.rotation = (rotX, rotY, 0)
  drawGizmo()
  localHover = isHovering ? particles.worldToLocal(hoverPos3D) : ...
  for i in N: 업데이트 (위 §10)
  geometry.position.needsUpdate = true
  renderer.render(scene, camera)
```

---

## 13. 리사이즈

```
renderer.setSize(w, h)
camera.aspect = w/h
camera.updateProjectionMatrix()
```

---

## 14. 색상 & 폰트

- **배경**: `#0058A3` (IKEA Blue)
- **HUD 텍스트**: `#FFFFFF`
- **액센트**: `#FFDA1A` (IKEA Yellow)
- **폰트**: Inter (Google Fonts) 300 / 500
