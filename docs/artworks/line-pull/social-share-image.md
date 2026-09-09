# Line Pull 공유 이미지

실제 작품에서 “안녕하세요”가 드러난 PNG 캡처의 왼쪽 위에 작품명만 합성한다. 다른 작품의 공유 이미지와 동일하게 시리즈명·회차는 넣지 않는다. 생성형 이미지나 JPEG 중간 파일은 사용하지 않는다. 일반 제작 기준은 [소셜 공유 이미지 제작](../../guides/social-share-images.md)을 따른다.

## 파일과 역할

- 캡처 원본: `pages/line-pull/assets/og-artwork.png`
- 최종 공유 카드: `pages/line-pull/assets/og-image.png`
- 제작 화면: `scripts/line-pull-social-image.html`
- 합성 코드: `scripts/line-pull-social-image.mjs`
- 합성 단위 테스트: `scripts/line-pull-social-image.test.ts`
- 공유 메타데이터와 PNG 검사: `pages/line-pull/social-preview.test.ts`

원본과 출력은 모두 1200 × 630이다. 합성은 원본을 크기 변경 없이 그린 뒤 상단 144px에만 어두운 그라디언트와 텍스트를 얹는다. 왼쪽 위에 `Line Pull` 한 줄만 배치하고 오른쪽에는 텍스트를 넣지 않는다. 붉은 틈·인사말·접힌 선은 아래 영역에 있어 합성 대상에서 제외된다.

폰트는 작품에 포함된 Pretendard ExtraBold를 사용한다. 제목은 52px이며 왼쪽 여백은 56px이다. 이미지 디코딩과 폰트 로딩이 끝난 후에만 PNG 다운로드 버튼이 활성화된다.

## 재생성

1. 실행 중인 개발 서버를 재사용하거나 `pnpm dev`로 시작한다.
2. 기존 Chrome 창에서 개발 서버의 `/scripts/line-pull-social-image.html`을 연다. 기본 포트 기준 주소는 `http://127.0.0.1:4173/scripts/line-pull-social-image.html`이다.
3. 제목을 바꾸려면 합성 모듈의 `socialImage`를 수정한다. PNG 준비 완료 표시와 미리보기의 글자·여백을 확인한다.
4. **PNG 다운로드**를 눌러 `line-pull-og-image.png`를 저장하고 최종 공유 카드 경로에 반영한다. 화면 전체를 다시 스크린샷으로 저장하지 않는다.
5. 제목을 변경했다면 `index.html`의 Open Graph·Twitter 대체 텍스트와 관련 테스트도 함께 수정한다.
6. `pnpm test`, `pnpm typecheck`, `pnpm build`를 실행하고 배포용 PNG가 동일하게 복사됐는지 확인한다.

작품 자체의 폰트·색상·구도가 바뀌면 원본 캡처를 먼저 갱신한다. 원본 대신 이미 텍스트가 합성된 최종 카드를 입력으로 쓰면 안 된다.

이 제작 화면은 개발 서버용 도구이며 작품의 진입점이 아니다. 실제 작품의 입력·애니메이션 코드에는 합성 도구를 연결하지 않으며, 공유 카드는 정적 메타 태그를 통해서만 사용된다.
