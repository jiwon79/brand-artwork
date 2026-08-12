# Smooth Union

Smooth union은 두 signed-distance field를 합치면서 외곽선과 기울기가 접합부에서 연속적으로 바뀌게 만드는 방법이다.

## 1. 그림으로 먼저 보기

![일반 min union과 smooth minimum union 비교](../assets/smooth-union.svg)

왼쪽은 두 signed-distance field를 `min(a, b)`로 바로 합친 결과다. 외곽선은 연결되지만 원과 bridge 중 어느 쪽의 거리를 선택할지가 바뀌는 위치에서 기울기가 꺾인다.

오른쪽은 두 거리가 비슷한 구간을 폭 `k` 안에서 섞은 결과다. 외곽선뿐 아니라 거리장의 기울기와 surface normal도 연속적으로 바뀐다.

## 2. Signed distance가 무엇인가

Signed-distance field, 줄여서 SDF는 공간의 각 위치에 숫자 하나를 저장한다.

```text
distance < 0 : 도형 내부
distance = 0 : 도형 외곽선
distance > 0 : 도형 외부
```

중심이 `c`, 반지름이 `r`인 원의 SDF는 다음과 같다.

```text
d_circle(p) = length(p - c) - r
```

두 번째 예시 도형으로 선분에 반지름을 준 capsule을 사용할 수 있다.

```text
d_capsule(p) = distanceToSegment(p, segmentStart, segmentEnd) - radius
```

원이나 capsule을 픽셀로 미리 그려두는 것이 아니다. 렌더링하려는 위치 `p`에서 이 식을 실행해 내부인지, 외부인지, 경계에서 얼마나 떨어졌는지 계산한다.

## 3. `min(a, b)`가 union이 되는 이유

두 도형 A와 B의 거리값을 각각 `a`, `b`라고 하자.

```text
d_union = min(a, b)
```

점이 A 내부라면 `a < 0`이고, B 내부라면 `b < 0`이다. 둘 중 하나라도 내부이면 작은 값은 음수가 되므로 union 전체의 내부가 된다.

예를 들어 다음 값에서는 A가 선택된다.

```text
a = -0.20
b =  0.35
min(a, b) = -0.20
```

반대편에서는 B가 선택된다.

```text
a =  0.18
b = -0.12
min(a, b) = -0.12
```

도형을 합치는 논리 자체는 정확하다. 문제는 `a = b` 부근에서 선택 대상이 즉시 바뀐다는 것이다.

## 4. 접합부가 날카로워지는 이유

surface normal은 거리장의 기울기에서 얻는다.

```text
normal = normalize(gradient(distance))
```

`min(a, b)`가 A를 선택하는 영역에서는 normal이 A의 기울기를 따른다. 경계를 한 픽셀 넘어 B가 더 작아지면 normal이 바로 B의 기울기로 바뀐다.

```text
A 영역          a = b          B 영역
gradient(a)  -> 선택 전환 -> gradient(b)
```

그래서 다음 문제가 생긴다.

- 원과 bridge 사이에 뾰족한 골이나 crease가 생긴다.
- normal이 갑자기 바뀐다.
- normal을 사용하는 spec과 굴절도 접합부에서 꺾인다.
- 도형이 움직일 때 전환 위치가 픽셀 사이를 이동하며 떨릴 수 있다.

즉, 외곽선 위치만의 문제가 아니라 거리장의 **미분값**이 불연속이라는 문제다.

## 5. Polynomial smooth minimum 수식

Smooth minimum에는 여러 형태가 있다. 여기서는 계산이 단순하고 접합 범위를 직접 조절할 수 있는 polynomial 형태를 사용한다.

```ts
function smoothMinimum(first: number, second: number, radius: number): number {
  const safeRadius = Math.max(radius, 0.0001);
  const blend = Math.max(
    safeRadius - Math.abs(first - second),
    0,
  ) / safeRadius;

  return Math.min(first, second)
    - blend * blend * safeRadius * 0.25;
}
```

식을 짧게 쓰면 다음과 같다.

```text
k = max(radius, epsilon)
h = max(k - abs(a - b), 0) / k
smoothMin(a, b, k) = min(a, b) - h^2 * k / 4
```

여기서 `k`가 두 거리장을 섞는 범위다.

## 6. 거리가 충분히 다르면 원래 `min`과 같다

두 거리의 차이가 `k` 이상이면 다음과 같다.

```text
abs(a - b) >= k
h = 0
smoothMin = min(a, b)
```

원 중심처럼 어떤 도형이 명확하게 더 가까운 위치에서는 다른 도형의 영향을 받지 않는다. 전체 도형을 무작정 blur하는 연산이 아니다.

## 7. 두 거리가 비슷할 때만 접합부를 채운다

`a`와 `b`가 가까워질수록 `h`는 1에 가까워진다. 이때 원래 `min`보다 작은 값을 만든다.

두 거리가 모두 0이고 `k = 0.2`라면 다음과 같다.

```text
h = 1
smoothMin(0, 0, 0.2) = -0.05
```

원래 두 도형의 외곽선이던 점이 union의 내부가 된다. 따라서 새로운 `distance = 0` 외곽선은 조금 더 바깥에 만들어지고 접합부가 둥글게 채워진다.

`h^2`를 사용하므로 blend 영역의 시작과 끝에서도 보정량이 갑자기 생기지 않는다. 그 결과 거리장의 기울기도 점진적으로 전환된다.

## 8. 여러 도형을 합치는 순서

세 개 이상의 거리장을 합칠 때는 작은 의미 단위부터 묶은 뒤 큰 형태에 합칠 수 있다.

```text
primitive A + primitive B
  -> branch distance

base distance + branch distance
  -> combined distance
```

Smooth minimum은 일반적으로 결합법칙을 엄밀히 만족하지 않으므로 합치는 순서에 따라 접합부가 조금 달라질 수 있다. 같은 `k`를 무조건 반복하기보다 어느 접합부가 더 단단하거나 넓어야 하는지에 따라 단계별 범위를 정한다.

## 9. 시간 보간과 smooth union은 다른 역할이다

`smoothMinimum()`은 두 도형의 **공간적인 접합부**를 부드럽게 만든다. 도형이 생기거나 사라질 때의 **시간적인 전환**은 별도의 influence가 담당한다.

```ts
distanceToShape += (combinedDistance - distanceToShape)
  * smoothInfluence(influence);
```

- `k`: 두 거리장이 공간에서 얼마나 넓게 섞이는가
- `influence`: 새 도형이 시간에 따라 얼마나 나타나 있는가

둘을 구분해야 animation 속도와 접합부 모양을 독립적으로 조절할 수 있다.

## 10. `k`를 바꾸면 생기는 일

| 값 | 접합부 | 장점 | 위험 |
| --- | --- | --- | --- |
| 작음 | 좁고 단단함 | 원과 branch 크기를 잘 유지 | crease와 normal 전환이 보일 수 있음 |
| 중간 | 자연스럽게 둥금 | 실리콘처럼 연결됨 | 약간의 면적 증가 |
| 큼 | 넓게 부풀어 합쳐짐 | 매우 말랑한 실루엣 | 목과 빈 공간이 과도하게 채워짐 |

`smoothMinimum()`은 접합부에서 거리를 더 음수로 만들기 때문에 union 면적을 증가시킨다. 면적이나 부피를 일정하게 유지해야 한다면 별도의 contour offset, 반경 보정 또는 제약 계산이 필요하다.

## 11. `smoothMaximum()`은 무엇인가

Smooth minimum의 부호를 뒤집으면 smooth maximum을 만들 수 있다.

```ts
function smoothMaximum(first: number, second: number, radius: number): number {
  return -smoothMinimum(-first, -second, radius);
}
```

SDF에서 `min`이 union이라면 `max`는 intersection이나 clipping에 사용된다.

```ts
clippedDistance = smoothMaximum(
  firstConstraint,
  secondConstraint,
  blendRadius,
);
```

이 부분은 도형을 부풀려 합치는 연산이 아니라 두 조건을 동시에 만족하는 영역으로 부드럽게 잘라내는 연산이다.

## 12. 자주 생기는 오해

### 화면 blur가 아니다

이미 그려진 이미지를 흐리는 것이 아니다. 외곽선을 결정하는 거리값을 수정한다.

### 모든 영역을 평균내지 않는다

두 거리의 차이가 `k`보다 작은 접합부에서만 동작한다. 나머지는 정확히 `min(a, b)`다.

### 원래 면적을 자동으로 보존하지 않는다

접합부를 채우므로 면적은 증가한다. 면적 보존은 별도의 contour offset 단계가 담당한다.

### normal을 직접 보간하는 것이 아니다

거리장을 먼저 부드럽게 만들고, 그 부드러운 거리장의 gradient를 계산하기 때문에 normal이 자연스럽게 이어진다.

## 13. 디버깅할 때 볼 순서

1. distance field debug에서 외곽선 접합부가 매끄러운지 본다.
2. surface normals debug에서 색 또는 방향이 갑자기 바뀌는 선이 없는지 본다.
3. 조명이나 굴절만 켜서 접합부에 꺾인 하이라이트가 생기는지 본다.
4. `k`를 줄이거나 늘려 문제 위치가 접합부와 함께 움직이는지 확인한다.
5. 모양은 좋지만 면적만 커진다면 smooth union이 아니라 별도의 면적 보정 단계를 조절한다.

## 14. 구현 참고

이 원리를 사용한 구현 사례는 [Guseul Architecture](../artworks/guseul/architecture.md#smooth-union)에서 확인할 수 있다.

## 15. 핵심 요약

핵심은 다음 한 문장이다.

> `smoothMinimum()`은 두 도형의 픽셀을 흐리는 함수가 아니라, 두 signed-distance field 사이에 미분 가능한 새 접합부를 만드는 함수다.
