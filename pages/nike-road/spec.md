# Nike Road Brand Artwork — 스펙

## 1. 파일 구성

- **index.html** - HTML 구조 (semantic, 모든 로직은 외부 모듈로 분리)
  - Google Fonts 임포트: Anton, Bebas Neue, Inter, Playfair Display
  - 폰트 프리로드: `preconnect` 링크로 로딩 성능 최적화
  - SVG 필터 정의: `#fx-defs` 요소로 포스트 프로세싱 효과 (크로매틱 수차, 색상 그레이딩)
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
  - `playbackRate: 0.7` - 비디오 재생 속도 (기본값 0.7배속)
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
- **Frame 타입 정의**: `{ x: number; y: number; trailLen: number }`
  - `x, y` - 프레임에서 공의 위치
  - `trailLen` - 렌더링할 궤적(masterTrail)의 길이
- **프레임 기반 재생**: 실시간이 아닌 프리레이더 방식으로 일관된 성능 제공
- **재사용 가능한 데이터**: 프레임 데이터는 메모리에 캐시되어 반복 재생 시 효율적
- **연속 애니메이션 루프**: `tick(ts: number)` 함수가 `requestAnimationFrame`으로 계속 실행
  - `ts` (DOMHighResTimeStamp) - 브라우저에서 제공하는 현재 타임스탬프 (밀리초)
  - `lastTs` - 이전 프레임의 타임스탐프 (module scope에서 관리)
  - 각 프레임마다 `dt = (ts - lastTs) / 1000`으로 경과 시간 계산
  - `playing` 상태일 때만 `state.frame` 증가, 그 외 항상 `renderFrame(state.frame, ts)` 호출
  - 타임스탠프는 동적 효과(중앙선 흐름, 그레인 애니메이션)에 필수

### Word 타입 정의
- `text: string` - 문자열
- `cx: number` - 중심 X 좌표
- `cy: number` - 중심 Y 좌표
- `angle: number` - 회전 각도 (도 단위)
- `size: number` - 폰트 크기 (픽셀, 정수)
- `width: number` - 렌더링된 텍스트 폭 (측정값, 초기값 0)
- `p1: { x: number; y: number }` - 플랫폼 시작점
- `p2: { x: number; y: number }` - 플랫폼 끝점
- `normal: { x: number; y: number }` - 표면 법선 벡터

### 물리 시뮬레이션
- **상수**:
  - `FPS = 60` - 프레임레이트
  - `TOTAL_FRAMES = 480` - 약 8초 분량 (480 / 60)
  - `GRAVITY = 280` - 중력 (px/s²)
  - `SUB_STEPS = 4` - 각 프레임당 물리 계산 반복 횟수
  - `TOP_OFFSET_RATIO = 0.4` - 공이 문자 위쪽에서 구르도록 플랫폼을 올리는 비율
- **물리 설정 객체**:
  - `restitution: 0.25` - 반발 계수 (0=완전 비탄성, 1=완전 탄성)
  - `stickSpeed: 35` - 공이 튕기기를 멈추고 플랫폼에 고정되는 속도 임계값 (법선 속도 기준, px/s)
- **착지 물리 로직** (`checkLanding()` 함수 내 새로운 로직):
  - 플랫폼에 접촉 감지 시 법선 속도(`vN`) 계산: `vN = ball.vx * w.normal.x + ball.vy * w.normal.y`
    - `vN < 0` - 공이 표면 쪽으로 움직임 (착지 중)
    - `vN >= 0` - 공이 표면에서 떨어지는 중
  - **조기 탈출(Early Exit) 조건**: `vN >= 0`일 때
    - 공이 표면에서 멀어지고 있는 상태 (예: 방금 튕겨 나온 직후)
    - 이 플랫폼 후보를 무시하고 계속 공중에서 날아감 (`return`)
    - 이를 통해 공이 같은 플랫폼에 반복해서 충돌하는 문제 해결
  - **튕기기(Bounce) 조건**: `vN < -physics.stickSpeed`일 때
    - 반발력 계산: `dv = -(1 + physics.restitution) * vN`
    - 법선 성분의 반발: `ball.vx += w.normal.x * dv`, `ball.vy += w.normal.y * dv`
    - 공을 표면에서 약간 떨어지게 위치: `ball.x = bestRes.cx + w.normal.x * (ball.r + 0.5)`, `ball.y = bestRes.cy + w.normal.y * (ball.r + 0.5)`
    - `return` - 플랫폼 고정 로직을 건너뜀 (공이 공중 상태 유지)
  - **고정 및 구르기(Stick & Roll) 로직**: 조기 탈출 및 튕기기 조건을 모두 만족하지 않을 때 실행
    - 공을 플랫폼에 고정: `ball.onPlatform = bestI`
    - 표면을 따라 속도 성분만 유지 (법선 성분 제거)
    - 플랫폼에서 떨어날 때까지 계속 구르기
- **공 물리**: 
  - 위치 (x: 120, y: -20), 속도, 반지름(7px), 플랫폼 착지 상태 추적
  - 초기 x 위치는 120 (중앙-왼쪽에서 시작)
  - `resetPhysics()` 함수는 x: 120으로 리셋하여 초기 위치와 일치
- **플랫폼**: 4개의 문자열("failures", "become", "the", "road")을 각도 지정 플랫폼으로 사용
  - 각 문자마다 위치(cx, cy), 각도(angle), 폰트 크기(size) 제어 가능
  - 런타임에 조정 시 전체 시뮬레이션 재계산
  - **현재 플랫폼 배치**:
    - 'failures': cx: 127, cy: 237, angle: 13°, size: 28px
    - 'become': cx: 244, cy: 325, angle: -21°, size: 28px
    - 'the': cx: 139, cy: 413, angle: 20°, size: 30px
    - 'road': cx: 238, cy: 511, angle: 5°, size: 32px
  - **폰트 프리셋 시스템**:
    - `FONT_PRESETS` - 폰트 스타일 템플릿 저장 객체
      - 'Georgia Italic Black': `italic 900 {SIZE}px Georgia, serif`
      - 'Playfair Italic Black': `italic 900 {SIZE}px "Playfair Display", serif` (현재 기본값)
      - 'Playfair Italic Regular': `italic 400 {SIZE}px "Playfair Display", serif`
      - 'Anton': `400 {SIZE}px Anton, sans-serif`
      - 'Bebas Neue': `400 {SIZE}px "Bebas Neue", sans-serif`
      - 'Inter Italic Black': `italic 900 {SIZE}px Inter, sans-serif`
      - 'Helvetica Italic Black': `italic 900 {SIZE}px "Helvetica Neue", Arial, sans-serif`
    - `style` 객체 - 현재 폰트 스타일 및 색상 관리
      - `preset: 'Playfair Italic Black'` - 현재 사용 폰트 프리셋
      - `color: '#f4ecd8'` - 텍스트 색상 (drawWord에서 사용되는 현재 글자 색상)
    - `getFont(size: number)` - 폰트 크기를 받아 선택된 프리셋에 {SIZE}를 대체하여 반환
  - **플랫폼 리프팅**: 공이 문자 위쪽에서 구르도록 플랫폼 선을 위로 올림
    - `topOff = w.size * TOP_OFFSET_RATIO` - 올림 거리 계산 (Word 객체의 size 필드 사용)
    - 플랫폼의 시작점(p1)과 끝점(p2)에 오프셋(ox, oy) 적용

### 렌더링 시스템
- **캔버스**: 405×720px (세로 형식)
- **도로 효과**: 3-레이어 구조로 현실적인 도로 표현
  - **상수**:
    - `ROAD_WIDTH = 22` - 전체 도로 폭
    - `EDGE_INSET = 2` - 양쪽 흰색 가장자리 두께
    - `CENTER_LINE_WIDTH = 1.8` - 중앙선 폭
    - `CENTER_LINE_COLOR = '#f0c419'` - 황색 중앙선
    - `EDGE_COLOR = '#f4f1ea'` - 흰색 가장자리
    - `DASH_PATTERN = [6, 8]` - 황색 중앙선 대시 패턴
    - `DASH_LEN = 14` - DASH_PATTERN의 합 (6 + 8)
    - `DASH_FLOW_SPEED = 30` - 중앙선이 흘러가는 속도 (px/s)
  - **레이어 1: 흰색 가장자리** - 전체 도로 폭(22px) 흰색 선
  - **레이어 2: 아스팔트 텍스처** - 흰색 가장자리 안쪽에 어두운 아스팔트 질감
    - 마스크를 사용하여 (ROAD_WIDTH - EDGE_INSET*2) 폭으로 자르기
    - 노이즈 기반 어두운 질감 (RGB ~28, 30)
  - **레이어 3: 황색 점선 중앙선 (동적 흐름)** - 시간에 따라 흘러가는 애니메이션 황색 선
    - `lineDashOffset`을 시간(ts)의 함수로 동적 계산
    - `lineDashOffset = -(((ts * 0.001) * DASH_FLOW_SPEED) % DASH_LEN)`
    - 시간이 지남에 따라 점선이 도로 방향으로 흘러가는 효과 제공
  - **traceTrail(c: CanvasRenderingContext2D, trailLen: number)** 함수 - 궤적을 그리는 공통 로직 (컨텍스트와 궤적 길이 매개변수)
  - **buildRoad(trailLen: number, ts: number)** - 3-레이어 도로 구조를 렌더링하는 함수
    - 매개변수: 
      - `trailLen` - 렌더링할 궤적의 길이 (masterTrail 배열의 인덱스)
      - `ts` - 타임스탬프 (밀리초, 중앙선 흐름 애니메이션에 사용)
    - 렌더링 절차:
      1. 도로 캔버스(roadCanvas) 초기화
      2. trailLen이 2 이상인 경우에만 처리 (최소 2개 점 필요)
      3. 레이어 1: traceTrail()로 흰색 가장자리 선 그리기
      4. 레이어 2: 마스크 캔버스에 검은색 선 그리고, 아스팔트 텍스처 합성
      5. 레이어 3: 동적 lineDashOffset으로 시간 기반 흐름 애니메이션을 적용한 황색 점선 중앙선 그리기
- **renderFrame(idx: number, ts: number) 함수**:
  - 매개변수:
    - `idx` - 렌더링할 프레임 인덱스 (0 ~ TOTAL_FRAMES-1)
    - `ts` - 타임스탬프 (밀리초, 동적 효과 애니메이션에 필수)
  - 렌더링 순서:
    1. `buildRoad(f.trailLen, ts)` - 도로 렌더링 (ts 파라미터로 중앙선 흐름 애니메이션 처리)
    2. **비디오 배경 렌더링** (캔버스 초기화 대체)
       - `skyVideo` 준비 상태 확인: `skyVideo.readyState >= 2 && skyVideo.videoWidth > 0`
       - 비디오 준비됨: 영상을 중앙 정렬하며 종횡비 유지하여 그리기
         - 스케일 계산: `scale = Math.max(W / vw, H / vh)` (커버 모드)
         - 렌더링 크기: `dw = vw * scale`, `dh = vh * scale`
         - 위치: `((W - dw) / 2, (H - dh) / 2)` (캔버스 중앙)
       - 비디오 미준비: 어두운 회색 배경(`#3a3a3a`) 채우기
    3. `ctx.drawImage(roadCanvas, 0, 0)` - 도로 그리기
    4. 루프: `drawWord(w)` - 모든 문자 플랫폼 렌더링
    5. `drawBall(f.x, f.y)` - 공 렌더링
    6. `ctx.drawImage(vignette, 0, 0)` - 비그넷 오버레이
- **레이어 순서**: 비디오 배경 → 도로 → 문자 → 공 → 비그넷
  - 비디오 배경이 SVG 필터(#post-fx)의 영향을 받도록 변경
  - 어두운 배경은 비디오 로딩 실패 시 폴백

### 시네마틱 오버레이 시스템
- **비그넷 오버레이**: 화면 주변 어둡게 처리
  - `vignette` 캔버스: 캔버스 크기(405×720px)와 동일
  - `buildVignette()` IIFE로 초기화:
    - 방사형 그래디언트 (W/2, H/2 중심)
    - 내부 반지름: `Math.min(W, H) * 0.35` (약 141px) - 투명
    - 외부 반지름: `Math.max(W, H) * 0.72` (약 518px) - `rgba(0,0,0,0.55)` (어두움)
    - 화면 주변부를 어둡게 하여 초점 집중 효과

### GUI 제어 패널
- **frame 슬라이더** - 0 ~ 479 프레임을 직접 제어
  - onChange 콜백: `stopPlayback()` 호출하여 재생 중이면 일시정지
- **Physics 폴더** - 물리 파라미터 실시간 조정
  - **restitution** - 반발 계수 (0 ~ 0.95, 0.01 단위)
    - onChange 콜백: `repre()` 함수 호출
  - **stickSpeed** - 공이 고정되는 속도 임계값 (0 ~ 200, 1 단위)
    - onChange 콜백: `repre()` 함수 호출
  - **repre() 함수** - 물리 파라미터 변경 시 시뮬레이션 재계산
    - `stopPlayback()` - 현재 재생 일시정지
    - `precompute()` - 전체 시뮬레이션 재계산 및 프레임 업데이트
- **FX 폴더** - 포스트 이펙트 실시간 조정
  - **aberration** - 색수차 오프셋 거리 (0 ~ 12px, 0.1 단위)
    - onChange 콜백: `applyAberration()` 호출하여 R/B 채널 오프셋 즉시 적용
  - **grading** - 색상 그레이딩 강도 (0 ~ 2, 0.05 단위)
    - onChange 콜백: `applyGrading()` 호출하여 색상 매트릭스 즉시 적용
- **Style 폴더** - 폰트 및 색상 실시간 조정
  - **preset** - 폰트 프리셋 선택 (FONT_PRESETS의 모든 옵션)
    - onChange 콜백: `onWordChange()` 호출
  - **color** - 텍스트 색상 선택 (색상 피커)
    - onChange 콜백: 없음 (색상 변경 시 자동으로 style.color 업데이트)
  - 폰트 프리셋이나 색상이 변경되면 시뮬레이션을 재계산하여 새로운 스타일 적용
- **Words 폴더** - 각 플랫폼(문자) 위치, 각도, 크기 실시간 조정
  - 각 단어('failures', 'become', 'the', 'road')마다 서브 폴더 생성
  - 각 단어 폴더 내 4개 슬라이더:
    - **cx** - 문자의 중심 X 좌표 (0 ~ 405px, 1px 단위)
    - **cy** - 문자의 중심 Y 좌표 (0 ~ 720px, 1px 단위)
    - **angle** - 문자의 회전 각도 (-45도 ~ 45도, 1도 단위)
    - **size** - 문자의 폰트 크기 (10px ~ 60px, 1px 단위)
  - onChange 콜백: 각 조정값이 변경될 때마다 `onWordChange()` 실행
    - `stopPlayback()` - 현재 재생 일시정지
    - `precompute()` - 전체 시뮬레이션 재계산 (변경된 플랫폼 위치/각도/크기 반영)
  - **용도**: 런타임에 플랫폼 배치를 실험적으로 조정하여 공의 궤적 변경
  - **공통 콜백**: `onWordChange()` 함수
    - Style 폴더의 preset 슬라이더와 Words 폴더의 모든 슬라이더에서 공유
    - 코드 중복 제거하여 유지보수성 향상
- **Video 폴더** - 비디오 재생 제어
  - **playbackRate** - 비디오 재생 속도 (0.1 ~ 4배속, 0.05 단위)
    - onChange 콜백: `applyVideo()` 호출
  - **startTime** - 비디오 시작 시간 (0 ~ 60초, 0.05 단위)
    - onChange 콜백: `seekVideo(v)` 호출하여 비디오를 지정된 시간으로 이동

### Post-FX (SVG 필터) 시스템
- **fx 객체** - 포스트 이펙트 파라미터 관리
  - `aberration: 2.5` - 색수차(Chromatic Aberration) 오프셋 거리 (픽셀 단위)
    - R 채널과 B 채널을 반대 방향으로 이동시켜 색상 분리 효과 생성
  - `grading: 1.0` - 색상 그레이딩 강도 (0 ~ 1, 0=원본, 1=최대 적용)
    - 따뜻한 톤의 하이라이트와 차가운 톤의 그림자 조합
- **SVG DOM 요소 참조** - 포스트 FX 필터 엘리먼트 직접 제어
  - `offRNode` - #fx-offset-r 요소 (R 채널 오프셋 필터)
  - `offBNode` - #fx-offset-b 요소 (B 채널 오프셋 필터)
  - `gradeNode` - #fx-grade 요소 (색상 그레이딩 색상 매트릭스 필터)
- **applyAberration() 함수** - 색수차 오프셋 적용
  - `offRNode.setAttribute('dx', String(fx.aberration))` - R 채널을 오른쪽으로 이동
  - `offBNode.setAttribute('dx', String(-fx.aberration))` - B 채널을 왼쪽으로 이동
  - 두 채널 간의 위치 차이로 색상 분리 효과 생성
- **applyGrading() 함수** - 색상 그레이딩 매트릭스 동적 계산
  - `lerp(a: number, b: number)` - 선형 보간 함수 (a에서 b로의 혼합 비율)
  - 색상 매트릭스 계산 (5×4 행렬):
    - R 채널: 1 → 1.08 (밝아짐), 오프셋 -0.03
    - G 채널: 1 → 1.04 (밝아짐), 오프셋 -0.02
    - B 채널: 1 → 0.96 (어두워짐), 오프셋 -0.01
    - A 채널: 불변 (0 0 0 1 0)
  - `gradeNode.setAttribute('values', m)` - 계산된 매트릭스를 필터에 적용
- **초기화** - 스크립트 로드 시 자동으로 실행
  - `applyAberration()` - 기본 색수차 오프셋 설정 (2.5px)
  - `applyGrading()` - 기본 색상 그레이딩 설정 (강도 1.0)

### Playback 함수들과 애니메이션 루프
- **tick(ts: number)** - 연속 애니메이션 루프 (requestAnimationFrame으로 매 프레임마다 호출)
  - 타임스탬프 기반 경과 시간 계산:
    - `lastTs === null`이면 초기화
    - `dt = (ts - lastTs) / 1000` - 이전 프레임과의 시간 차이(초)
    - `lastTs = ts` - 현재 타임스탬프 저장
  - `playing` 상태 처리:
    - 참이면 `state.frame += dt * FPS` - 프레임 진행
    - 프레임이 마지막에 도달하면 `state.frame = frames.length - 1`으로 클램핑하고 `playing = false`
    - `frameCtrl.updateDisplay()` - GUI 슬라이더 업데이트
  - **항상 실행**: `renderFrame(state.frame, ts)` - 모든 프레임마다 현재 상태를 렌더링
    - `ts` 파라미터는 동적 효과(중앙선 흐름)에 필수
  - `requestAnimationFrame(tick)` - 다음 프레임을 위해 자신을 재호출 (애니메이션 루프 유지)

- **play()** - 애니메이션 재생 시작
  - 이미 재생 중이면 무시 (`if (playing) return`)
  - 마지막 프레임에 도달했으면 처음부터 시작 (`state.frame = 0`)
  - 재생 상태 활성화 (`playing = true`)
  - `tick()` 함수는 이미 연속 실행 중이므로 추가 작업 불필요

- **reset()** - 애니메이션과 비디오를 초기 상태로 리셋
  - 재생 상태 정지 (`playing = false`)
  - 프레임을 0으로 리셋 (`state.frame = 0`)
  - GUI 슬라이더 업데이트 (`frameCtrl.updateDisplay()`)
  - **비디오 동기화**: 비디오를 설정된 시작 시간으로 이동 (`seekVideo(video.startTime)`)
    - 주의: `renderFrame()`은 `tick()` 루프에서 자동으로 호출되므로 명시적 호출 불필요
    - 애니메이션과 배경 비디오가 함께 초기 상태로 돌아감

- **stopPlayback()** - 애니메이션 재생만 중지 (프레임은 유지)
  - 재생 상태 정지 (`playing = false`)
  - `tick()` 루프는 계속 실행되어 현재 프레임을 렌더링

- **frameCtrl (frame slider) onChange 콜백**:
  - GUI 프레임 슬라이더 값이 변경될 때 실행
  - `state.frame` 값이 새로운 슬라이더 위치로 업데이트됨
  - `stopPlayback()` 호출 - 재생 중이면 일시정지
  - `renderFrame()` 명시적 호출은 하지 않음 - `tick()` 루프에서 자동으로 새 프레임이 렌더링됨

## 4. 장면

### SVG 포스트 프로세싱 필터 시스템
- **#fx-defs** - SVG 필터 정의 요소 (`aria-hidden="true"`)
  - **#post-fx** - 포스트 프로세싱 필터 (메인 필터)
    - 영역: x="-5%", y="-5%", width="110%", height="110%"
    - `color-interpolation-filters="sRGB"` - sRGB 색상 공간에서 처리
  - **크로매틱 수차 (Chromatic Aberration)**:
    - 3개의 `<feColorMatrix>` 요소로 R/G/B 채널 분리
      - R 채널: `values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"` → result="r"
      - G 채널: `values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"` → result="g"
      - B 채널: `values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"` → result="b"
    - 2개의 `<feOffset>` 요소로 오프셋 적용
      - R: `id="fx-offset-r"`, dx="1.2" (오른쪽으로 이동)
      - B: `id="fx-offset-b"`, dx="-1.2" (왼쪽으로 이동)
    - 2개의 `<feBlend>` 요소로 채널 합성 (mode="screen")
      - R과 G 합성 → result="rg"
      - RG와 B 합성 → result="rgb"
  - **색상 그레이딩 (Color Grading)**:
    - `<feColorMatrix id="fx-grade">` with type="matrix"
    - ID: `fx-grade` - JavaScript에서 색상 그레이딩 필터를 참조하기 위한 식별자
    - 따뜻한 하이라이트 (R: +1.08, G: +1.04), 살짝 차가운 블루 (B: 0.96)
    - 값 오프셋: R=-0.03, G=-0.02, B=-0.01 (부드러운 감소)
    - 마지막 행: 알파 채널 유지 (0 0 0 1 0)

### HTML 구조
- **#fx-defs** - SVG 필터 정의 (위에서 상세 설명)
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

### 스타일 시스템
- **기본 스타일**: 마진/패딩 초기화, border-box 박스 모델
- **#layout**: 전체 레이아웃 컨테이너 (position: fixed, flex column, 중앙 정렬, gap: 20px)
- **#stage**: 상대 위치 컨테이너 (position: relative, 405×720px, box-shadow)
- **#fx-defs**: SVG 필터 정의 컨테이너 (position: absolute, width: 0, height: 0, overflow: hidden)
  - DOM에서 숨김 처리하면서 SVG 필터 정의가 참조 가능하도록 함
- **#sky**: 비디오 배경 컨테이너 (position: absolute, inset: 0, width: 100%, height: 100%, object-fit: cover, pointer-events: none, visibility: hidden)
- **#scene**: Canvas 요소 컨테이너 (position: absolute, inset: 0, filter: url(#post-fx))
- **#controls**: 버튼 그룹 (display: flex, gap: 12px, #layout 내부에 위치)

### 주요 변경사항
- 타임라인 기반 애니메이션에서 프레임 기반 재생 방식으로 전환
- 실시간 물리 계산 제거 → 사전 계산 프레임 저장
- DOM 요소 간소화 (#hook, #jdi, #jdi-kr, #timer, #debug 제거)
- lil-gui를 통한 대화형 프레임 제어 및 플랫폼 배치 수정 기능 추가
- 캔버스 크기: 초기 360×640 → 이후 720×405 (가로 형식) → 현재 405×720 (세로 형식)
- HTML 구조 개선: #layout → #stage → #scene 계층 구조 추가
- #sky 요소 추가 (하늘 배경 요소)

