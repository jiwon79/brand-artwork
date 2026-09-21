# 장밋빛 유리 소셜 공유 이미지

장밋빛 유리의 소셜 카드는 생성형 이미지가 아니라 작품 페이지에서 직접 캡처한 WebGL 렌더를 사용한다. 최종 파일은 `pages/apple-glass-wallpaper/assets/og-image.png`이며 1200 × 630 PNG다.

## 구성

- 원본: `pages/apple-glass-wallpaper/assets/og-artwork.png`
- 최종 카드: `pages/apple-glass-wallpaper/assets/og-image.png`
- 합성 도구: `scripts/rose-glass-social-image.html`
- 합성 로직: `scripts/rose-glass-social-image.mjs`

원본은 조작 UI와 단계 표시를 숨긴 1200 × 630 브라우저 화면이다. 세 겹의 유리와 자동 조명을 그대로 보존하고, 왼쪽 위에 `장밋빛 유리` 제목만 반투명 흰색 라벨로 더한다. 제목색은 작품의 어두운 장밋빛을 가져온 `#593d44`다.

## 재생성

1. 작품 페이지를 1200 × 630, DPR 1로 열고 단계 표시와 디버그 UI를 숨긴다.
2. 실제 WebGL 화면을 `assets/og-artwork.png`로 캡처한다.
3. 개발 서버에서 `/scripts/rose-glass-social-image.html`을 연다.
4. 캔버스가 준비되면 `PNG 다운로드`를 눌러 결과를 `assets/og-image.png`에 둔다.
5. `pnpm vitest run scripts/rose-glass-social-image.test.ts pages/apple-glass-wallpaper/social-preview.test.ts`와 `pnpm build`를 실행한다.

합성기는 원본 크기가 정확히 1200 × 630이 아니면 중단한다. 카드의 URL, 크기, PNG 형식은 작품 HTML의 정적 Open Graph와 Twitter 메타데이터에 함께 선언한다.
