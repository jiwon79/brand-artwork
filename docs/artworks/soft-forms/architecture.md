# 솜결 (Soft Forms) 아키텍처

솜결은 변형 가능한 3D 몸체에 반투명 셸과 털 리본을 겹쳐 솜털 캐릭터를 만든다. 자동 움직임과 터치 반응은 CPU에서 몸체·털 좌표를 갱신하고, Three.js의 한 scene을 정사영 카메라로 그린다. 이 문서는 현재 구현의 입력 → 중간 상태 → 렌더링 → 출력 → 검증 순서로 설명한다.

![솜결의 입력, CPU 변형, GPU 렌더링 흐름](../../assets/soft-forms-frame-pipeline.svg)

도식 편집 원본: [`soft-forms-frame-pipeline.drawio`](../../assets/soft-forms-frame-pipeline.drawio).

## 용어와 코드 이름

| 용어 | 의미와 코드 대응 | 정리한 이전 표현 |
| --- | --- | --- |
| 솜결 / Soft Forms | 작품명. 코드와 URL은 `soft-forms` | Fluffy Peach, peach를 작품 전체 이름으로 사용 |
| 캐릭터 종류 (`variant`) | 노을 솜·완두콩·살구꽃·별이·파도. `VariantId`와 공개 `shape` 값 | 색상과 형태를 서로 다른 캐릭터 이름으로 사용 |
| 변형 컨트롤 (`control`) | 중심 1개와 둘레 12개의 독립된 이동·회전 기준점 | bone, joint |
| 변형 리그 (`DeformationRig`) | 컨트롤별 pose와 점별 가중치를 이용한 평면 변형 | `BoneRig`, 연결된 관절 골격이라는 설명 |
| 기준 표면 (`rest surface`) | 해당 캐릭터의 자동 움직임·터치 적용 전 표면 | `bone-surface` |
| 표면 바인딩 (`SurfaceBinding`) | 기준 위치, 고정 컨트롤 가중치, 볼 돌출량의 캐시 | 몸체와 털에 따로 작성한 가중치 준비 코드 |
| 셸 (`shell`) | 몸체 밖에 겹치는 반투명 표면. 털의 두께를 채움 | 털 한 가닥과 같은 의미로 사용 |
| 털 가닥 (`fiber`) / 리본 (`ribbon`) | fiber는 뿌리·끝·길이 등의 데이터, ribbon은 그 가닥을 그리는 얇은 삼각형 띠 | 선분, 셸, fin을 혼용 |
| 표면색 (`surfaceColor`) | 몸체·셸·리본이 공유하는 위치 기반 색 함수 | `peachColor` |

공개 `VariantId`는 `original`, `bean`, `flower`, `star`, `wave`를 유지한다. 기본 선택은 파도(`wave`)이고, 이전 쿼리 `drop`·`cloud`는 각각 `flower`·`wave`로 해석한다. `bone-*` 모듈은 `deformation-rig`, `motion-fit`, `motion-clips`, `rest-surface`로 정리했다. 사용되지 않던 `Variant.flutter` 필드는 제거했다.

## 모듈 책임

모든 코드 링크의 기준 폴더는 [`pages/soft-forms/`](../../../pages/soft-forms/)다.

| 파일 | 입력 → 출력과 책임 |
| --- | --- |
| [`script.ts`](../../../pages/soft-forms/script.ts) | URL·포인터·시간 → scene 상태. 카메라, 프레임 순서, 눈·그림자, 구조 보기 연결 |
| [`variants.ts`](../../../pages/soft-forms/variants.ts) | 캐릭터 ID·방향각 → 형태 계수. 캐릭터 이름, 색, 깊이, 눈 이동량 정의 |
| [`rest-surface.ts`](../../../pages/soft-forms/rest-surface.ts) | 단위구 방향·기준 반경 → 캐릭터별 기준 표면 위치 |
| [`deformation-rig.ts`](../../../pages/soft-forms/deformation-rig.ts) | 기준 위치·컨트롤 pose → 변형 위치. 고정 가중치와 평면 회전 가중합 |
| [`surface-binding.ts`](../../../pages/soft-forms/surface-binding.ts) | 표면 방향 → 기준 위치·가중치 캐시. 몸체와 털 뿌리의 공통 binding·볼 변형 |
| [`motion-fit.ts`](../../../pages/soft-forms/motion-fit.ts) | 측정 외곽선 → 원본 캐릭터의 컨트롤 pose. 정규화된 최소제곱 fitting |
| [`motion-clips.ts`](../../../pages/soft-forms/motion-clips.ts) | fitting 결과·캐릭터 → 반복 클립과 시간 대응표 |
| [`motion-track.ts`](../../../pages/soft-forms/motion-track.ts), [`motion-loop.ts`](../../../pages/soft-forms/motion-loop.ts) | 키프레임·시간 → 곡선 보간값과 원본 측정 프레임 대응 |
| [`touch-reaction.ts`](../../../pages/soft-forms/touch-reaction.ts), [`zoom.ts`](../../../pages/soft-forms/zoom.ts) | 누름·드래그·두 손가락 거리 → 눌림·반동·털 지연·확대 배율 |
| [`fur-renderer.ts`](../../../pages/soft-forms/fur-renderer.ts) | 변형 몸체·리그·터치 → 셸 위치와 털 뿌리·끝 buffer. 털 geometry와 재질 소유 |
| `body.frag`, `palette.glsl` | 몸체 위치·normal·색 uniform → 몸체 RGBA |
| `fur-shell.vert` / `.frag`, `fur-ribbon.vert` / `.frag` | 셸·가닥 buffer → 두께와 가닥 RGBA |
| `background.frag`, `style.css`, `index.html` | 배경·CSS blur·캔버스·접근성 설명·공유 메타데이터 |
| `motion-data.ts`, `generate-motion.py` | 사전 측정값과 측정 도구. 런타임에는 영상 픽셀 대신 숫자만 사용 |

## 1. 입력과 좌표 공간

포인터의 `clientX/Y`는 CSS pixel이다. 캔버스 경계를 기준으로 `[-1, 1]` NDC로 바꾸고, `Raycaster`로 **현재 변형된 몸체**를 찾는다. 닿은 위치를 `character.worldToLocal()`로 캐릭터 로컬 공간에 옮긴 뒤 `TouchReaction.begin()`에 점과 face normal을 전달한다. 털 리본은 hit test 대상에 넣지 않는다.

| 공간 | 기준과 단위 | 소비 단계 |
| --- | --- | --- |
| 측정 영상 | 720 × 720 pixel, 오른쪽 `+x`, 아래 `+y` | 원본 중심·눈·외곽선 motion |
| 단위구 방향 | 길이 1의 `(x,y,z)`. 위치나 UV가 아닌 기준 방향 | 몸체의 기준 표면과 털 분포 |
| 캐릭터 로컬 | 작품 단위, 오른쪽 `+x`, 위 `+y`, 앞쪽 `+z` | 리그·터치·몸체·털·눈 |
| scene / 카메라 | 같은 작품 단위, 정사영 카메라 `z=1000` | 캐릭터 그룹의 회전·scale·position |
| 출력 | CSS pixel과 device pixel 구분, DPR 최대 2 | WebGL 캔버스와 CSS blur |

`resize()`는 `unit = min(canvasWidth, canvasHeight) / 720`으로 정사영 범위를 만든다. 짧은 화면 변이 기준 720단위를 담고 긴 변에는 여백이 생긴다. 카메라 zoom은 두 손가락으로 0.65~2.5 사이에서 조절한다.

포인터가 8 CSS pixel 이상 움직이면 회전 드래그로 전환한다. 위아래 드래그는 X 회전, 좌우 드래그는 Y 회전으로 연결한다. 몸체를 잡은 드래그만 털 지연 반응을 만든다. 두 번째 터치가 들어오면 누름을 취소하고 pinch로 전환한다.

`?t=2.25`는 자동 움직임의 시간을 초 단위로 고정한다. 터치 응답과 색 전환은 계속 진행한다. `prefers-reduced-motion`은 자동 시간을 고정하고 색 전환을 즉시 적용한다. 구조 보기 GUI는 항상 제공한다.

## 2. 기준 표면과 표면 바인딩

초기화 때 `SphereGeometry(1, 88, 64)`의 위치를 `bodyDirections`에 복사한다. 원본 단위구 방향은 이후 몸체가 변형돼도 바꾸지 않는다. `baselineRadii`는 모든 측정 프레임의 각 방향 반경을 평균한 배열이다.

`restRadius()`는 방향각에 해당하는 기준 반경 두 개를 보간하고, 둘레의 디테일과 캐릭터별 `shapeFactor()`를 적용한다. 단위구 XY가 중심에 가까우면 평균 반경에 가깝게 만들어 앞면의 요철을 줄인다. `restSurface()`는 XY에 이 반경을 곱하고 Z는 `z * 116 * depth`로 만든다. 파도에는 위쪽 봉우리의 왼쪽 이동·상승과 XY 기울기를 추가한다.

`bindSurface()`는 각 점의 기준 위치, 13개 컨트롤 가중치, 노을 솜의 볼 돌출량을 연속 `Float32Array`에 저장한다. 몸체는 방향 stride 3, 털은 `[x,y,z,length,lean]` stride 5를 사용한다. 털 가중치는 몸체 표면 위치에서 계산한 다음 뿌리를 기준 방향으로 1.5단위 안쪽에 넣는다. 이 순서 덕분에 뿌리를 숨겨도 몸체와 털의 컨트롤 영향은 같다.

`ensureSurfaceBindings()`는 선택한 캐릭터 ID가 바뀔 때만 리그와 binding을 다시 만든다. 매 프레임에는 저장된 가중치를 재사용한다. 눈 두 개의 표면 위치는 별도로 샘플링하므로 그 위치의 가중치만 매 프레임 계산한다.

## 3. 독립 컨트롤로 몸체 움직이기

컨트롤 0은 중심 `(0,0)`, 나머지는 오른쪽에서 시작해 시계 방향으로 30°씩 배치한다. 기본 둘레 반경은 105단위다. 캐릭터별 `shapeFactor()`로 배치를 바꾸고, 파도에는 기울기를 더한다. 컨트롤 사이의 부모·자식 연결이나 길이 제약은 없다.

점이 한 컨트롤에만 붙으면 그 경계에서 몸체가 꺾인다. `weightsFor()`는 가까운 컨트롤에 높은 가중치를 주고 합을 1로 맞춘다. 기준점 `P=(x,y)`, 컨트롤 중심 `C_i`, 영향 폭 `σ_i`, 중심 강화 계수 `a_i`를 사용한다.

\[
q_i = a_i\exp\left(-\frac{\lVert P-C_i\rVert^2}{2\sigma_i^2}\right),\qquad
w_i = \frac{q_i}{\sum_j q_j}
\]

중심은 `a=1.8`, `σ=68`, 둘레는 `a=1`, `σ=43`이다. 거리가 작을수록 `q_i`가 커지고, 폭이 클수록 넓은 영역이 함께 움직인다. 정규화는 이동 크기가 가중치 총량 때문에 확대되지 않게 한다.

`ControlPose`는 로컬 이동 `D_i=(dx,dy)`와 radian 회전각 `θ_i`다. `skinPoint()`는 컨트롤을 중심으로 회전한 결과를 섞는다.

\[
P' = \sum_i w_i\left(C_i+D_i+R(\theta_i)(P-C_i)\right)
\]

각 항은 같은 기준점에 서로 다른 강체 변환을 적용한 위치다. 가중치 합이 1이므로 모든 pose가 0일 때 기준점을 보존한다. 이는 linear blend skinning의 가중합을 평면 독립 컨트롤에 적용한 형태다. Z는 리그에서 바꾸지 않고, 볼 돌출과 터치에서 별도로 갱신한다.

### 자동 움직임 준비

초기화 때 `fitControlFrames()`는 측정 외곽선의 네 반경대 × 64방향을 표본화해 원본 pose를 맞춘다. 이동과 작은 회전에 대한 정규화 최소제곱 시스템을 만들고 Cholesky 분해를 재사용한다. 실제 회전으로 생기는 오차를 세 번 보정한다.

`createMotionClips()`는 원본의 전진 동작 뒤에 별도 복원 궤적을 붙인다. 다른 네 캐릭터는 공간별 시간 지연이 있는 바람 목표를 감쇠 진동으로 미리 계산한다. 움직임이 적은 구간의 시간을 줄여 모두 144프레임, 24fps의 6초 반복으로 맞춘다. 런타임에는 3프레임 간격 키를 `sampleTrack()`으로 보간한다. 트랙의 회전 값은 degree, 최종 `ControlPose.angle`은 radian이다.

### 터치 합성

`TouchReaction.advance(dt)`가 누름과 드래그 상태를 갱신한다. 프레임 `dt`는 최대 0.05초로 제한한다. 누름은 터치점 주변의 거리 감쇠 변위, 떼기는 거리에 따라 늦게 도착하는 반동을 만든다. 그 변위를 저장한 터치 normal 방향으로 더한다.

몸체 변형 다음에 normal을 다시 계산한다. 털 뿌리에는 같은 터치 변위를, 털끝에는 그 변위의 0.72배를 적용하고 드래그 지연을 더한다. 캐릭터 그룹 전체의 XY squash·반동과 눈 깜빡임은 이후 적용한다. 450ms 이내의 빠른 재탭은 반동을 반복 시작하지 않으며, 0.35초 이상 누르면 긴 누름 반응을 사용한다.

## 4. 프레임 상태에서 GPU buffer까지

`render()`는 다음 순서로 갱신한다.

1. 터치 상태를 진행하고 선택한 캐릭터의 색 가중치를 갱신한다.
2. 반복 시간과 원본 측정 시간의 대응을 구하고 볼 돌출량을 갱신한다.
3. 필요하면 binding을 바꾼 뒤 현재 컨트롤 pose를 설정한다.
4. `updateBodyGeometry()`로 몸체 위치·normal을 갱신하고 `FurRenderer.update()`에 전달한다.
5. 구조 보기의 영향 색과 컨트롤 표시를 갱신한다.
6. 캐릭터 그룹의 이동·회전·scale, 눈 위치·개방도, 바닥 그림자를 갱신한다.
7. `renderer.render(scene, camera)`를 호출한다.

종류 전환의 `variantWeights`는 **색과 별이의 몸체 투명도**에 사용한다. 형상은 선택한 ID의 기준 표면·리그로 교체하며, 서로 다른 몸체를 기하학적으로 morph하지 않는다.

몸체·셸 position과 털 뿌리·끝 attribute는 `DynamicDrawUsage`로 만들고 갱신 뒤 `needsUpdate`를 켠다. 배열을 매 프레임 재생성하지 않는다. 자동 시간이 진행 중이거나 색 전환·터치가 남아 있을 때만 다음 프레임을 요청한다.

## 5. 털 렌더링과 그리기 순서

공통 공간 관계와 수식은 [털의 셸과 리본 렌더링](../../concepts/fur-shells-and-ribbons.md)에서 설명한다. 여기서는 현재 작품의 선택을 기록한다.

| 그리기 단계 | 현재 구현과 역할 |
| --- | --- |
| 배경·그림자 | Z=-450 평면. 세로 그라디언트와 Gaussian 타원 그림자 |
| 몸체 | 앞면만 그림. `surfaceColor()`·약한 normal 조명·noise. 부드러운 외곽 alpha, `depthWrite=true` |
| 13개 셸 | `renderOrder=1..13`. 같은 몸체 topology를 복제한 반투명 표면, `depthWrite=false` |
| 23,000개 리본 | `renderOrder=14`. 5개 station, 10 vertex·8 triangle을 공유하는 instancing. 양면, `depthWrite=false` |
| 눈 | `renderOrder=15`. 앞쪽 표면에 둔 두 타원체, 깜빡임에 따라 높이 조절 |

### 셸: 두께 채우기

셸 index를 정규화한 높이 `ℓ=index/12`, 현재 몸체 vertex `B`, 원본 단위구 방향 `D`에 대해 CPU가 다음 위치를 만든다.

\[
S = B + D\left(0.5 + 29\ell^{1.3}\right)
\]

`ℓ=0`은 몸체 바로 위, `ℓ=1`은 29.5단위 밖이다. 지수 1.3은 안쪽 셸 간격을 더 좁게 둔다. 방향 `D`는 재계산한 normal이 아니라 원본 구 방향이다. 셸은 몸체 normal attribute를 공유하고 색·noise 조회용 `basePosition`도 현재 몸체 위치를 공유한다.

fragment에서 두 주파수의 3D noise로 coverage를 만든다. 안쪽은 촘촘하게, 바깥쪽은 성기게 하고 높이에 따른 alpha 감쇠를 곱한다. 옆을 향한 표면은 더 높은 alpha를 받는다. 이 noise는 현재 변형 몸체 위치에서 샘플링하므로 고정된 재료점을 완벽하게 추적하지는 않는다. 바깥 셸의 최종 alpha는 0이다.

### 리본: 한 가닥 그리기

고정 난수 seed `723981`로 단위구 방향을 면적 기준으로 균일하게 뽑는다. 길이·기울기·폭·휨은 초기화 때 한 번 정한다. 약 17%는 긴 가닥 분포를 사용하고 위쪽 털은 더 길게 만든다.

기준 뿌리 `R`, 단위구 방향 `(x,y,z)`, 길이 `L`, 옆 기울기 `k`에 대해 기준 끝은 다음 위치다.

\[
T = R + L(x+yk,\ y-xk,\ z)
\]

뿌리와 끝은 **뿌리의 같은 컨트롤 가중치**로 변형한다. 가닥마다 끝의 가중치를 다시 구하지 않으므로 움직일 때 뿌리와 끝이 다른 컨트롤을 따라 벌어지는 일을 줄인다.

vertex shader는 변형된 뿌리·끝을 view 공간으로 옮기고, 화면에 투영된 축의 수직 방향으로 리본 폭을 만든다. station은 `0, 0.22, 0.48, 0.73, 1`이다. 폭은 `(1-t)^1.4`, 휨은 `sin(πt)`를 사용하므로 끝이 뾰족하고 두 끝점의 휨은 0이다. 투영 축이 거의 0이면 화면 X 방향을 폭 방향으로 사용한다.

fragment shader는 가로 가장자리와 끝의 alpha를 줄인다. 원본 가닥 방향이 옆을 향할수록 더 잘 보이게 한다. 이는 실제 섬유의 광학·충돌 시뮬레이션을 대신하는 시각적 근사다.

## 6. 출력과 구조 보기

렌더러는 SRGB 출력과 `NoToneMapping`을 사용한다. 몸체·털의 조명은 ShaderMaterial 안에서 계산하고, scene의 Ambient/DirectionalLight는 구조 보기의 MeshStandardMaterial에 쓰인다.

출력 캔버스에는 화면 크기에 맞춘 CSS blur를 적용한다. 별도 framebuffer blur 패스는 없다. `몸체 메시`는 실제 변형 geometry의 wireframe을 겹치고, `변형 컨트롤`은 몸체의 영향 색과 13개 표시점을 보여준다. 영향 색은 실제 가중치의 네제곱을 다시 정규화해 컨트롤 영역이 잘 보이게 한 **설명용 색**이다. 컨트롤은 로컬 Z=0에 놓으며 연결선을 그리지 않는다. 두 구조 보기 모드에서는 털·눈을 숨기고 CSS blur를 해제한다.

## 7. 한계와 검증

CPU 비용은 몸체 vertex 수·털 가닥 수·컨트롤 수에, 셸의 GPU 비용은 셸 수와 화면에서 겹치는 fragment 수에 비례한다. 리본 instancing은 geometry와 draw call을 공유하지만 가닥별 CPU 변형은 여전히 수행한다.

셸 확장 방향은 변형된 표면의 실제 normal이 아니므로 강한 변형에서 두께가 일정하다는 보장은 없다. 투명 셸·리본은 정해진 순서로 그리며 모든 가닥을 깊이별로 정렬하지 않는다. 큰 회전·가까운 확대에서는 겹침과 평면 띠가 드러날 수 있다. 털 자체의 관성·충돌, 물리적 anisotropic scattering은 계산하지 않는다.

재확인 명령은 `pnpm test pages/soft-forms`, `pnpm typecheck`, `pnpm build`다. 테스트는 기준 pose 보존, 가중치 합, 측정 외곽선 fitting, 반복 위치·속도 연속성, 표면 접힘, 시간 대응, binding의 뿌리 inset·볼 돌출, 탭·긴 누름·pinch 계산을 확인한다.

화면에서는 기존 Chrome으로 다섯 캐릭터의 `?t=2.25` 렌더, 자동 반복, 누르기·회전, 구조 보기 전환을 확인한다. 두 손가락 입력은 실제 터치 장치에서도 별도로 확인할 수 있다. WebGL·shader 오류, 구조 보기에서 털이 남는 현상, 회전 중 뿌리가 몸체와 분리되는 현상을 함께 점검한다.
