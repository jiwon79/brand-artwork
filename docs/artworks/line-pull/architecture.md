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

선 가까이에서 누르면 `lineAt()`이 같은 x좌표에 있는 각 선의 기준 높이와 포인터의 y좌표를 비교한다. 가장 가까운 선이 선택 범위 안에 있으면 그 선을 고른다.

```text
distance = abs(pointerY - restingY(pointerX, rowY))
hitRadius = max(8, lineWidth * 2)
```

줄 사이에서 누른 채 움직이면 `firstCrossing()`이 직전 포인터 위치와 현재 위치를 잇는 경로를 검사한다. 이 경로와 가장 먼저 만나는 선을 선택하므로 포인터가 빠르게 움직여도 중간의 선을 놓치지 않는다.

### 2. 당김점을 움직인다

선을 고르면 선택선의 높이와 당김점을 저장한다. `pullX`는 포인터의 x좌표를 바로 따라가고, `pullY`는 목표 y좌표를 조금 늦게 따라간다.

```text
follow = 1 - exp(-followSpeed * dt)
pullY += (targetY - pullY) * follow
```

포인터를 놓으면 선택선의 기준 높이를 목표로 스프링 힘과 감쇠를 적용한다. 움직임이 남아 있을 때만 다음 프레임을 계산한다.

### 3. 선을 그릴 x좌표를 만든다

![선택선을 당겼을 때 틈과 주변 선이 만들어지는 과정](../../assets/line-pull-opening.svg)

`sampleLineXs()`는 화면 왼쪽부터 오른쪽까지 선 위에 찍을 x좌표를 만든다. 화면 폭을 약 28px 간격으로 나누되 최소 24칸을 확보하고, 당김점의 x좌표도 추가한다.

```text
count = max(24, ceil(width / 28))
xs = [0, width / count, ... , width, pullX]
```

각 x좌표에서 y좌표를 구한 뒤 점들을 왼쪽부터 잇는다. 왼쪽 끝, 당김점, 오른쪽 끝만 잇지 않는 이유는 기준선 자체가 곡선이기 때문이다. 같은 점 목록을 선, 열린 틈, 터치 판정과 문구 배치에 함께 써야 화면에 보이는 모양과 판정 영역도 일치한다.

### 4. 각 x좌표의 y좌표를 계산한다

#### 4.1 기준 곡선: `restingLineY()`

아무것도 당기지 않았을 때도 선은 완전한 직선이 아니다. 화면 가운데에서는 원래 높이를 유지하고, 양끝으로 갈수록 화면의 세로 중앙 쪽으로 휜다.

```text
nx = (x - width / 2) / max(width / 2, 1)

restingY
  = height / 2
  + (rowY - height / 2) * (1 - surfaceCurvature * nx²)
```

#### 4.2 전체 간격 벌림: `spreadSurfacePoint()`

선을 당기면 선택선만 움직이는 것이 아니라 주변 선의 간격도 함께 넓어진다. 선택선에서 당기는 방향의 반대쪽에 기준을 잡고, 각 선이 그 기준에서 떨어진 거리를 같은 비율로 늘린다. x좌표도 당김점을 중심으로 조금 벌어진다.

```text
strength = 1 - exp(-abs(pullDistance) / (lineGap * 1.35))

spreadY
  = pivotY
  + (restingY - pivotY) * (1 + spreadStrength * strength)
```

`restingY`를 바탕으로 거리를 늘리기 때문에 확대된 장면도 직선이 되지 않고 원래의 완만한 곡선을 유지한다. 이 계산은 선택선이 이웃선에 붙는 동작과는 별개다.

#### 4.3 V자 꺾임: `bentLinePoint()`

`bentLinePoint()`는 당김점을 꼭짓점으로 하는 V자 모양을 더한다. 가로로는 당김점에서 영향이 가장 크고 화면 양끝으로 갈수록 작아진다. 세로로는 선택선과 가까운 선부터 차례로 당김의 영향을 받는다.

```text
horizontalBend =
  x / pullX                         if x <= pullX
  (width - x) / (width - pullX)     if x > pullX

bend = (1 - pullPointSpacing)
       * softPositive(distance - distanceFromSelectedLine)

bentY
  = spreadY
  + direction * (pullPointSpacing * distance
                 + bend * horizontalBend)
```

`softPositive()`는 포인터가 다음 선을 지나는 순간 꺾임이 갑자기 생기지 않도록 경계를 완만하게 잇는다. `pullPointSpacing`은 여러 선이 당김점 한 곳에 겹치지 않도록 작은 간격을 남긴다.

### 5. 두 경계로 열린 틈을 만든다

선택선은 두 경계로 나뉜다. 당김 경계는 앞에서 구한 V자 모양을 따른다. 붙는 경계는 아래로 당길 때 위쪽 이웃선을, 위로 당길 때 아래쪽 이웃선을 향해 이동한다.

```text
progress = 1 - exp(-travel / (lineGap * openingEdgeEase))

openingY
  = lerp(selectedY, neighborY + direction * separation, progress)
  - direction * creep
```

`separation`에는 선 두께와 해당 지점의 기울기가 들어간다. 그래서 두 선의 중심이 아니라 화면에 보이는 가장자리가 맞닿는다. `creep`은 맞닿은 뒤에도 경계가 당기는 방향으로 조금 더 움직이게 한다.

#### 5.1 틈을 `clipPath`로 보여 준다

붙는 경계의 점들을 왼쪽에서 오른쪽으로 놓고, 당김 경계의 점들을 반대 순서로 이어 닫힌 도형을 만든다.

```text
polygon = attachedBoundary + reverse(pulledBoundary)
clipPath = pointsPath(polygon, close = true)
```

숨겨진 배경과 문구에는 이 `clipPath`를 적용한다. 화면에 그린 두 경계와 `clipPath`가 같은 점을 사용하므로 선과 틈이 어긋나지 않는다.

#### 5.2 같은 도형으로 터치 영역을 계산한다

`clipPath`는 보이는 범위만 자르고 터치 영역을 만들어 주지는 않는다. 포인터 입력은 화면 전체에서 받은 뒤, `pointInOpening()`이 같은 `polygon`으로 틈 안쪽인지 계산한다.

먼저 포인터와 각 경계 선분 사이의 최단거리를 구한다. 선 두께보다 조금 넓은 범위에 있으면 경계선을 누른 것으로 보고 안쪽 터치에서 제외한다. 경계에서 떨어진 점은 포인터에서 가로로 뻗은 선이 도형 경계를 몇 번 지나는지 센다.

```text
inside = (horizontalRayIntersectionCount % 2) === 1
touchable = inside && minEdgeDistance > lineWidth + 1
```

교차 횟수가 홀수면 안쪽, 짝수면 바깥쪽이다. 열린 틈 안에 또 다른 선 겹이 있으면 `pickLayer()`가 이 판정을 바깥 틈부터 반복한다. 포인터가 들어 있는 가장 안쪽 겹을 찾은 뒤 `lineAt()`과 `firstCrossing()`이 그 안에서 선을 고른다.

## 출력과 검증

한 프레임의 출력은 모든 선의 새 SVG 경로와 열린 틈의 경계다. 현재 방식은 물리 시뮬레이션이 아니라 작품의 모양에 맞춘 좌표 계산이다.

`geometry.test.ts`는 선과 틈의 좌표를, `frame-loop.test.ts`는 프레임 갱신과 정지를 검증한다. 전체 검증은 다음 명령으로 실행한다.

```sh
pnpm test pages/line-pull
pnpm typecheck
```

구체적인 동작값과 예외 처리는 [인터랙션 스펙](../../../pages/line-pull/spec.md)에 따로 둔다.
