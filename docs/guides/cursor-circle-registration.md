# Cursor Circle 세트 등록

원형 시선 플레이어의 프레임은 Git이 아니라 Cloudflare R2의 `brand-artwork-cursor-animals` bucket에 보관한다. 플레이어 코드는 `pages/cursor-cat-circle/` 하나이며 경로 ID에 따라 다른 pack을 불러온다.

## 경로 규칙

- 기본 작품: `/pages/cursor-cat-circle/`
- 추가 작품: `/pages/cursor-cat-circle/<10자리 랜덤 ID>/`
- 기본 작품의 R2 ID는 `main`이다.
- 추가 작품은 등록 스크립트가 영문 소문자와 숫자로 된 10자리 ID를 만든다.
- 이름, 동물 종류와 순번을 공개 경로에 포함하지 않는다.

10자리 ID는 추측하기 어려운 공유 경로를 만들지만 인증이나 권한 제어는 아니다. 민감한 이미지는 public R2에 올리지 않는다.

## 입력

업로드할 source 폴더는 중첩 디렉터리 없이 최종 runtime frame만 담는다.

```text
circle-pack/
├── frame-001.webp
├── frame-002.webp
├── ...
└── frame-120.webp
```

별도 poster, canonical, endpoint와 생성 원본은 올리지 않는다. frame 001이 poster를 겸한다.

calibration JSON은 frame과 별도로 Git의 `config/`에 둘 수 있다.

```json
{
  "frameCount": 120,
  "gazeOrigins": [
    { "frame": 0, "x": 0.69, "y": 0.46 },
    { "frame": 30, "x": 0.51, "y": 0.33 },
    { "frame": 60, "x": 0.29, "y": 0.46 },
    { "frame": 90, "x": 0.43, "y": 0.77 },
    { "frame": 120, "x": 0.69, "y": 0.46 }
  ],
  "displayScales": [
    { "frame": 0, "scale": 1 },
    { "frame": 120, "scale": 1 }
  ]
}
```

anchor는 frame 0에서 시작해 frame 120에서 끝나야 하며 frame 번호가 증가해야 한다. `x`, `y`는 원본 이미지의 정규화 좌표다.

## 기본 작품 등록

먼저 dry-run으로 번호 누락과 calibration을 확인한다.

```bash
pnpm register:cursor-circle -- \
  --source .qa/cursor-cat-circle/pack \
  --name "Cursor Cat Circle" \
  --calibration config/cursor-cat-circle-main.json \
  --id main \
  --dry-run true
```

검증이 끝나면 `--dry-run`을 뺀다.

```bash
pnpm register:cursor-circle -- \
  --source .qa/cursor-cat-circle/pack \
  --name "Cursor Cat Circle" \
  --calibration config/cursor-cat-circle-main.json \
  --id main \
  --alt "커서를 바라보는 주황색 고양이"
```

## 추가 작품 등록

추가 작품은 `--id`를 생략한다.

```bash
pnpm register:cursor-circle -- \
  --source /path/to/flat-circle-pack \
  --name "Cursor Puppy Circle" \
  --calibration /path/to/puppy-calibration.json \
  --alt "커서를 바라보는 강아지"
```

완료 출력의 `id`와 `route`를 기록한다. 예를 들어 ID가 `a1b2c3d4e5`라면 공개 경로는 `/pages/cursor-cat-circle/a1b2c3d4e5/`다.

## R2 결과

등록 스크립트가 만드는 object는 pack당 121개다.

```text
cursor-cat-circle/<ID>/manifest.json
cursor-cat-circle/<ID>/frame-001.webp
...
cursor-cat-circle/<ID>/frame-120.webp
```

frame은 먼저 병렬 업로드하고 manifest는 마지막에 올린다. manifest에는 매 업로드마다 새 `version`이 들어간다.

## 운영 원칙

- `main`은 현재 기본 작품을 갱신할 때만 덮어쓴다.
- 10자리 ID는 불변 pack으로 취급한다. 작품을 수정하면 새 ID로 다시 등록한다.
- R2 업로드를 확인한 뒤 runtime frame을 Git에 추가하지 않는다.
- 생성 영상, canonical 이미지, contact sheet와 중간 PNG는 R2 runtime prefix에 올리지 않는다.
- public R2 CORS는 GET과 HEAD만 허용한다.
- 완료 후 manifest와 기준 frame 001/031/061/091/120을 확인하고, 실제 페이지가 120장을 모두 decode하는지 확인한다.
