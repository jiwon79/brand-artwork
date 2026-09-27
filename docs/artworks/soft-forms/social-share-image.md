# 솜결 · Soft Forms 공유 이미지

별 캐릭터가 정면으로 떠 있는 실제 WebGL 장면을 1200 × 630 PNG로 캡처한다. 캡처에서는 형태 선택 UI만 숨겼고, 캐릭터·색상·그림자·솜털은 작품 렌더링 그대로다. 캡처 원본과 제목이 합성된 최종 카드를 분리한다.

- 원본: `pages/soft-forms/assets/og-artwork.png`
- 최종 카드: `pages/soft-forms/assets/og-image.png`
- 합성 화면: `scripts/soft-forms-social-image.html`
- 합성 코드: `scripts/soft-forms-social-image.mjs`

왼쪽 위에 Pretendard Variable로 한글 제목 `솜결`을 700 굵기, 52px, (56, 82)에 놓고 영어 제목 `Soft Forms`를 500 굵기, 28px, (58, 124)에 놓는다. 제목 색은 `#f8f5ff`다. 별의 몸체와 겹치지 않는 어두운 배경 영역이므로 별도 배경 패널은 사용하지 않는다. 폰트 파일은 기존 `pages/rose-glass/assets/PretendardVariable.woff2`를 함께 사용한다.

다시 만들 때는 [공통 제작 절차](../../guides/social-share-images.md)에 따라 기존 Chrome에서 `/soft-forms/?shape=star&t=2`를 1200 × 630, DPR 1로 캡처하고 형태 선택 UI를 제외한 원본 PNG를 교체한다. 개발 서버의 `/scripts/soft-forms-social-image.html`에서 최종 이미지를 직접 PNG로 내보낸다. 포스터 제작을 위해 페이지에 영구적인 캡처 전용 UI나 스타일을 추가하지 않는다.
