# Cursive 공유 이미지

실제 작품의 무지개색 `hello`를 기존 Chrome에서 1200 × 630, DPR 1로 렌더링해 PNG로 캡처했다. 베이지 배경과 획의 곡선·그라데이션은 작품의 SVG 렌더러를 그대로 사용한다. 일반 기준은 [소셜 공유 이미지 제작](../../guides/social-share-images.md)을 따른다.

- 원본: `pages/cursive/assets/og-artwork.png`
- 최종 카드: `pages/cursive/assets/og-image.png`
- 재합성 도구: `scripts/cursive-social-image.html`
- 메타데이터·PNG 검사: `pages/cursive/social-preview.test.ts`

제목은 Pretendard Variable의 700 굵기, 52px, 색상 `#161616`이며 왼쪽 56px, 기준선 82px에 배치한다. 폰트는 기존 `pages/smile-flower/assets/PretendardVariable.woff2`를 재사용한다. 원본 이미지를 확대·축소하지 않고 제목만 합성한다.

## 재생성

1. 기존 Chrome에서 개발 서버의 `/cursive/`를 열고 1200 × 630, DPR 1로 맞춘다. 기본 텍스트 `hello`, 무지개, 두께 1을 사용한다.
2. 캡처 동안만 본문 높이를 630px, main 여백을 위 130px / 좌우 100px / 아래 55px, SVG를 1000 × 380px로 맞춘다. 입력 UI는 화면 아래 800px 위치로 옮기고 숨겨 로프의 하단 경계가 글씨를 밀어내지 않도록 한다. 디버그와 포인터를 제외한다.
3. 필기 완료 후 PNG로 캡처해 원본 경로에 저장하고 임시 스타일·화면 크기를 원상 복구한다. 일반 작품 코드에는 캡처 전용 설정을 남기지 않는다.
4. 개발 서버의 `/scripts/cursive-social-image.html`을 연다. 이미지와 폰트가 로드된 뒤 **PNG 다운로드**를 눌러 저장한 파일을 최종 카드 경로로 복사한다.
5. `pnpm test pages/cursive`, `pnpm typecheck`, `pnpm build`를 실행한다. 빌드의 `dist/pages/cursive/assets/og-image.png`와 원본의 해시가 같은지 확인한다.

공유 메타데이터는 `https://studio.jiiwon.com/cursive/`와 해당 주소의 `assets/og-image.png`를 사용한다. 공개 배포 전에는 실제 소셜 서비스의 링크 미리보기를 검증한 것으로 간주하지 않는다.
