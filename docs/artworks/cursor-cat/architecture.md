# Cursor Cat 아키텍처

Cursor Cat은 커서 방향을 120장의 원형 시선 포즈 중 하나로 바꾸는 정적 웹 작품이다. HTML·TypeScript·CSS만 Git과 웹 빌드에 포함되고, 이미지 프레임은 Cloudflare R2에서 불러온다.

## 입력

런타임 입력은 세 가지다.

| 입력 | 형식 | 역할 |
| --- | --- | --- |
| 페이지 경로 | 메인 또는 10자리 ID | R2에서 불러올 작품 세트를 정한다. |
| R2 manifest | JSON | 프레임 수, 파일 패턴, 눈 기준점과 표시 scale을 제공한다. |
| pointer 좌표 | viewport CSS pixel | 현재 커서가 각 포즈의 눈 기준점에서 어느 방향인지 계산한다. |

경로 규칙은 다음과 같다.

- `/pages/cursor-cat/` → R2 pack `main`
- `/pages/cursor-cat/<10자리 영문 소문자·숫자>/` → 같은 ID의 R2 pack
- 형식이 다른 ID는 로드하지 않는다.

## R2 pack

한 pack은 하나의 prefix 아래에 필요한 파일만 평평하게 둔다.

```text
cursor-cat/<ID>/manifest.json
cursor-cat/<ID>/frame-001.webp
...
cursor-cat/<ID>/frame-120.webp
```

별도 poster 이미지는 두지 않는다. frame 001이 초기 poster와 오른쪽 포즈를 겸한다. canonical 이미지, 생성 영상, contact sheet와 처리 중간 PNG는 runtime에 필요하지 않으므로 R2와 Git에 올리지 않는다.

manifest에는 다음 값이 들어 있다.

- `id`, `version`, 이름과 접근성 문구
- 고정된 `frameCount: 120`
- `framePattern: frame-{frame}.webp`
- 방향별 눈 위치를 정규화한 `gazeOrigins`
- 생성 구간의 미세한 크기 차이를 보정하는 `displayScales`

`version`은 asset URL query에 들어가 메인 pack을 새로 올렸을 때 브라우저의 이전 프레임 cache를 무효화한다.

## 중간 상태

초기화는 다음 순서로 진행된다.

1. URL에서 `main` 또는 10자리 ID를 구한다.
2. R2 manifest를 가져와 schema, ID, 120-frame 계약과 calibration anchor를 검사한다.
3. frame 001을 표시해 poster-ready 상태가 된다.
4. 최대 8개 요청을 동시에 사용해 120장을 preload하고 decode한다.
5. 모든 이미지가 준비된 뒤에만 pointer 입력으로 target frame을 갱신한다.

페이지가 유지하는 주요 상태는 다음과 같다.

| 상태 | 의미 |
| --- | --- |
| `sources` | manifest와 version으로 만든 120개 R2 URL |
| `decodedFrames` | decode가 끝난 `HTMLImageElement` 120개 |
| `targetProgress` | 커서가 요구하는 원형 진행률 `[0, 1)` |
| `renderedProgress` | 화면에 부드럽게 수렴 중인 진행률 |
| `renderedFrame` | 현재 `<img>`가 표시하는 frame index |
| `gazeOriginAnchors` | 방향별 두 눈 사이의 정규화 위치 |
| `displayScaleAnchors` | 구간 seam을 보정하는 scale keyframe |

## 커서에서 프레임까지

각 frame `i`의 기대 시선 각도는 다음과 같다.

```text
angle(i) = -(i / 120) × 2π
```

화면의 y가 아래로 증가하므로 음의 각도가 오른쪽→위→왼쪽→아래 순서의 시계 반대 방향 회전을 만든다. 각 frame의 눈 기준점은 manifest anchor 사이를 보간한다.

pointer가 들어오면 120개 후보를 모두 비교한다.

1. 후보 frame의 정규화된 눈 기준점을 현재 이미지 bounds의 CSS pixel로 바꾼다.
2. 그 눈 기준점에서 pointer까지 `atan2` 각도를 구한다.
3. 후보의 기대 시선 각도와의 wrapped angular distance를 구한다.
4. 거리가 가장 작은 frame을 target으로 선택한다.

화면 중앙 하나를 모든 포즈에 공통으로 쓰지 않는 이유는 머리가 돌 때 두 눈 사이 위치도 함께 이동하기 때문이다. 특히 아래 포즈는 머리가 왼쪽으로 이동해 기준점 `x`가 약 0.43이다.

## 렌더 pass

매 animation frame에서 target과 rendered progress의 원형 최단 차이를 구한다. `120 → 001` 경계를 단순 뺄셈하면 거의 한 바퀴를 역주행하므로, 차이를 `[-0.5, 0.5)`에 wrap한다.

시간 delta를 반영한 response로 rendered progress를 target에 수렴시킨 다음 가장 가까운 정수 frame을 표시한다. 이미지 두 장을 섞거나 video seek를 하지 않는다. 항상 미리 decode된 WebP 한 장만 `<img>`에 표시한다.

manifest의 `displayScales`는 frame index 사이를 보간해 CSS transform에 적용한다. transform origin은 bottom center라서 미세 scale 보정 중에도 고양이 아래가 움직이지 않는다.

## 출력과 viewport

출력은 흰색 stage 위의 단일 투명 WebP다.

- stage 높이와 이미지 폭 계산에는 `dvh`를 사용한다.
- 모바일 주소창이 나타나거나 사라질 때 visual viewport 높이를 따라간다.
- 이미지와 stage의 bottom은 항상 현재 viewport bottom과 같다.
- 9:16 비율을 유지하되 폭은 viewport를 넘지 않는다.

## Process view

상단 `Angle / Frame / Final` 스테퍼는 production selection을 바꾸지 않고 같은 중간 상태를 단계별로 보여준다.

| 단계 | 보여주는 값 |
| --- | --- |
| `Angle` | 선택된 후보의 눈 기준점, pointer까지의 선, `atan2`로 측정한 시계 방향 각도 |
| `Frame` | 실제 selection 함수를 다시 표본화한 120개 원형 구간, 선택 구간과 frame 번호 |
| `Final` | guide가 없는 최종 WebP 출력과 원형 최단 경로 보간 |

`?stage=angle|frame|final`, 숫자키 `1…3`과 좌우 방향키로 단계를 바꾼다. Angle 단계가 선택된 frame의 눈 기준점을 쓰는 이유는 모든 포즈에 공통인 고정 중심이 없기 때문이다. Frame 단계의 원형 경계도 단순히 3° 간격으로 그리지 않고, 원 위의 각 표본을 production `pointerFrame()`에 넣어 실제로 frame이 바뀌는 위치에 tick을 그린다.

Process view는 관람자를 위한 설명이고 `?debug=1`은 calibration 검증용이다. 둘이 동시에 켜지면 target과 rendered 차이까지 포함한 Debug mode를 우선 표시한다.

## Debug mode

`?debug=1` 또는 `D` 키는 production과 같은 selection 함수를 시각화한다.

- 원형 tick: 실제 pointer 구간이 frame을 바꾸는 위치
- 파란 선: target frame의 눈 기준점과 pointer 연결
- 분홍 선: 현재 rendered frame의 시선 ray
- HUD: target/rendered frame, 각도와 진행 quarter

새 pack의 calibration은 이 mode에서 눈 기준점, 기준 방향과 seam을 확인한 뒤 확정한다.

## 경로와 cache 정책

- `main` manifest는 짧게 cache하고 player는 `no-store`로 요청해 교체를 빠르게 반영한다.
- frame은 1년 immutable cache를 사용한다. manifest의 새 version query가 같은 main key의 새 파일을 구분한다.
- 10자리 pack은 불변으로 취급해 manifest와 frame을 모두 장기 cache한다.
- 업로더는 120개 frame을 먼저 올리고 manifest를 마지막에 올린다. 따라서 공개 manifest가 불완전한 pack을 가리키는 시간을 만들지 않는다.

## 검증

변경 후 다음 순서로 확인한다.

1. 등록 스크립트의 dry-run으로 flat 120-frame 구성과 calibration을 검사한다.
2. R2 manifest와 001/031/061/091/120 응답을 확인한다.
3. Git의 local frame을 제거한 상태에서 페이지가 `is-ready`가 되는지 확인한다.
4. Chrome에서 console error가 없고 image URL host가 R2인지 확인한다.
5. 아래 pointer와 모바일 높이 변화를 debug mode에서 확인한다.
6. `pnpm typecheck`와 `pnpm build`를 실행한다.

## 한계

- 120장을 모두 준비한 뒤 상호작용을 시작하므로 첫 방문에 수 초가 걸릴 수 있다.
- public R2 개발 URL을 사용하므로 10자리 ID는 보안 경계가 아니다.
- Cloudflare Pages의 `_redirects`와 Vite fallback은 10자리 서브 경로를 같은 HTML로 rewrite한다. 단순 정적 파일 서버는 이 rewrite를 별도로 구성해야 한다.
