# Nike Road Brand Artwork — 스펙

## 1. 파일 구성

- **index.html** - HTML 구조 (semantic, 모든 로직은 외부 모듈로 분리)
- **style.css** - 스타일시트 (외부 파일)
- **script.ts** - TypeScript 메인 로직 (모듈)
- **/common/touch-cursor.ts** - 공통 터치 커서 기능 (모듈)

## 2. 컨셉

마이클 조던의 "나는 9,000번 실패했다"는 명언에서 영감을 받은 interactive 애니메이션.
"실패는 길이 된다" (Failures Become the Road)

## 3. 기술 구조

### DOM 요소 참조
- **canvas** - #scene 캔버스 요소
- **ctx** - 캔버스 2D 렌더링 컨텍스트
- **playBtn** - #btn-play 버튼 요소
- **resetBtn** - #btn-reset 버튼 요소
- **skyVideo** - #sky 비디오 요소 (하늘 배경 비디오)

### 비디오 제어 시스템
- **video 객체**:
  - `playbackRate: 1.0` - 비디오 재생 속도 (기본값 1배속)
  - `startTime: 0` - 비디오 시작 시간 (초 단위)
- **applyVideo()** - 비디오 객체의 playbackRate를 실제 비디오 요소에 적용
- **seekVideo(t: number)** - 비디오를 지정된 시간(t)으로 이동
  - 유효한 범위(0 ~ duration - 0.001)로 자동 클램핑
  - 비디오 duration이 유효하지 않으면 무시
- **loadedmetadata 이벤트**:
  - 비디오 메타데이터 로드 완료 시 발생
  - `videoStartCtrl.max(skyVideo.duration)` - GUI 슬라이더 최대값 설정
  - `seekVideo(video.startTime)` - 설정된 시작 시간으로 이동
  - `applyVideo()` - 설정된 재생 속도 적용

### 애니메이션 방식
- **Pre-computed frame system**: 모든 물리 시뮬레이션을 미리 계산하여 480개 프레임으로 저장
- **프레임 기반 재생**: 실시간이 아닌 프리레이더 방식으로 일관된 성능 제공
- **재사용 가능한 데이터**: 프레임 데이터는 메모리에 캐시되어 반복 재생 시 효율적

### 물리 시뮬레이션
- **상수**:
  - `FPS = 60` - 프레임레이트
  - `TOTAL_FRAMES = 480` - 약 8초 분량 (480 / 60)
  - `GRAVITY = 280` - 중력 (px/s²)
  - `SUB_STEPS = 4` - 각 프레임당 물리 계산 반복 횟수
  - `TOP_OFFSET_RATIO = 0.4` - 공이 문자 위쪽에서 구르도록 플랫폼을 올리는 비율
- **공 물리**: 
  - 위치 (x: 120, y: -20), 속도, 반지름(7px), 플랫폼 착지 상태 추적
  - 초기 x 위치는 120 (중앙-왼쪽에서 시작)
  - `resetPhysics()` 함수는 x: 120으로 리셋하여 초기 위치와 일치
- **플랫폼**: 4개의 문자열("failures", "become", "the", "road")을 각도 지정 플랫폼으로 사용
  - 각 문자마다 위치(cx, cy)와 각도(angle) 제어 가능
  - 런타임에 조정 시 전체 시뮬레이션 재계산
  - **현재 플랫폼 배치**:
    - 'failures': cx: 127, cy: 237, angle: 13°, font: italic 28px
    - 'become': cx: 281, cy: 325, angle: -21°, font: italic 28px
    - 'the': cx: 176, cy: 413, angle: 20°, font: italic 30px
    - 'road': cx: 251, cy: 511, angle: -20°, font: italic 32px
  - **플랫폼 리프팅**: 공이 문자 위쪽에서 구르도록 플랫폼 선을 위로 올림
    - `fontPx(fontStr)` - 폰트 문자열에서 픽셀 크기 추출
    - `topOff = fontPx(w.font) * TOP_OFFSET_RATIO` - 올림 거리 계산
    - 플랫폼의 시작점(p1)과 끝점(p2)에 오프셋(ox, oy) 적용

### 렌더링 시스템
- **캔버스**: 405×720px (세로 형식)
- **도로 효과**: 공의 궤적을 마스크로 사용하여 아스팔트 텍스처에 도로 생성
  - 마스크: 22px 선폭의 궤적 경로
  - 아스팔트: 노이즈 기반 어두운 질감 (RGB ~28, 30)
- **레이어 순서**: 도로 → 문자 → 공

### Reset 함수 동작
- **reset()** - 애니메이션과 비디오를 초기 상태로 리셋
  - 현재 재생 중인 애니메이션 취소 (`cancelAnimationFrame`)
  - 재생 상태 정지 (`playing = false`)
  - 프레임을 0으로 리셋 (`state.frame = 0`)
  - GUI 슬라이더 업데이트 (`frameCtrl.updateDisplay()`)
  - 첫 번째 프레임 렌더링 (`renderFrame(0)`)
  - **비디오 동기화**: 비디오를 설정된 시작 시간으로 이동 (`seekVideo(video.startTime)`)
    - 이를 통해 애니메이션과 배경 비디오가 함께 초기 상태로 돌아감

## 4. 장면

### HTML 구조
- **#layout** - 전체 레이아웃 래퍼
  - **#stage** - 캔버스와 하늘 요소를 포함하는 스테이지 컨테이너
    - **#sky** - 하늘 배경 비디오 요소 (`assets/sky.mp4` 자동 재생, 루프, 음소거)
    - **#scene** - Canvas 렌더링 컨테이너 (405×720px)
  - **#controls** - 하단 버튼 그룹
    - **#btn-play** - 재생/일시정지
    - **#btn-reset** - 초기 프레임으로 리셋
- **lil-gui 컨트롤패널**:
  - **frame** 슬라이더 - 0 ~ 479 프레임 직접 선택
  - **Video** 폴더 - 비디오 재생 제어
    - playbackRate - 비디오 재생 속도 (0.1 ~ 4배속, 0.05 단위)
    - startTime - 비디오 시작 시간 (0 ~ 60초, 0.05 단위)
  - **Word Positions** 폴더 - 각 문자별 제어
    - cx, cy - 문자 중심 좌표
    - angle - 문자 회전각도 (-45° ~ 45°)

### 스타일 시스템
- **기본 스타일**: 마진/패딩 초기화, border-box 박스 모델
- **#layout**: 전체 레이아웃 컨테이너 (position: fixed, flex column, 중앙 정렬, gap: 20px)
- **#stage**: 상대 위치 컨테이너 (position: relative, 405×720px, box-shadow)
- **#sky**: 비디오 배경 컨테이너 (position: absolute, inset: 0, width: 100%, height: 100%, object-fit: cover, pointer-events: none)
- **#scene**: Canvas 요소 컨테이너 (position: absolute, inset: 0)
- **#controls**: 버튼 그룹 (display: flex, gap: 12px, #layout 내부에 위치)

### 주요 변경사항
- 타임라인 기반 애니메이션에서 프레임 기반 재생 방식으로 전환
- 실시간 물리 계산 제거 → 사전 계산 프레임 저장
- DOM 요소 간소화 (#hook, #jdi, #jdi-kr, #timer, #debug 제거)
- lil-gui를 통한 대화형 프레임 제어 및 플랫폼 배치 수정 기능 추가
- 캔버스 크기: 초기 360×640 → 이후 720×405 (가로 형식) → 현재 405×720 (세로 형식)
- HTML 구조 개선: #layout → #stage → #scene 계층 구조 추가
- #sky 요소 추가 (하늘 배경 요소)

### 플랫폼 수정 시 프레임 유지
- **Word Positions 폴더**의 `onChange` 콜백 개선:
  - 문자 위치(cx, cy) 또는 각도(angle) 변경 시 현재 프레임 위치 유지
  - 기존: 변경 후 항상 프레임 0으로 리셋
  - 개선: 변경 후 현재 프레임 위치에서 재계산된 애니메이션 재생
  - 이를 통해 플랫폼 배치 조정 중 특정 프레임에서 공의 움직임을 검토 가능
  - 프리컴포지션 후 `renderFrame(state.frame)` 호출로 현재 위치에서 렌더링
