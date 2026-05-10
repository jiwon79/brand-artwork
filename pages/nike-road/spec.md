# Nike Road Brand Artwork — 스펙

## 1. 파일 구성

- **index.html** - HTML 구조 (semantic, 모든 로직은 외부 모듈로 분리)
- **style.css** - 스타일시트 (외부 파일)
- **script.ts** - TypeScript 메인 로직 (모듈)
- **/common/touch-cursor.ts** - 공통 터치 커서 기능 (모듈)

## 2. 컨셉

마이클 조던의 "나는 9,000번 실패했다"는 명언에서 영감을 받은 interactive 애니메이션.
"실패는 길이 된다" (Failures Become the Road)

## 3. 장면

### HTML 구조
- **#stage** - 360×640px 뷰포트 컨테이너
  - **#sky** - 하늘 배경 (gradients + SVG noise texture)
  - **#scene** - 캔버스 (볼과 지형 렌더링)
  - **#hook** - 명언 텍스트 (위)
  - **#jdi** - "Just Do It." 텍스트 (중앙, 애니메이션)
  - **#jdi-kr** - "실패는 길이 된다." 텍스트 (하단, 애니메이션)
- **#timer** - 경과 시간 표시 (우상단)
- **#debug** - 디버그 정보 (좌상단)
- **#controls** - 버튼 그룹 (하단)
  - **#btn-play** - 재생
  - **#btn-reset** - 초기화
  - **#btn-debug** - 디버그 토글

### 애니메이션 타임라인 (12초)
- 0-1s: 명언 표시, 볼 등장
- 1-2s: 명언 페이드 아웃, 볼 페이드 인
- 2-9s: 물리 시뮬레이션 (볼이 단어 위에서 굴러감)
- 9-10s: 볼과 단어 페이드 아웃
- 10-11.5s: "Just Do It." 텍스트 모핑 (도로 텍스처 기반)
- 11.5-12s: 한글 텍스트 페이드 인
- 12s+: 최종 상태 유지

### 물리 엔진
- **중력**: 280px/s²
- **플랫폼**: 회전된 단어들 (각도 18°, -22°, 25°, -20°)
  - "failures" → "become" → "the" → "road"
  - 각 단어는 기울어진 플랫폼으로 작동
  - 볼이 착지하면 표면을 따라 굴러감
  
### 렌더링
- 도로 텍스처: asphalt + trail mask 합성
- 텍스트 모핑: jdiMask로 "Just Do It." 형태 생성
- 트레일: 볼의 궤적을 22px 너비 선으로 렌더링
