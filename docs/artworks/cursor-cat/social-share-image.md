# Cursor Cat 공유 이미지

기존 Chrome에서 실제 작품을 1200×630 PNG로 캡처한 원본은 `pages/cursor-cat/assets/og-artwork.png`에 보존한다. 최종 `og-image.png`는 원본 위 왼쪽 상단에 `Cursor Cat` 제목을 합성한다. 원본의 고양이와 흰 배경은 그대로 유지한다.

제목은 Pretendard Variable 52px, 굵기 700(Bold)을 사용한다. 왼쪽 여백은 56px, 글자 기준선은 위에서 82px이며 색상은 `#161616`이다. 정확한 굵기가 실제 윤곽에 반영되도록 `pages/cursor-cat/assets/PretendardVariable.woff2`를 사용한다. 이 값들은 공통 가이드의 기본 제목 규칙을 따른다.

## 재생성

1. 개발 서버를 시작하고 기존 Chrome에서 `/scripts/cursor-cat-social-image.html`을 연다.
2. PNG 준비 완료 표시와 제목 배치를 확인한다.
3. **PNG 다운로드**를 눌러 받은 `cursor-cat-og-image.png`를 `pages/cursor-cat/assets/og-image.png`에 반영한다.
4. `pnpm test pages/cursor-cat`, `pnpm typecheck`, `pnpm build`로 검증한다.

합성 값은 `scripts/cursor-cat-social-image.mjs`에서 관리한다. 원본 크기가 다르면 합성을 거부하며, 폰트와 이미지 디코딩 후 Canvas에서 PNG를 직접 출력한다. 작품을 다시 캡처할 때는 [공통 제작 가이드](../../guides/social-share-images.md)를 따른다.
