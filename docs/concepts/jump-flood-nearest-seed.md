# Jump Flood Nearest-seed Search

Jump Flood Algorithm, 줄여서 JFA는 이미지의 각 픽셀에 가까운 seed의 좌표를 큰 간격에서 작은 간격으로 빠르게 전달하는 GPU 알고리즘이다.

Color Text에서는 액체 실루엣 안의 밝은 중심이 타원보다 활성 글자 모양을 따르게 할 때 사용한다. 작품 전체 흐름은 [`Color Text 아키텍처`](../artworks/color-text/architecture.md)를 참고한다.

## 1. 그림으로 먼저 보기

![Jump Flood의 seed 생성, jump 후보 비교, 최근접 거리 결과](../assets/jump-flood-nearest-seed.svg)

왼쪽에서 유효한 픽셀만 자기 좌표 `C_i`를 저장한다. 가운데의 출력 픽셀 `p`는 jump 간격 `J`만큼 떨어진 3×3 위치가 가진 후보 좌표를 읽는다. jump를 줄여 반복하면 오른쪽처럼 가까운 seed 좌표 `C(p)`를 얻고 실제 거리 `d(p)`를 계산할 수 있다.

## 2. 해결하려는 문제

어떤 픽셀 `p`에서 가장 가까운 활성 글자 픽셀까지의 거리를 알고 싶다고 하자. 모든 seed와 거리를 직접 비교하면 다음 비용이 든다.

```text
출력 픽셀 수 * seed 수
```

활성 글자 픽셀이 수천 개라면 매 frame 모든 출력 픽셀에서 이 목록을 순회하기 어렵다.

JFA는 각 pixel이 seed 목록 전체를 직접 보지 않는다. 대신 가까운 seed를 이미 알고 있는 이웃 pixel에게서 그 **seed 좌표**를 전달받는다. 큰 jump로 멀리 전달한 뒤 작은 jump로 경계를 다듬는다.

## 3. 입력과 출력

| 기호 | 종류와 공간 | 의미 |
| --- | --- | --- |
| `p` | texture UV `[0,1]` | 현재 출력 픽셀 위치 |
| `C_i` | texture UV `[0,1]` | seed `i`의 좌표 |
| `valid` | 0 또는 1 | 현재 pixel이 유효한 seed 좌표를 가지고 있는지 |
| `J` | field pixel | 현재 pass에서 이웃을 읽는 jump 간격 |
| `C(p)` | texture UV `[0,1]` | 현재까지 `p`에서 가장 가깝다고 알려진 seed 좌표 |
| `d(p)` | field pixel | `p`와 `C(p)` 사이의 거리 |

texture에는 거리만 저장하지 않고 seed의 UV 좌표와 유효 여부를 저장한다. 그래야 다음 pass의 이웃도 같은 seed 좌표를 다시 전달할 수 있다.

## 4. Seed pass

입력 마스크가 threshold를 넘는 위치는 자기 UV를 seed 좌표로 저장한다.

```text
mask(p) >= threshold
  -> texture(p) = (p.x, p.y, strength, 1)

그 외
  -> texture(p) = (0, 0, 0, 0)
```

마지막 채널의 `1`이 `valid`다. `strength`를 함께 저장하면 가장 가까운 seed의 위치뿐 아니라 그 seed가 원래 얼마나 강했는지도 마지막 shading에서 사용할 수 있다.

## 5. 한 번의 Jump Flood pass

현재 픽셀 `p`가 확인하는 이웃 방향은 다음 아홉 개다.

```text
(dx, dy), dx와 dy는 각각 -1, 0, 1
```

현재 jump가 `J` field pixel이고 field 크기가 `(W, H)`라면 후보를 읽을 UV는 다음과 같다.

```text
sampleUv = p + (dx * J / W, dy * J / H)
```

각 이웃 texture가 가진 것은 이웃 위치 자체가 아니라 이웃이 알고 있는 seed 좌표 `C_candidate`다. 현재 출력 픽셀에서 그 seed까지의 제곱 거리를 비교한다.

```text
D_candidate = |(C_candidate - p) * fieldSize|²
C_next(p)   = 가장 작은 D_candidate를 가진 유효한 C_candidate
```

제곱근은 모든 후보에 단조롭게 적용되므로 가장 작은 후보를 고르는 동안에는 `sqrt()`를 계산할 필요가 없다.

## 6. 큰 jump에서 작은 jump로 줄이는 이유

큰 `J`는 seed 좌표를 한 pass에서 멀리 전달하지만 가까운 경계의 세부 위치를 건너뛸 수 있다. 작은 `J`는 멀리 퍼지지는 못하지만 현재 후보를 주변 픽셀 단위로 수정할 수 있다.

일반적인 JFA는 이미지의 큰 변 길이에 가까운 2의 거듭제곱에서 시작해 절반씩 줄인다.

```text
예: 256 -> 128 -> 64 -> 32 -> 16 -> 8 -> 4 -> 2 -> 1
```

초반 pass가 전역으로 후보를 빠르게 퍼뜨리고, 후반 pass가 Voronoi 경계 근처의 선택을 좁힌다. 마지막 `J=1`을 한 번 더 실행하는 변형은 남은 한 픽셀 오차를 줄일 때 사용한다.

## 7. Color Text의 제한된 JFA

Color Text는 전역에서 정확한 최근접 seed를 구하려는 것이 아니다. 최종 색의 글자형 중심은 가장 가까운 활성 픽셀에서 약 3.2px 안쪽만 사용하고, 먼 위치에서는 기본 거리 16px로 처리한다.

그래서 현재 jump 목록은 전체 `480×600` field를 덮는 일반 일정이 아니라 다음의 제한된 일정이다.

```text
16 -> 8 -> 4 -> 2 -> 1 -> 1
```

이것은 **bounded local JFA heuristic**이다. 전역 최근접점을 항상 보장하지 않지만, 최종적으로 사용하는 짧은 거리 범위에 비해 충분히 넓은 후보를 더 적은 pass로 찾는다.

JFA 전에 `strokeSpreadMaterial`을 8회 실행한다. 활성값을 글자 마스크 안에서만 이웃으로 퍼뜨린 뒤 seed를 만들기 때문에 글자 내부의 작은 빈틈이 seed 단절로 남는 것을 줄인다. 이 확산은 geometry 외곽선을 넓히지 않고 색 중심용 seed에만 사용한다.

## 8. 최종 거리 사용

JFA가 끝나면 texture에는 `C(p)`와 그 seed의 strength가 있다. 실제 field pixel 거리는 마지막 shader에서 계산한다.

```text
d(p) = length((p - C(p)) * fieldSize)
```

Color Text는 `d(p)`가 `colorGlyphShapeRadius` 안에 있을 때 밝은 글자형 중심을 만들고, `colorGlyphShapeEdge`의 짧은 구간에서 0으로 전환한다.

```text
glyphEnergy = 1 - smoothstep(radius - edge, radius + edge, d(p))
```

`radius`를 키우면 활성 글자 픽셀 주위의 밝은 중심이 두꺼워진다. `edge`를 키우면 중심 경계가 더 흐려진다. 너무 큰 `edge`는 글자 모양 주위에 털 같은 halo를 다시 만들 수 있다.

## 9. 실제 Color Text 코드

구현은 [`pages/color-text/script.ts`](../../pages/color-text/script.ts)의 세 단계로 나뉜다.

| 코드 | 역할 | 저장 target |
| --- | --- | --- |
| `strokeSpreadMaterial` | 글자 내부 활성값 확산 | `strokeSpreadTargetA/B` |
| `nearestSeedMaterial` | 유효 seed에 자기 UV와 strength 저장 | `nearestTargetA` |
| `jumpFloodMaterial` | jump 간격의 3×3 후보 비교 | `nearestTargetA/B` ping-pong |

모두 매 frame, `480×600`의 모든 field pixel에서 실행된다. JFA target은 좌표가 중간 pixel 사이에서 보간되지 않도록 `NearestFilter`를 사용한다.

## 10. 일반적인 사용과 작품 전용 선택

일반적인 JFA 사용:

- Voronoi diagram 근사
- distance field 생성
- 가까운 feature나 seed 탐색
- GPU 기반 영역 전파

Color Text 전용 선택:

- seed는 활성 글자 픽셀로 제한
- 전역 일정 대신 `16…1`의 bounded schedule 사용
- 가장 가까운 seed의 strength도 함께 전달
- geometry가 아니라 실루엣 내부의 글자형 색 에너지에만 사용

## 11. 정확도와 대안

JFA는 빠른 근사 알고리즘이다. 일반적인 전체 jump 일정을 사용해도 Voronoi 경계 일부에서 한두 pixel 오차가 생길 수 있다. Color Text의 제한된 일정은 멀리 떨어진 전역 seed에 대해서는 더 큰 오차가 가능하다.

현재 용도에서는 반경 3.2px 근처만 사용하므로 이 오차가 geometry 외곽선에 영향을 주지 않는다. 하지만 정확한 전역 Euclidean distance가 필요하다면 다음 방법이 더 적합할 수 있다.

- exact Euclidean distance transform
- separable distance transform
- 충분한 전체 jump 일정의 JFA와 보정 pass
- seed 수가 매우 적을 때 모든 seed 직접 비교

## 12. 핵심 요약

```text
seed pixel에 자기 좌표 저장
  -> 큰 J의 3×3 이웃이 가진 seed 좌표 비교
  -> J를 줄여 반복
  -> 가까운 seed 좌표 C(p)
  -> 마지막에 거리 d(p) 계산
```

JFA의 핵심은 거리를 이웃으로 blur하는 것이 아니라, **가까운 seed의 좌표를 이웃 사이에서 전달한다는 것**이다.
