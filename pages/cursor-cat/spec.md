# Cursor Cat

- 커서 방향을 따라 120개의 원형 시선 포즈를 표시한다.
- 기준 frame은 001 오른쪽, 031 위, 061 왼쪽, 091 아래다.
- 메인 경로는 R2 pack `main`을 사용한다.
- 정확히 10자리인 영문 소문자·숫자 서브 경로는 같은 ID의 R2 pack을 사용한다.
- pack은 flat WebP 120장과 manifest 하나만 가진다. runtime 이미지는 Git build에 포함하지 않는다.
- manifest가 눈 기준점과 표시 scale calibration을 제공한다.
- 모든 frame을 preload·decode한 뒤 pointer 상호작용을 시작한다.
- `?debug=1` 또는 `D` 키로 실제 frame 선택 경계와 눈→커서 방향을 확인한다.
- 모바일은 `dvh`를 사용해 고양이 아래를 현재 viewport 아래에 고정한다.

상세 구현은 [`../../docs/artworks/cursor-cat/architecture.md`](../../docs/artworks/cursor-cat/architecture.md), 제작 과정은 [`../../docs/artworks/cursor-cat/generation.md`](../../docs/artworks/cursor-cat/generation.md), 새 pack 등록은 [`../../docs/guides/cursor-cat-registration.md`](../../docs/guides/cursor-cat-registration.md)를 따른다.
