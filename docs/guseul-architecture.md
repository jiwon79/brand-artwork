# Guseul Final Architecture

이 문서는 현재 구슬 페이지를 읽기 위한 기준 문서다. 실험 중 사용했던 Canvas2D 유리 렌더러, 포탈 전환 및 대체 spec warp는 최종 코드에서 제거되었다. 릴스 촬영용 디버그 뷰는 최종 WebGL 렌더 경로를 설명하기 위한 가벼운 시각화로만 남아 있다.

## 파일 읽는 순서

1. `pages/guseul/settings.ts`
   최종 기본값과 GUI에서 조절 가능한 값만 모여 있다.
2. `pages/guseul/script.ts`
   이미지 원, 회전, 제스처, 프레임 갱신을 연결하는 진입점이다.
3. `pages/guseul/elastic-contact-field.ts`
   여러 contact로 늘어난 외곽선과 release spring을 계산한다.
4. `pages/guseul/webgl-renderer.ts`
   외곽선, 굴절, chromatic separation, spec, glass shell을 픽셀마다 계산한다.
5. `pages/guseul/math.ts`
   구 회전과 spec 계산에서 공유하는 3D 벡터/행렬 함수다.

## 한 프레임의 흐름

```text
Pointer events
  -> ElasticContactField.update()
  -> sphere/spec orientation update
  -> photo circles projected to the sphere
  -> circles painted to a Canvas2D source texture
  -> source texture + shape/spec data uploaded to WebGL2
  -> one fragment shader renders the complete glass marble
  -> Canvas2D composites background, shadow, and WebGL canvas
```

Canvas2D는 사진 원을 한 장의 source texture로 조립하고 마지막 그림자를 합성하는 데만 사용한다. 유리의 픽셀 계산은 WebGL2 fragment shader가 담당한다.

## 1. 입력과 회전

한 손가락을 바로 움직이면 `rotate`, 한 손가락을 길게 누르거나 두 손가락 이상을 사용하면 `stretch`가 된다. 모드는 `GestureMode`와 `canvas.dataset.gestureMode`에 기록된다.

- `sphereOrientation`: 내부 사진 원의 구 회전
- `specOrientation`: 하이라이트의 구 회전
- `spinVelocity`: 손을 놓은 뒤 관성
- `idleSpeed`: 관성 이후 자동 회전

stretch 중에도 내부 source의 자동 회전은 계속된다. `sourceFollow`는 변형된 유리를 source 사진이 얼마나 따라갈지만 결정한다.

## 2. 탄성 형태

`ElasticContactField`는 원 중심의 seed와 각 contact를 signed-distance field로 합친다.

- contact circle: 손가락이 잡은 끝부분
- center bridge: 중심과 contact를 연결하는 부분
- membrane link: contact와 contact 사이를 채우는 부분
- contour offset: 목표 면적에 맞춰 전체 경계를 보정하는 값

contact를 놓으면 위치는 임계 감쇠 형태로 anchor로 돌아가고, influence는 `releaseHoldDuration` 이후 `releaseLifetime` 동안 사라진다. 따라서 contact가 갑자기 삭제되면서 외곽선이 튀지 않는다.

같은 형태 공식이 TypeScript와 GLSL 양쪽에 있다. TypeScript 쪽은 면적 보정과 spec cage를 만들고, GLSL 쪽은 최종 픽셀의 내부/외부와 edge normal을 계산한다.

## 3. 내부 사진 원

원 중심은 golden-angle 분포로 구 전체에 배치된다. 매 프레임 현재 `sphereOrientation`으로 3D 점을 회전한 뒤 화면의 `(x, y)`로 투영한다.

`z`는 다음 값을 정한다.

- 앞면/뒷면 draw order
- 원 크기
- 사진의 alpha, blur, saturation, brightness
- 흰 stroke의 alpha

완성된 원들은 `contentCanvas`에 그려지고 WebGL의 `uContent` texture가 된다.

## 4. 유리 굴절과 chromatic

fragment shader는 현재 픽셀에서 `contactField()`를 계산한다. 거리 함수의 화면 미분 `dFdx/dFdy`로 변형된 외곽선의 normal을 구하고, `convexProfile()`로 유리 표면의 slope와 높이를 만든다.

`sampleLiquidGlass()`는 이 slope를 이용해 카메라 ray를 굴절시킨다. R/G/B가 서로 다른 IOR로 source texture를 샘플링하므로 단순 blur가 아니라 채널 분리가 생긴다. source 원의 실제 경계에 가까운지도 별도로 검사해 사진 경계의 chromatic을 강화한다.

## 5. Spec 변형

spec은 먼저 완전한 구 위의 고정된 carrier와 tangent axes로 정의된다. 회전된 carrier에서 reflection vector를 계산하면 직사각형 또는 원형 하이라이트가 구 표면을 돈다.

늘어난 형태에서는 원형 구의 좌표를 그대로 쓸 수 없다. `BoundarySpecCageSolver`가 초기 원의 boundary와 현재 외곽선을 같은 순서로 대응시킨 cage를 만들고, shader의 `inverseBoundarySpecWarp()`가 현재 픽셀을 원래 구 좌표로 역변환한다. 그래서 spec 모양은 늘어나면서도 외곽선을 따라 연속적으로 유지된다.

## 6. Glass shell

굴절된 source 위에 다음 항목을 고정된 순서로 합성한다.

1. `innerShade`: 표면 normal과 고정 광원에 따른 기본 명암
2. `glassMilk`: 가장자리의 아주 약한 흰 산란
3. `spec`: 회전하고 변형되는 반사 하이라이트
4. `topWash`: 위쪽 환경광
5. `rim`, `hardRim`, `caRim`: 가장자리 두께와 색수차 보강
6. outer stroke: 최종 외곽선의 얇은 경계

최종 디자인에서는 모두 켜져 있다. `0 reel presentation` GUI는 같은 셰이더 안에서 각 합성 결과를 마스킹하므로, 대체 렌더러 없이 레이어가 쌓이는 과정을 보여준다.

## 7. 릴스 프레젠테이션

`build step`은 다음 순서로 레이어를 누적한다.

```text
clear -> source -> circle strokes -> refraction -> chromatic
      -> inner shade -> glass milk -> top wash -> rim
      -> hard / CA rim -> specular -> final stroke and shadow
```

`previous step`과 `next step`으로 촬영 중 한 단계씩 이동할 수 있다. source, glass, light, finish 폴더에서는 각 레이어를 따로 켜고 끌 수 있으며, 이때 단계 이름은 `custom`으로 바뀐다.

디버그 뷰는 최종 픽셀 계산을 다음 방식으로 바꿔 보여준다.

- `contact field`: 내부와 외부의 signed distance 및 실제 contour
- `surface normals`: 굴절과 명암에 사용하는 변형 표면 normal
- `spec mask`: 반사 벡터가 spec 영역에 들어간 정도
- `show contacts`: 중심-contact bridge와 contact-contact membrane을 최종 화면 위에 표시

이 설정들은 계산 방식을 교체하지 않는다. 최종 fragment shader가 이미 계산한 중간값을 색으로 표시하거나, 합성 직전의 레이어 기여도를 0으로 만드는 역할만 한다.

## 설정을 바꿀 때

최종 기본값은 `settings.ts` 한 곳에서만 바꾼다. GUI는 같은 객체를 직접 수정하므로 별도의 설정 복사본이 없다. 형태 관련 값을 추가하려면 `ElasticFieldControls`, 렌더링 관련 값을 추가하려면 `GpuGlassControls`까지 데이터가 전달되는 경로를 함께 갱신해야 한다.
