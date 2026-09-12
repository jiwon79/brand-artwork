# 꽃웃음 재현 가이드

이 문서는 Blender에서 꽃과 스마일 모델을 만들고, 웹용 GLB로 변환해 Three.js 화면에서 반복 배치하는 과정을 처음부터 따라 하기 위한 안내서다.

## 준비물

- Blender 4.x
- Node.js와 pnpm
- WebGL을 지원하는 Chrome
- 이 저장소 또는 Notion 문서에 첨부된 `smile-flower-source.zip`

## 1. 프로젝트 설치

압축 파일을 풀거나 저장소를 clone한 뒤 프로젝트 루트에서 실행한다.

```bash
pnpm install
pnpm dev --host 0.0.0.0
```

브라우저에서 `/pages/smile-flower/`를 연다. 화면에는 UI 없이 작품만 보이며 `D`를 누르면 조정 패널이 열린다.

## 2. Blender 원본 확인

다음 파일을 Blender에서 연다.

- `pages/smile-flower/assets/flower.blend`
- `pages/smile-flower/assets/smiley.blend`

꽃은 5개의 두꺼운 꽃잎, 직선 장식과 점, 원통형 중앙, 6엽 음각과 돌출된 작은 원으로 구성된다. 스마일은 두꺼운 원판에 눈과 입이 관통된 구조다.

웹 카메라가 보는 앞면은 GLB의 `+Z`다. 생성 스크립트 내부에서는 Blender의 `-Y` 앞면을 마지막에 회전해 이 방향에 맞춘다. 모델을 직접 수정할 때 앞뒤 방향을 바꾸면 웹 회전축과 정면이 어긋난다.

## 3. 생성 스크립트로 원본 다시 만들기

Blender 실행 파일 위치가 PATH에 등록되어 있다면 프로젝트 루트에서 다음 명령을 실행한다.

```bash
blender --background --python pages/smile-flower/create_flower.py
blender --background --python pages/smile-flower/create_smiley.py
```

macOS에서 `blender` 명령을 찾지 못하면 다음 경로를 사용한다.

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python pages/smile-flower/create_flower.py
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python pages/smile-flower/create_smiley.py
```

각 스크립트는 `.blend` 편집 원본과 고해상도 `.glb`를 `assets/`에 쓴다. 기존 파일을 덮어쓰므로 수정본이 필요하면 먼저 다른 이름으로 복사한다.

## 4. 형태를 수정할 위치

### 꽃

`create_flower.py` 상단의 값과 함수가 주요 형태를 결정한다.

- `PETAL_THICKNESS`, `PETAL_LIP`: 꽃잎 두께와 둥근 가장자리
- `petal_surface(u, v)`: 꽃잎의 bowl, cushion과 비틀림
- `CENTER_LOBES`: 중앙 음각 잎 수
- `core_surface(radius, angle)`: 중앙 음각과 돌출 원의 높이
- `make_center_cup(...)`: 원통 벽, pale rim과 중앙 재질 경계

### 스마일

`create_smiley.py`의 값이 전체 비율을 결정한다.

- `DEPTH`, `RIM_RADIUS`: 원판 두께와 둥근 테두리
- `EYE_WIDTH`, `EYE_HEIGHT`, `EYE_SPACING`: 눈 구멍
- `MOUTH_RADIUS`, `MOUTH_WIDTH`: 입 곡선

수치를 바꾼 뒤 3단계 명령을 다시 실행하면 Blender 원본이 갱신된다.

## 5. 웹용 모델 만들기

편집 원본을 만든 뒤 웹용 변환을 실행한다.

```bash
blender --background --python pages/smile-flower/export_web_models.py
```

이 단계는 다음 작업을 수행한다.

1. 꽃의 작은 틈과 접촉 부위 음영을 vertex color에 기록한다.
2. 스마일 mesh를 화면 실루엣이 유지되는 범위에서 줄인다.
3. normal을 정리해 평평한 앞면과 둥근 edge의 조명을 구분한다.
4. non-manifold edge 수와 signed volume을 검사한다.
5. `flower-web.glb`, `smiley-web.glb`를 생성한다.

검증 assertion이 실패하면 웹 파일을 사용하기 전에 Blender 원본의 열린 edge, 뒤집힌 face 또는 0 이하 volume을 고친다.

## 6. 웹에서 모델을 불러오는 원리

`script.ts`는 `GLTFLoader`로 두 GLB를 한 번씩 읽는다. GLB 안의 각 mesh geometry에 world matrix를 적용하고 깊이 중심을 0으로 옮긴 뒤, 웹용 `MeshPhysicalMaterial`을 새로 만든다.

```ts
const gltf = await loader.loadAsync(assets[model]);
const geometry = object.geometry
  .clone()
  .applyMatrix4(object.matrixWorld)
  .translate(0, 0, -depthCenter);
```

같은 geometry를 84번 복제하지 않는다. `InstancedMesh` 한 개가 geometry와 material을 공유하고 각 cell의 matrix와 color만 저장한다.

## 7. 배치와 색 바꾸기

`reference-layout.ts`에서 행별 color 문자열과 petal 문자열을 바꾸면 각 위치의 색이 달라진다. 좌표는 720 × 1280 레퍼런스를 60으로 나눈 값이다.

```ts
x = (referencePixelX - 360) / 60
y = (640 - referencePixelY) / 60
```

기본 palette도 같은 파일에 있다. 전체 채도, material과 조명은 페이지에서 `D`를 눌러 조정한다. 값은 메모리에만 있으므로 마음에 드는 조합은 패널의 `설정 복사`로 JSON을 복사한 뒤 `createLook()`의 기본값에 반영한다.

## 8. 움직임 조정하기

`rotation-settings.ts`는 다음 기본값을 가진다.

```ts
{
  dragSpeed: 0.5,
  dragAmount: 0.5,
  releaseSpeed: 1.6,
  releaseTurns: 1,
  waveSpeed: 1.2,
  waveDeceleration: 1,
}
```

- `dragSpeed`: 드래그 뒤 관성 애니메이션의 시간 배수
- `dragAmount`: 포인터 속도가 전달하는 회전 에너지 배수
- `releaseSpeed`: 길게 누른 뒤 놓았을 때 개별 모델의 회전 속도
- `releaseTurns`: 놓기 파동의 바퀴 수
- `waveSpeed`: 파동의 초기 전파 속도 배수
- `waveDeceleration`: 거리가 멀어질수록 추가되는 지연 강도

`waveSpeed`와 `releaseSpeed`는 역할이 다르다. 전자는 다음 모델이 언제 출발하는지를 바꾸고, 후자는 출발한 한 모델이 한 바퀴를 도는 시간을 바꾼다.

## 9. 확인 체크리스트

- [ ] 첫 화면에 꽃 84개가 9:16으로 보인다.
- [ ] 천천히 드래그하면 적게, 빠르게 드래그하면 많이 회전한다.
- [ ] 길게 누르면 중심 모델이 커지고 주변은 연속적으로 작아진다.
- [ ] 누른 채 움직이면 확대 중심이 포인터를 따라간다.
- [ ] 놓으면 가까운 모델부터 즉시 시작해 바깥으로 갈수록 느리게 퍼진다.
- [ ] 회전이 끝나면 모든 모델이 꽃 또는 스마일 정면에 정확히 안착한다.
- [ ] `D`로 패널을 열고 닫을 수 있다.
- [ ] `pnpm typecheck`와 `pnpm build`가 통과한다.

## 10. 더 읽기

- [현재 구현의 전체 데이터 흐름](./architecture.md)
- `pages/smile-flower/` 아래의 TypeScript와 Blender Python 소스
- `docs/assets/smile-flower-pipeline.drawio`: 수정 가능한 파이프라인 그림
