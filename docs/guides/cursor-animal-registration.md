# Cursor Animal 등록

동물별 프레임은 Git 저장소가 아니라 Cloudflare R2의 `brand-artwork-cursor-animals` 버킷에 보관한다. 저장소의 [`pages/cursor-cat/`](../../pages/cursor-cat/)은 모든 동물이 공유하는 플레이어다.

## 경로 규칙

- 기본 작품: `/pages/cursor-cat/`
- 추가 작품: `/pages/cursor-cat/<10자리 랜덤 ID>/`
- 기본 작품의 R2 ID는 `main`이다.
- 추가 작품의 ID는 등록 스크립트가 생성한다. 이름이나 동물 종류를 URL에 포함하지 않는다.

플레이어는 현재 URL에서 ID를 읽고 다음 매니페스트를 불러온다.

```text
https://pub-4af95f9afe1340909f813a419a6d8208.r2.dev/cursor-cat/<ID>/manifest.json
```

## 입력 폴더

등록할 폴더는 다음 구조를 사용한다.

```text
animal-pack/
├── poster.webp
├── center.webp
├── endpoints/
│   ├── left.png
│   └── right.png
├── references/
│   └── center.png
└── frames/
    ├── upper/frame-002.webp ... frame-048.webp
    ├── lower/frame-002.webp ... frame-048.webp
    ├── center-left/frame-002.webp ... frame-023.webp
    ├── center-right/frame-002.webp ... frame-023.webp
    ├── center-top/frame-002.webp ... frame-023.webp
    └── center-bottom/frame-002.webp ... frame-023.webp
```

호의 양 끝은 `endpoints/left.png`와 `endpoints/right.png`를 공유하고, 방사형 경로는 `center.webp`와 각 방향의 끝점을 공유한다. 따라서 프레임 폴더에는 중간 프레임만 둔다.

## 등록

기본 작품은 ID를 명시한다.

```bash
pnpm register:cursor-animal \
  --source pages/cursor-cat/assets \
  --name "Cursor Cat" \
  --id main \
  --alt "커서를 바라보는 주황색 고양이"
```

추가 작품은 `--id`를 생략한다.

```bash
pnpm register:cursor-animal \
  --source /path/to/animal-pack \
  --name "Cursor Puppy" \
  --alt "커서를 바라보는 강아지"
```

스크립트는 파일 구성과 프레임 번호를 검사하고, 추가 작품에는 10자리 랜덤 ID를 부여한다. 에셋을 먼저 업로드하고 `manifest.json`을 마지막에 올려 불완전한 버전이 공개되지 않게 한다. 완료되면 최종 웹 경로를 출력한다.

## 운영 원칙

- 발급된 랜덤 ID는 불변 버전으로 취급한다.
- 같은 작품을 수정하면 기존 ID를 덮어쓰지 않고 새 ID로 등록한다.
- `main`만 필요할 때 같은 ID로 교체할 수 있다.
- 업로드 검증이 끝난 프레임은 Git에 추가하지 않는다.
- R2 매니페스트가 올라간 뒤 해당 URL에서 185개 포인터 이미지가 모두 로드되는지 확인한다.
