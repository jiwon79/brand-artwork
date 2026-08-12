# Jump Flood Nearest-seed Search

Jump Flood Algorithm, 줄여서 JFA는 이미지의 각 픽셀에 가까운 seed의 좌표를 큰 간격에서 작은 간격으로 빠르게 전달하는 GPU 알고리즘이다.

## 1. 그림으로 먼저 보기

![Jump Flood의 seed 생성, jump 후보 비교, 최근접 거리 결과](../assets/jump-flood-nearest-seed.svg)

왼쪽에서 유효한 픽셀만 자기 좌표 `C_i`를 저장한다. 가운데의 출력 픽셀 `p`는 jump 간격 `J`만큼 떨어진 3×3 위치가 가진 후보 좌표를 읽는다. jump를 줄여 반복하면 오른쪽처럼 가까운 seed 좌표 `C(p)`를 얻고 실제 거리 `d(p)`를 계산할 수 있다.

## 2. 해결하려는 문제

어떤 픽셀 `p`에서 가장 가까운 활성 seed 픽셀까지의 거리를 알고 싶다고 하자. 모든 seed와 거리를 직접 비교하면 다음 비용이 든다.

```text
출력 픽셀 수 * seed 수
```

seed 픽셀이 수천 개라면 매 frame 모든 출력 픽셀에서 이 목록을 순회하기 어렵다.

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

## 7. 제한된 local JFA

항상 texture 전체의 정확한 최근접 seed가 필요한 것은 아니다. 결과가 seed에서 최대 `R_use` pixel 안쪽만 사용된다면, 가장 큰 jump도 그보다 충분히 큰 국소 범위에서 시작할 수 있다.

```text
J_start >= R_use
J_start -> J_start / 2 -> ... -> 2 -> 1
```

이것을 **bounded local JFA heuristic**이라고 볼 수 있다. 전체 texture를 덮는 일정보다 pass 수를 줄일 수 있지만, `J_start`보다 멀리 있는 seed가 실제 최근접점인 위치에서는 정확성을 보장하지 않는다. 따라서 결과를 사용하는 최대 거리와 jump 범위를 함께 정해야 한다.

입력 seed가 작은 구멍 때문에 지나치게 끊겨 있다면 JFA 전에 마스크 안에서만 제한적인 확산을 적용할 수도 있다. 이 전처리는 최근접 탐색 자체와 별개의 선택이며, 원래 마스크의 외곽선을 바꾸지 않도록 범위를 제한해야 한다.

## 8. 최종 거리 사용

JFA가 끝나면 texture에는 `C(p)`와 그 seed의 strength가 있다. 실제 field pixel 거리는 마지막 shader에서 계산한다.

```text
d(p) = length((p - C(p)) * fieldSize)
```

예를 들어 `d(p)`가 반경 `R` 안에 있을 때만 에너지를 만들고, 경계 폭 `E`에서 0으로 전환할 수 있다.

```text
energy = 1 - smoothstep(R - E, R + E, d(p))
```

`R`을 키우면 seed 주위의 영향 범위가 두꺼워진다. `E`를 키우면 경계가 더 흐려진다. 너무 큰 `E`는 입력 형태 주위에 의도하지 않은 halo를 만들 수 있다.

## 9. 구현할 때의 texture 설정

각 pass는 이전 결과를 읽고 다음 결과를 쓰므로 보통 같은 크기의 texture 두 장을 ping-pong한다. Seed 좌표는 두 pixel 사이에서 선형 보간되면 존재하지 않는 가짜 좌표가 되므로 nearest filtering을 사용한다.

## 10. 일반적인 사용

일반적인 JFA 사용:

- Voronoi diagram 근사
- distance field 생성
- 가까운 feature나 seed 탐색
- GPU 기반 영역 전파
- seed의 부가 속성 전달

## 11. 정확도와 대안

JFA는 빠른 근사 알고리즘이다. 일반적인 전체 jump 일정을 사용해도 Voronoi 경계 일부에서 한두 pixel 오차가 생길 수 있다. 제한된 local 일정은 범위 밖의 seed에 대해 더 큰 오차가 가능하다.

정확한 전역 Euclidean distance가 필요하다면 다음 방법이 더 적합할 수 있다.

- exact Euclidean distance transform
- separable distance transform
- 충분한 전체 jump 일정의 JFA와 보정 pass
- seed 수가 매우 적을 때 모든 seed 직접 비교

## 12. 구현 참고

이 원리를 사용한 구현 사례는 [Color Text Architecture](../artworks/color-text/architecture.md#8-color-활성-글자-모양을-밝게-만들기)에서 확인할 수 있다.

## 13. 핵심 요약

```text
seed pixel에 자기 좌표 저장
  -> 큰 J의 3×3 이웃이 가진 seed 좌표 비교
  -> J를 줄여 반복
  -> 가까운 seed 좌표 C(p)
  -> 마지막에 거리 d(p) 계산
```

JFA의 핵심은 거리를 이웃으로 blur하는 것이 아니라, **가까운 seed의 좌표를 이웃 사이에서 전달한다는 것**이다.
