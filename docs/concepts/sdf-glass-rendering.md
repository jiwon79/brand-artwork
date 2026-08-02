# SDF Glass Rendering

이 문서는 signed-distance field(SDF)로 2D 외곽선을 만들고, 그 외곽선 위에 가상의 유리 단면을 세워 texture를 굴절시키는 공통 원리를 설명한다.

특정 작품의 contact 구조, GUI 값, grid 해상도나 함수 이름에는 의존하지 않는다. 원, 둥근 사각형, 여러 blob처럼 **거리 함수로 표현할 수 있는 형태**라면 같은 흐름을 적용할 수 있다.

```text
화면 픽셀
  -> shapeDistance 계산
  -> 안쪽 거리와 외곽선 normal 계산
  -> 가상 유리 단면의 slope와 height 계산
  -> 굴절 광선의 texture offset 계산
  -> 이동한 위치에서 source texture 읽기
```

실제 작품에 적용한 예시는 [`Guseul Surface and Refraction`](../artworks/guseul/surface-refraction.md)을 참고한다.

## 1. SDF는 외곽선까지의 거리를 돌려준다

SDF는 한 점이 형태의 경계에서 얼마나 떨어져 있는지 반환하는 함수다. Signed라는 말처럼 값에 부호가 있다.

```text
distance < 0  형태 내부
distance = 0  외곽선 위
distance > 0  형태 외부
```

중심이 `center`, 반지름이 `radius`인 원은 다음처럼 표현할 수 있다.

```glsl
float circleDistance(vec2 point, vec2 center, float radius) {
  return length(point - center) - radius;
}
```

Fragment shader가 화면의 모든 픽셀에서 이 함수를 실행하면 별도의 polygon mesh 없이도 원을 그릴 수 있다.

## 2. 간단한 거리장을 합쳐 복잡한 형태를 만든다

원, 선분 주위의 capsule, 사각형 같은 primitive는 각각 거리 함수로 표현할 수 있다. 여러 거리장 중 가장 작은 값을 고르면 합집합이 된다.

```glsl
float unionDistance = min(firstDistance, secondDistance);
```

다만 단순한 `min()`은 두 형태가 만나는 부분을 날카롭게 만든다. 접합부를 둥글게 연결하려면 smooth minimum을 사용한다.

```glsl
float shapeDistance = smoothMinimum(
  firstDistance,
  secondDistance,
  blendRadius
);
```

Smooth union의 수식과 단면 변화는 [`Smooth Union`](./smooth-union.md)에 따로 정리했다.

이 방식의 핵심은 최종 외곽선의 점 목록을 먼저 만드는 것이 아니라, **어떤 위치를 넣어도 최종 외곽선까지의 값을 돌려주는 하나의 함수**를 만드는 것이다.

## 3. GPU는 출력 픽셀마다 같은 질문을 한다

화면 전체를 덮는 삼각형을 하나 그리고 fragment shader가 각 픽셀에서 다음 값을 계산한다.

```glsl
float shapeDistance = shapeField(point);
```

결과가 양수이면 외부이므로 투명하게 끝낼 수 있다. 음수이면 유리 내부이므로 굴절과 색상 계산을 계속한다.

```glsl
float antialiasWidth = fwidth(shapeDistance);
float coverage = 1.0 - smoothstep(
  -antialiasWidth,
  antialiasWidth,
  shapeDistance
);
```

`fwidth()`를 사용하면 화면 해상도에 맞는 부드러운 외곽선을 만들 수 있다.

## 4. inwardDistance는 외곽선에서 안으로 들어온 거리다

내부에서는 `shapeDistance`가 음수다. 부호를 반대로 바꾸면 외곽선에서 안쪽으로 얼마나 들어왔는지를 얻을 수 있다.

```glsl
float inwardDistance = max(-shapeDistance, 0.0);
```

```text
외곽선 위       inwardDistance = 0
조금 안쪽       inwardDistance = 작은 값
깊은 내부       inwardDistance = 큰 값
```

이 값을 사용하면 “외곽선에서 일정 폭까지만 볼록하고 그 이후에는 평평한” 유리 단면을 만들 수 있다.

Smooth union 등으로 합성한 거리장은 모든 위치에서 완벽한 실제 거리와 같지는 않을 수 있다. 그래도 외곽선 주변에서 값이 연속적이면 시각적인 단면과 antialias 계산에 사용할 수 있다.

## 5. SDF의 변화 방향이 외곽선 normal이다

SDF 값이 가장 빠르게 증가하는 방향은 외곽선에 수직이다. Shader에서는 인접 픽셀의 변화량을 화면 미분으로 구한다.

```glsl
vec2 gradient = vec2(
  dFdx(shapeDistance),
  dFdy(shapeDistance)
);
vec2 edgeNormal = normalize(gradient);
```

원이라면 normal이 중심에서 바깥으로 향한다. 늘어나거나 오목한 형태라면 현재 외곽선의 실제 방향을 따라 normal도 함께 휜다.

```text
고정 radial normal
  -> 기본 원의 방향만 표현

SDF gradient normal
  -> 현재 변형된 외곽선의 방향 표현
```

## 6. 높이 함수로 가상의 유리 단면을 만든다

![유리 단면에서 slope, height, refraction offset이 만들어지는 과정](../assets/glass-surface-refraction.svg)

2D SDF에는 실제 z축 높이가 없다. 대신 외곽선에서 안쪽으로 이동하는 진행도 `t`를 만들고 원하는 단면 함수를 적용한다.

```glsl
float t = clamp(inwardDistance / edgeWidth, 0.0, 1.0);
float profileHeight = surfaceProfile(t);
float profileSlope = surfaceProfileDerivative(t);
```

일반적인 볼록 유리 단면은 다음 성질을 가진다.

```text
외곽선 근처
  -> 높이가 빠르게 변함
  -> slope가 큼
  -> 강한 굴절

안쪽 평면
  -> 높이 변화가 작음
  -> slope가 0에 가까움
  -> 약한 굴절
```

어떤 `surfaceProfile()`을 선택하는지는 디자인에 따라 달라진다. 원호, 제곱근, smoothstep 조합 등을 사용할 수 있으며 하나의 정답은 없다.

## 7. surface sample은 방향과 높이를 묶는다

Profile derivative는 기울기의 크기만 알려준다. 여기에 `edgeNormal`을 곱하면 현재 외곽선에 맞는 방향이 생긴다.

```glsl
vec2 slope = edgeNormal * profileSlope;
float height = baseThickness + profileHeight;
```

이를 하나의 surface sample로 생각할 수 있다.

```text
surface slope
  유리 표면이 x/y 방향으로 얼마나 기울었는가

surface height
  굴절된 광선이 source 평면까지 얼마나 진행하는가
```

이 값은 완전한 3D mesh의 vertex가 아니다. 각 픽셀에서 가상의 표면을 계산하기 위한 압축된 정보다.

## 8. 기울기와 높이가 texture 굴절을 만든다

Slope를 사용해 카메라를 향한 3D normal을 만든다.

```glsl
vec3 surfaceNormal = normalize(vec3(slope, 1.0));
```

카메라 광선, surface normal, 굴절률 IOR를 `refract()` 또는 Snell 법칙에 넣으면 유리 안에서 진행할 광선 방향이 나온다.

```glsl
vec3 ray = refract(cameraRay, surfaceNormal, 1.0 / ior);
```

광선이 `height`만큼 진행했을 때 source 평면에서 이동한 x/y 거리를 계산한다.

```glsl
vec2 offset = ray.xy / max(-ray.z, 0.0001) * height;
```

마지막으로 현재 픽셀이 아니라 이동한 위치에서 source texture를 읽는다.

```glsl
vec3 color = texture(sourceTexture, uv + offset).rgb;
```

따라서 source 자체를 변형하지 않아도 유리 아래의 이미지가 외곽선 방향으로 휘고 늘어난 것처럼 보인다.

## 9. 각 값이 담당하는 역할

```text
shapeDistance
  현재 픽셀이 형태 안인지 밖인지 결정

inwardDistance
  외곽선에서 안쪽으로 얼마나 들어왔는지 결정

edgeNormal
  굴절이 향할 2D 방향 결정

profileSlope
  광선이 얼마나 기울어질지 결정

IOR
  매질 때문에 광선이 얼마나 꺾일지 결정

surface height
  꺾인 광선이 source 위에서 얼마나 멀리 이동할지 결정
```

기울기와 IOR가 같아도 height가 커지면 offset이 길어진다. Height가 같아도 slope가 커지면 광선 방향이 더 기울어진다.

## 10. Chromatic separation도 같은 경로를 사용한다

실제 물질은 빛의 파장에 따라 굴절률이 조금 다르다. 이를 단순화해 R, G, B 채널에 서로 다른 IOR를 사용할 수 있다.

```text
red ray  = IOR + dispersion
green ray = IOR
blue ray = IOR - dispersion
```

각 채널이 다른 source 위치를 읽으면 이미지 경계에서 색이 분리된다. 별도의 무지개 gradient를 덧씌우는 것보다 기본 굴절과 자연스럽게 연결된다.

## 11. 어떤 프로젝트에서 재사용할 수 있는가

이 구조는 다음과 같은 화면에 재사용할 수 있다.

- 원형 또는 둥근 UI 위의 liquid-glass 효과
- 여러 blob이 합쳐지는 렌즈
- touch로 늘어나는 투명한 2D 물체
- SDF 아이콘이나 text 위의 굴절
- WebGL, WebGPU fragment shader 기반 후처리

프로젝트마다 달라지는 부분은 다음이다.

- `shapeField()`를 구성하는 primitive
- primitive를 연결하는 union 방식
- `surfaceProfile()`의 곡선
- edge width, thickness, IOR, dispersion 값
- source texture의 좌표계와 외부 샘플 처리

즉, **SDF에서 normal과 가상 높이를 만들고 굴절 offset으로 texture를 다시 읽는 흐름은 공통**이고, 형태를 만드는 거리 함수와 단면 곡선은 각 작품의 디자인에 맞게 바뀐다.
