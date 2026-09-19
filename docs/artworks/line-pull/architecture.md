# Line Pull 아키텍처

Line Pull은 매 프레임 가로선의 좌표를 다시 계산해 포인터로 선을 당기고 틈을 여는 장면을 만든다. 천을 물리적으로 시뮬레이션하지는 않는다.

## 용어

| 용어 | 뜻 | 코드 |
| --- | --- | --- |
| 기준선 | 아무것도 당기지 않았을 때의 선 | `restingLineY()` |
| 선택선 | 포인터가 잡은 선 | `selectedLineIndex`, `selectedLineY` |
| 당김점 | 포인터를 따라 움직이며 선이 가장 많이 꺾이는 점 | `pullX`, `pullY` |
| 전체 간격 벌림 | 당길수록 모든 기준선의 간격을 넓히는 변형 | `spreadSurfacePoint()` |
| 당김 경계 | 선택선이 당김점 쪽으로 꺾인 가장자리 | `bentLinePoint()` |
| 붙는 경계 | 선택선의 반대쪽 가장자리가 이웃선 쪽으로 이동한 경계 | `openingEdgePoint()` |
| 열린 틈 | 당김 경계와 붙는 경계 사이의 영역 | `polygon`, `clipPath` |

## 장면이 만들어지는 순서

### 1. 선을 고른다

선 가까이에서 누르면 `lineAt()`이 다음 값이 가장 작은 선을 고른다.

```text
distance_i = abs(pointerY - restingY(pointerX, rowY_i))
hitRadius  = max(8, lineWidth * 2)
selected   = argmin_i(distance_i)

accept selected if distance_selected <= hitRadius
```

줄 사이에서 누른 채 움직이면 `firstCrossing()`이 포인터 경로와 가장 먼저 만나는 선을 고른다.

```text
P(t) = previousPoint + t * (currentPoint - previousPoint)

crossing = min(t),  0 < t <= 1
where P_y(t) = restingY(P_x(t), rowY_i)
```

### 2. 당김점을 움직인다

```text
pullX      = pointerX
targetY    = pointerY - pointerOffsetY
follow     = 1 - exp(-followSpeed * dt)
pullY     += (targetY - pullY) * follow
```

포인터를 놓으면 다음 스프링 계산으로 기준선까지 돌아간다.

```text
restY      = restingY(pullX, selectedLineY)
velocityY += ((restY - pullY) * returnStiffness
              - velocityY * returnDamping) * dt
pullY     += velocityY * dt
```

### 3. 선을 그릴 x좌표를 만든다

![선택선을 당겼을 때 틈과 주변 선이 만들어지는 과정](../../assets/line-pull-opening.svg)

```text
count = max(24, ceil(width / 28))
xs    = [i * width / count | i = 0 ... count]

if pull exists: xs += [pullX]
xs = sort(unique(xs))
```

각 x좌표에서 y좌표를 구한 뒤 점들을 왼쪽부터 잇는다. 같은 `xs`를 선, 열린 틈, 터치 판정과 문구 배치에 함께 쓴다.

### 4. 각 x좌표의 y좌표를 계산한다

#### 4.1 기준 곡선: `restingLineY()`

```text
nx = (x - width / 2) / max(width / 2, 1)

restingY(x, rowY)
  = height / 2
  + (rowY - height / 2) * (1 - surfaceCurvature * nx²)
```

#### 4.2 전체 간격 벌림: `spreadSurfacePoint()`

```text
pullDistance = pullY - restingY(pullX, selectedLineY)
direction    = sign(pullDistance)
strength     = 1 - exp(-abs(pullDistance) / (lineGap * 1.35))

pivotY = restingY(x, selectedLineY - direction * lineGap * 2)
scale  = 1 + spreadStrength * strength

spreadX(x)
  = pullX + (x - pullX) * (1 + horizontalSpread * strength)

spreadY(x, rowY)
  = pivotY + (restingY(x, rowY) - pivotY) * scale
```

#### 4.3 V자 꺾임: `bentLinePoint()`

```text
selectedY = spreadY(pullX, selectedLineY)
lineY     = spreadY(pullX, rowY)
distance  = max(0, direction * (pullY - selectedY))
lineDist  = direction * (lineY - selectedY)

z = distance - lineDist
r = min(lineGap * 0.16, distance * 0.25)

softPositive(z, r) =
  max(0, z)          if r <= 0 or z >= r
  0                  if z <= -r
  (z + r)² / (4r)    otherwise

bend = (1 - pullPointSpacing) * softPositive(z, r)

horizontalBend =
  1                                 if x <= pullX and pullX <= 0
  x / pullX                         if x <= pullX and pullX > 0
  1                                 if x > pullX and pullX >= width
  (width - x) / (width - pullX)     otherwise

bentY(x, rowY)
  = spreadY(x, rowY)
  + direction * (pullPointSpacing * distance + bend * horizontalBend)
```

`horizontalBend`는 당김점에서 1이고 좌우 끝에서 0이다. `pullPointSpacing`은 당김점 부근에서도 선 사이에 남길 간격이다.

### 5. 두 경계로 열린 틈을 만든다

당김 경계는 `bentY`를 사용한다. 붙는 경계는 이웃선 쪽으로 이동한다.

```text
travel    = abs(pullDistance)
selectedY = spreadY(x, selectedLineY)
neighborY = spreadY(x, selectedLineY - direction * lineGap)

progress = 1 - exp(-travel / (lineGap * openingEdgeEase))
creep    = lineGap * openingEdgeCreep * ln(1 + travel / lineGap)

slope      = d(neighborY) / d(spreadX)
separation = lineWidth * sqrt(1 + slope²)

openingY
  = selectedY
  + (neighborY + direction * separation - selectedY) * progress
  - direction * creep
```

`direction = 1`이면 위쪽 이웃선, `direction = -1`이면 아래쪽 이웃선을 사용한다.

#### 5.1 틈을 `clipPath`로 보여 준다

```text
attachedBoundary = xs.map(x => openingEdgePoint(x))
pulledBoundary   = xs.map(x => bentLinePoint(selectedLineY, x))

polygon  = attachedBoundary + reverse(pulledBoundary)
clipPath = pointsPath(polygon, close = true)
```

숨겨진 배경과 문구에는 이 `clipPath`를 적용한다. 화면에 그린 두 경계와 `clipPath`가 같은 점을 사용하므로 선과 틈이 어긋나지 않는다.

#### 5.2 같은 도형으로 터치 영역을 계산한다

`clipPath`는 화면만 자른다. 터치 판정은 `pointInOpening()`이 같은 `polygon`으로 계산한다. 포인터 `P`와 각 경계 선분 `AB`의 거리는 다음과 같다.

```text
t        = clamp(dot(P - A, B - A) / |B - A|², 0, 1)
closest  = A + t * (B - A)
edgeDist = |P - closest|

edgeDist <= lineWidth + 1
  => outside
```

경계에서 떨어진 점은 가로선과 도형 경계의 교차 횟수로 판정한다.

```text
crossesY = (Ay > Py) != (By > Py)
xCross   = Ax + (Bx - Ax) * (Py - Ay) / (By - Ay)

if crossesY and Px < xCross:
  inside = !inside

inside = true
  => 열린 틈 안쪽
```

`pickLayer()`는 이 판정을 바깥 틈부터 반복해 포인터가 들어 있는 가장 안쪽 선 겹을 고른다. 그다음 `lineAt()`과 `firstCrossing()`이 해당 겹의 선을 선택한다.

## 출력과 검증

한 프레임의 출력은 모든 선의 새 SVG 경로와 열린 틈의 경계다. 현재 방식은 물리 시뮬레이션이 아니라 작품의 모양에 맞춘 좌표 계산이다.

`geometry.test.ts`는 선과 틈의 좌표를, `frame-loop.test.ts`는 프레임 갱신과 정지를 검증한다. 전체 검증은 다음 명령으로 실행한다.

```sh
pnpm test pages/line-pull
pnpm typecheck
```

구체적인 동작값과 예외 처리는 [인터랙션 스펙](../../../pages/line-pull/spec.md)에 따로 둔다.
