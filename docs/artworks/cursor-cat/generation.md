# Cursor Cat 프레임 제작

이 문서는 현재 원형 고양이 세트를 만들며 확인한 문제와 재현 절차를 기록한다. 런타임과 R2 구조는 [`architecture.md`](./architecture.md), 새 세트 등록 절차는 [`../../guides/cursor-cat-registration.md`](../../guides/cursor-cat-registration.md)를 따른다.

## 목표 결과

- 화면 좌표 기준 `RIGHT → TOP → LEFT → BOTTOM → RIGHT` 한 바퀴를 120개 포즈로 표현한다.
- 프레임 001, 031, 061, 091이 각각 오른쪽, 위, 왼쪽, 아래의 기준 포즈다.
- 모든 프레임은 576 × 1024의 같은 9:16 구도이며 고양이 몸통 아래가 캔버스 아래에 고정된다.
- 최종 배경은 CSS의 `#FFFFFF`가 비치도록 투명하고, 고양이 부분만 불투명하다.
- Git과 R2에는 생성 원본 영상이나 레퍼런스 이미지를 보관하지 않는다. R2에는 실제 재생에 필요한 최종 WebP 120장만 둔다.

## 생성 전에 고정할 것

영상 모델은 단순히 시작·끝 이미지를 주어도 정체성, 속도, 크기와 조명을 각각 바꿀 수 있다. 다음 항목을 프롬프트와 검수에서 동시에 고정한다.

| 항목 | 확인 기준 |
| --- | --- |
| 방향 | 모델 기준이 아니라 화면 좌표의 LEFT, RIGHT, TOP, BOTTOM으로 쓴다. |
| 정체성 | 주황·흰 털 경계, 비대칭 얼굴 무늬와 줄무늬가 좌우로 바뀌지 않아야 한다. |
| 움직임 | 머리, 눈동자와 귀만 필요한 만큼 움직이고 몸통·어깨·카메라는 고정한다. |
| 얼굴 | 두 눈을 가능한 한 계속 보이게 하고 졸린 표정, 의도적인 눈 깜빡임과 과도한 숙임을 금지한다. |
| 구도 | 얼굴, 양쪽 귀, 코, 턱, 수염이 9:16 프레임 밖으로 나가지 않아야 한다. |
| 크기 | 줌, 재구도와 몸통 흔들림을 금지한다. 기준 프레임 사이의 얼굴 크기를 비교한다. |
| 색 | 노출, 화이트밸런스, 대비와 채도를 고정하고 중간 프레임의 회색·노란 색 이동을 확인한다. |
| 배경 | 그림자, 바닥, 그라데이션 없이 평평한 흰색을 요구한다. 최종 단계에서는 연결된 배경을 투명화한다. |

왼쪽 포즈를 오른쪽 포즈의 수평 반전으로 만들면 비대칭 무늬까지 반전되므로 사용하지 않는다. 각 방향 이미지는 동일한 개체를 유지하는 편집 결과여야 한다.

## 현재 사용한 생성 구성

현재 세트는 Comfy Cloud의 Seedance 2.0 first/last-frame 흐름에서 만든 세 영상을 사용한다.

| 구간 | 입력 고정점 | 출력 설정 | 사용 방식 |
| --- | --- | --- | --- |
| 오른쪽 → 위 | 오른쪽, 위 | 4초, 24fps | 시간상 정지가 있어 수동 source index로 29개 중간 포즈를 선택한다. |
| 위 → 왼쪽 | 위, 왼쪽 | 4초, 24fps | 위쪽 hold와 후반 감속을 제외한 수동 index로 29개 중간 포즈를 선택한다. |
| 왼쪽 → 아래 → 오른쪽 | 왼쪽, 오른쪽 | 720p, 9:16, 4초, 24fps, 97 frames | 59개 중간 포즈만 선택해 아래 반원을 만든다. |

아래 반원에 사용한 Seedance seed는 `569956546`이다. 오디오와 워터마크는 끈다.

### 위쪽 반원 프롬프트 핵심

```text
Create one smooth continuous UPPER semicircular head-and-eye tracking motion in SCREEN coordinates: RIGHT → TOP → LEFT. Keep the exact cat identity, asymmetric markings, body, camera, crop, face scale, exposure, and flat pure white background fixed. Never look downward, blink, zoom, reframe, mirror, or sway the torso.
```

### 아래쪽 반원 프롬프트 핵심

```text
Create one smooth continuous LOWER semicircular head-and-eye tracking motion in SCREEN coordinates: LEFT → BOTTOM → RIGHT. At 50% look clearly toward the BOTTOM EDGE with both eyes naturally visible. Keep the exact cat identity, asymmetric markings, body, camera, crop, face scale, exposure, white balance, contrast, saturation, and flat pure white background fixed. Never look upward, blink, zoom, reframe, mirror, or sway the torso.
```

모델이 프롬프트의 `50%`를 정확한 시간 중간점으로 지킨다고 가정하지 않는다. 최종 방향은 실제 프레임을 보고 결정한다.

## 시간 대신 시선 각도로 샘플링하기

97-frame 영상에서 매 두 번째 프레임을 고르는 것만으로는 3° 간격이 되지 않는다. 모델은 시작·끝에서 멈추거나 구간마다 회전 속도를 바꾸기 때문이다.

현재 processor는 다음 원칙을 쓴다.

- 오른쪽 → 위는 `RIGHT_POSE_FRAMES`의 수동 native index를 사용한다.
- 위 → 왼쪽은 긴 위쪽 hold를 건너뛴 `LEFT_POSE_FRAMES`를 사용한다.
- 아래 반원은 실제 아래 포즈를 먼저 찾은 뒤 왼쪽→아래와 아래→오른쪽을 별도로 균등 샘플링한다.
- 현재 아래 포즈는 시간 중간인 native frame 49가 아니라 frame 55다. 따라서 frame 55가 runtime frame 091이 되도록 양쪽 30-step을 따로 계산한다.
- optical flow, crossfade와 합성 중간 프레임은 만들지 않는다. 실제 생성 영상의 단일 native frame만 사용한다.

이 보정을 하지 않으면 커서가 정확히 아래에 있어도 고양이는 아직 왼쪽 아래를 보는 프레임을 표시한다.

## 색, 배경과 크기 보정

### 색감

주황 털과 흰 털을 별도로 측정한다.

- 주황 털: 중간 밝기의 주황 픽셀에서 luminance와 saturation을 측정한다.
- 흰 털: 배경보다 어둡고 채도가 낮은 픽셀에서 luminance와 RGB balance를 측정한다.
- 각 중간 프레임의 목표값은 양 끝 기준 프레임 사이를 보간한다.
- 밝기, 채도와 red/blue balance를 반복 보정해 비디오 모델 특유의 프레임별 노출 흔들림을 줄인다.

배경 흰색을 측정에 섞으면 고양이 털 보정이 약해지므로, 흰 털 표본은 순백 배경보다 어두운 범위로 제한한다.

### 배경

손실 WebP의 흰 배경은 디코딩할 때 RGB 252–253이 되어 CSS 흰색과 경계가 생길 수 있다. 캔버스 가장자리에서 시작한 flood fill이 밝고 저채도인 연결 영역만 찾아 alpha 0으로 바꾼다.

- flood fill은 가장자리와 연결된 픽셀만 제거한다.
- 고양이 내부의 흰 털과 눈 하이라이트는 가장자리 배경과 연결되지 않으므로 남는다.
- 페이지는 투명 프레임을 CSS `#FFFFFF` 위에 합성한다.

### 크기

생성 구간의 작은 크기 차이는 런타임 calibration의 `displayScales`로 보정한다. 현재 위→왼쪽 구간은 0.7% 작게 표시하고, 아래 반원에서 다시 1로 완만하게 돌아온다. 1% 미만의 차이도 기준 방향 seam에서는 갑작스러운 확대처럼 보이므로 접점마다 확인한다.

## 처리 명령

생성 영상과 canonical 방향 이미지는 Git 밖의 작업 폴더에 둔다. processor는 최종 120장만 flat output 폴더에 만든다.

```bash
pnpm process:cursor-cat -- \
  --right-video .qa/cursor-cat/source/right-to-top.mp4 \
  --left-video .qa/cursor-cat/source/top-to-left.mp4 \
  --lower-video .qa/cursor-cat/source/left-bottom-right.mp4 \
  --right-image .qa/cursor-cat/source/right.webp \
  --top-image .qa/cursor-cat/source/top.webp \
  --left-image .qa/cursor-cat/source/left.webp \
  --output .qa/cursor-cat/pack
```

출력은 `frame-001.webp`부터 `frame-120.webp`까지만 있어야 한다. R2 업로드 명령은 등록 가이드를 따른다.

## 시선 기준점 보정

커서 방향은 화면 중앙이 아니라 각 포즈의 두 눈 사이에서 계산한다. 기준점은 이미지의 576 × 1024 좌표를 `[0, 1]`로 정규화해 [`../../../config/cursor-cat-main.json`](../../../config/cursor-cat-main.json)에 기록한다.

| runtime frame | 방향 | 눈 기준점 `(x, y)` |
| --- | --- | --- |
| 001 | 오른쪽 | `(0.69, 0.46)` |
| 031 | 위 | `(0.51, 0.33)` |
| 061 | 왼쪽 | `(0.29, 0.46)` |
| 091 | 아래 | `(0.43, 0.77)` |
| wrap 121 = 001 | 오른쪽 | `(0.69, 0.46)` |

중간 프레임은 두 인접 기준점 사이를 선형 보간한다. 아래 포즈의 머리가 화면 왼쪽으로 이동했기 때문에 아래 기준점의 `x`는 0.5가 아니다. 이 값을 화면 중앙으로 강제하면 아래 대각선에서 시선과 커서가 어긋난다.

## 검증 순서

1. 120개 파일이 연속 번호이며 중복·누락이 없는지 확인한다.
2. 001/031/061/091이 오른쪽/위/왼쪽/아래인지 한 장씩 확인한다.
3. 네 seam 주변과 아래쪽 087–095를 contact sheet로 확인한다.
4. 디버그 모드에서 실제 눈 기준점에서 커서까지의 선과 표시 프레임의 시선이 일치하는지 확인한다.
5. 배경 모서리 alpha가 0이고 흰 털이 불투명하게 남는지 확인한다.
6. 390 × 844와 더 낮은 모바일 높이에서 고양이 아래가 viewport 아래와 같은지 확인한다.
7. R2 등록 뒤 로컬 프레임 폴더를 제거한 상태에서 120장을 모두 preload·decode하는지 확인한다.

## 현재 방식의 한계

- 시선 기준점은 자동 눈 검출값이 아니라 실제 프레임을 보고 정한 calibration이다. 새 동물·새 구도는 값을 다시 측정해야 한다.
- 영상 모델의 머리 이동이 크면 선형 보간한 눈 기준점이 모든 중간 프레임을 완벽히 통과하지 않는다. 디버그 ring에서 오차가 큰 구간에는 anchor를 추가할 수 있다.
- 120장을 모두 preload하므로 첫 방문의 네트워크 비용과 준비 시간이 있다. 프레임 수를 줄일 때는 방향 간격보다 seam과 빠른 머리 회전 구간을 먼저 보존한다.
- 랜덤 서브 경로는 인증이 아니다. URL을 아는 누구나 public R2 프레임을 읽을 수 있다.
