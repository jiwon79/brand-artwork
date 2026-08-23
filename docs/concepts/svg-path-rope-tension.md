# SVG Path Rope Tension

SVG path를 일정 간격의 weighted graph로 바꾸고 anchor부터 선을 따라간 거리에 따라 당김을 감쇠하면, 선의 연결 구조를 유지하는 rope-like 변형을 만들 수 있다.

## 1. 그림으로 먼저 보기

![SVG contour를 rope tension graph로 바꾸는 과정](../assets/svg-path-rope-tension.svg)

왼쪽은 화면에 보이는 contour를 sample로 바꾼 결과다. 가운데의 virtual joint는 떨어진 contour 사이로 장력을 전달해야 할 때 graph에만 추가하는 선택적 연결이다. 오른쪽은 터치 anchor에서 graph를 따라간 거리가 멀수록 당김이 작아지는 결과를 보여 준다.

## 2. 해결하려는 문제

선으로 이루어진 형상을 한 지점에서 당길 때 화면상의 직선거리만 사용하면 선의 실제 연결 관계를 반영하지 못한다.

- 각 sample을 독립적으로 이동하면 이웃점의 이동량 차이 때문에 선이 톱니처럼 울퉁불퉁해질 수 있다.
- 모든 sample을 같은 비율로 이동하면 형상 전체가 하나의 이미지처럼 미끄러진다.
- 화면에서는 가까워도 서로 다른 contour에 속한 점은 같은 줄을 따라 연결된 점이 아닐 수 있다.
- 반대로 화면에서는 떨어진 contour라도 하나의 구조로 움직여야 한다면 별도의 연결 규칙이 필요하다.

따라서 필요한 값은 sample과 anchor 사이의 화면상 직선거리가 아니라, **선의 연결 구조 안에서 anchor부터 sample까지 이동하는 최단 누적 거리**다.

## 3. 입력과 출력

모든 위치와 길이는 같은 2D 좌표 공간을 사용해야 한다. SVG local 좌표에서 계산해도 되고 design 좌표로 먼저 변환해도 되지만, `P_i`, edge 길이, `R`과 당김 벡터의 단위를 섞으면 안 된다.

| 기호 | 공간과 단위 | 의미 |
| --- | --- | --- |
| `P_i` | 선택한 2D 좌표 | 일정 간격으로 표본화한 `i`번째 sample 위치 |
| `C_i` | 정수 index | `P_i`가 속한 contour의 식별자 |
| `E(i, j)` | `P_i`와 같은 길이 단위 | 이웃 sample `i`, `j`를 잇는 graph edge 길이 |
| `A` | sample index | 입력 위치에서 가장 가까운 anchor sample |
| `g_i` | `E`와 같은 길이 단위 | graph 안에서 `A`부터 `P_i`까지의 최단 누적 거리 |
| `R` | `E`와 같은 길이 단위, `R > 0` | 장력이 강하게 전달되는 유효 reach |
| `L_i` | 0–1 | graph distance로 계산한 local tension |
| `T_i` | 0–1 | `i`번째 sample에 선택적으로 남길 최소 전달분 |
| `D_i` | 0–1 | local tension과 최소 전달분을 합친 목표 장력 |
| `elapsed` | 초 | 당김 반응을 시작한 뒤 지난 시간 |
| `responseLag_i` | 초, `responseLag_i > 0` | `i`번째 sample이 목표 장력에 접근하는 시간 규모 |
| `S_i` | 0–1 | 현재 시점에 목표 장력까지 도달한 비율 |
| `I_i` | 0–1 | 위치 변형에 사용하는 최종 influence |
| `delta` | `P_i`와 같은 2D 좌표 단위 | anchor를 끌어당긴 방향과 거리를 나타내는 벡터 |
| `P'_i` | `P_i`와 같은 2D 좌표 | 변형된 sample 위치 |

출력은 sample마다 계산된 `I_i`와 새 위치 `P'_i`다. 렌더러는 같은 contour의 `P'_i`를 순서대로 연결해 변형된 선을 그린다.

## 4. 직관적인 계산 과정

### 4.1 path를 sample로 바꾸기

각 contour를 일정 길이 간격으로 읽어 sample을 만든다. SVG의 `M` 명령으로 시작하는 subpath는 서로 다른 contour로 유지한다. 그래야 렌더러가 원래 떨어져 있던 contour 사이에 보이지 않던 직선을 추가하지 않는다.

간격이 작으면 곡선을 더 정확히 표현하지만 sample 수와 graph 계산 비용이 늘어난다. 간격이 크면 비용은 줄지만 곡률이 큰 구간에서 외곽선이 각져 보일 수 있다.

### 4.2 graph edge 만들기

같은 contour 안에서 연속한 sample을 양방향 edge로 연결하고, 두 sample 사이의 길이를 edge weight로 사용한다. 이 단계만 수행하면 서로 다른 contour는 독립된 graph component로 남는다.

여러 contour가 하나의 구조처럼 장력을 주고받아야 한다면 virtual joint를 graph에 추가할 수 있다. 어떤 contour를 연결할지는 형상의 의미에 따라 결정해야 한다.

- 서로 독립적으로 움직여야 하면 joint를 추가하지 않는다.
- 구조를 알고 있다면 미리 지정한 semantic joint를 사용한다.
- 구조 정보가 없다면 가까운 endpoint를 연결하는 규칙을 근사로 사용할 수 있다.

virtual joint는 장력 계산용 graph에만 존재한다. 실제 stroke에 edge를 추가하지 않으므로 화면의 의도적인 빈틈은 유지된다.

### 4.3 anchor에서 누적 거리 구하기

입력 위치에 가장 가까운 sample을 anchor `A`로 고른다. 그다음 non-negative edge weight를 사용하는 최단 경로 탐색으로 `A`부터 모든 sample까지의 누적 거리 `g_i`를 구한다.

- edge를 따라 가까운 sample은 `g_i`가 작다.
- 많은 edge를 지나야 하는 sample은 `g_i`가 크다.
- anchor와 연결되지 않은 component의 sample은 도달할 수 없으므로 `g_i = infinity`다.

### 4.4 거리를 장력으로 바꾸기

- `g_i = 0`: anchor이므로 local tension은 1이다.
- `g_i = R`: local tension은 약 0.37이다.
- `g_i = 2R`: local tension은 약 0.14다.
- `R`이 커짐: 장력이 더 먼 부분까지 강하게 전달된다.
- `R`이 작아짐: 변형이 anchor 주변에 국소적으로 모인다.

먼 sample이 시각적으로 완전히 멈추는 것을 피해야 한다면 최소 전달분 `T_i`를 선택적으로 섞는다. 모든 sample에 같은 값을 사용할 수도 있고, 거리나 상호작용 진행도에 따라 sample마다 다르게 정할 수도 있다.

## 5. 실제 수식

anchor에서 sample `i`까지의 graph distance는 경로를 이루는 edge weight 합 중 가장 작은 값이다.

```text
g_i = min over paths A→i (sum of E along the path)
```

graph distance를 지수 감쇠로 변환한다.

```text
L_i = exp(-g_i / R)
```

필요한 경우 최소 전달분과 시간 반응을 차례로 적용한다.

```text
D_i = L_i + (1 - L_i) × T_i
S_i = 1 - exp(-elapsed / responseLag_i)
I_i = S_i × D_i
P'_i = P_i + delta × I_i
```

`T_i = 0`이면 `D_i = L_i`이므로 거리 감쇠를 그대로 사용한다. `T_i`가 커질수록 먼 sample의 목표 장력이 커지고, `T_i = 1`이면 거리에 관계없이 `D_i = 1`이 된다. 따라서 `T_i`는 필수 항이 아니라 먼 구간에 최소 움직임이 필요한 표현에서만 사용하는 보정이다.

`responseLag_i`를 모든 sample에 같은 값으로 두면 전체가 비슷한 속도로 반응한다. graph distance가 먼 sample일수록 큰 값을 주면 장력이 선을 따라 늦게 전달되는 인상을 만들 수 있다.

## 6. 왜 이 수식인가

`exp(-g_i / R)`는 anchor에서 정확히 1이고 거리가 늘어날수록 연속적으로 감소한다. 특정 거리에서 갑자기 0이 되는 hard cutoff가 없으므로 이웃 sample의 이동량도 급격히 끊기지 않는다. `R`은 거리의 단위를 없애는 scale이며, `g_i / R`이 같으면 원본 path의 크기가 달라도 같은 비율의 감쇠를 얻는다.

최소 전달분 식은 다음과 같이 다시 쓸 수 있다.

```text
D_i = (1 - T_i) × L_i + T_i × 1
```

즉 `D_i`는 거리 장력 `L_i`와 최대 장력 1 사이를 `T_i`만큼 섞은 값이다. anchor 근처는 `L_i ≈ 1`이므로 `T_i`의 영향이 거의 없고, 먼 지점은 `L_i ≈ 0`이므로 `D_i ≈ T_i`가 된다. 가까운 구간의 강한 당김을 유지하면서 먼 구간에만 하한을 남기는 이유가 여기에 있다.

시간 반응 `1 - exp(-elapsed / responseLag_i)`도 시작 시점에는 0이고 시간이 흐르면 1에 가까워진다. 작은 `responseLag_i`는 빠른 반응을, 큰 값은 느린 반응을 만든다. 거리 감쇠와 시간 반응을 곱하면 각 sample이 목표 장력을 얼마나 받을지와 그 장력에 얼마나 도달했는지를 분리해서 조절할 수 있다.

이 계산은 실제 줄의 질량, 관성, 충돌을 적분한 물리 시뮬레이션이 아니다. 공간과 시간에 대해 연속적인 rope-like 반응을 만드는 경험적 변형 모델이다.

## 7. 일반 pseudocode

```text
samples = sampleEachContourAtRegularIntervals(svgPath)
graph = connectConsecutiveSamplesWithinEachContour(samples)

for each chosen virtual joint (i, j):
  graph.addUndirectedEdge(i, j, distance(P_i, P_j))

A = nearestSample(inputPosition)
graphDistances = shortestPathDistances(graph, A)

for each sample i:
  if graphDistances[i] is infinity:
    influence[i] = 0
    continue

  localTension = exp(-graphDistances[i] / reach)
  transmissionFloor = chooseTransmissionFloor(i)
  distanceTension = localTension
    + (1 - localTension) * transmissionFloor
  timeResponse = 1 - exp(-elapsed / responseLag(i))
  influence[i] = timeResponse * distanceTension
  deformedPosition[i] = position[i] + pullVector * influence[i]
```

sample과 graph는 path가 바뀔 때만 다시 만들면 된다. anchor와 graph distance는 입력을 새로 시작할 때 계산해 캐시할 수 있다. 입력 목표점이 움직이는 동안에는 같은 anchor와 distance를 유지하고 `pullVector`만 바꾸면 처음 잡은 위치를 놓지 않고 끌어가는 동작이 된다.

## 8. 일반적인 사용

이 방법은 polyline 또는 path의 연결 관계를 유지하면서 국소적인 영향을 퍼뜨려야 할 때 사용할 수 있다.

- 선형 로고와 윤곽선의 인터랙티브 변형
- 필기 stroke를 잡아당기거나 느슨하게 흔드는 효과
- 케이블, 덩굴과 리본의 간단한 편집 반응
- node-edge 구조를 가진 2D 그래프의 영향 범위 계산

virtual joint, 최소 전달분과 거리별 response lag는 각각 독립적인 선택이다. 하나의 연속 contour만 다룬다면 virtual joint가 필요 없고, 먼 부분이 멈춰도 되는 표현이라면 `T_i = 0`을 사용할 수 있다.

## 9. 특수 상황과 한계

- 가까운 endpoint를 잇는 virtual joint는 형상의 의미나 topology를 이해하지 못한다. 잘못된 contour가 연결될 수 있으므로 가능한 경우 semantic joint가 더 안정적이다.
- 일정 간격 표본화는 곡률이 큰 구간을 충분히 표현하지 못할 수 있다. adaptive subdivision이 대안이다.
- 모든 sample 사이에서 최근접 연결을 찾는 단순 탐색은 sample 수가 늘면 비용이 빠르게 증가한다. 큰 asset에는 spatial index가 필요하다.
- self-intersection을 graph joint로 추가하지 않으면 화면상 교차점 사이에는 장력이 전달되지 않는다. 교차점을 연결하려면 별도의 교차 검출이 필요하다.
- 연결되지 않은 component에 `T_i`를 적용하면 graph 관계와 무관하게 움직임이 생긴다. 독립 component에는 `T_i = 0`을 사용하거나 component별 anchor를 선택해야 한다.
- 실제 줄의 overshoot, 관성, 길이 제약과 충돌이 필요하면 mass-spring 또는 position-based dynamics가 더 적합하다.

## 10. 구현 참고

이 원리를 적용한 실제 코드와 작품 전용 virtual joint, 전달 장력, slack 선택은 [Body Echo Architecture](../artworks/body-echo/architecture.md)에서 설명한다.

## 11. 핵심 요약

SVG contour → 일정 간격 sample → contour 내부 edge와 선택적 virtual joint → anchor 기준 graph distance → 거리 장력과 선택적 시간·최소 전달 보정 → sample별 위치 변형.
