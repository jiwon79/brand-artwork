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
- **연속 애니메이션 루프**: `tick(ts: number)` 함수가 `requestAnimationFrame`으로 계속 실행
  - `ts` (DOMHighResTimeStamp) - 브라우저에서 제공하는 현재 타임스탬프 (밀리초)
  - `lastTs` - 이전 프레임의 타임스탐프 (module scope에서 관리)
  - 각 프레임마다 `dt = (ts - lastTs) / 1000`으로 경과 시간 계산
  - `playing` 상태일 때만 `state.frame` 증가, 그 외 항상 `renderFrame(state.frame, ts)` 호출
  - 타임스탠프는 동적 효과(중앙선 흐름, 그레인 애니메이션)에 필수

### 물리 시뮬레이션
- **상수**:
  - `FPS = 60` - 프레임레이트
  - `TOTAL_FRAMES = 480` - 약 8초 분량 (480 / 60)
  - `GRAVITY = 280` - 중력 (px/s²)
  - `SUB_STEPS = 4` - 각 프레임당 물리 계산 반복 횟수
  - `TOP_OFFSET_RATIO = 0.4` - 공이 문자 위쪽에서 구르도록 플랫폼을 올리는 비율
  - `DUST_LIFE_FRAMES = 36` - 먼지 입자의 생명주기 (프레임 단위)
  - `DUST_GRAVITY = 90` - 먼지 입자의 중력 (공의 중력보다 부드러움, px/s²)
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

### 먼지 입자 시스템
- **타입 정의**:
  - `Dust` 타입: `{ spawn: number; x: number; y: number; vx: number; vy: number }`
    - `spawn` - 입자가 생성된 프레임 인덱스
    - `x, y` - 입자의 현재 위치
    - `vx, vy` - 입자의 속도
- **난수 생성**:
  - `hashRand(seed: number): number` - 시드 기반 결정적 난수 생성
    - `Math.sin(seed) * 43758.5453`를 사용한 해시 함수
    - 항상 0~1 범위의 값 반환
    - 같은 시드는 같은 값을 생성하여 재현 가능한 입자 효과 제공
- **먼지 배출 함수**:
  - `emitDustLanding(frameIdx: number)` - 착지 시 먼지 배출
    - 프레임마다 10개의 입자 생성
    - 각도: -90° ± 0.75라디안 범위 (대체로 위쪽으로 분사)
    - 속도: 28 ~ 78 px/frame (28 + 50의 난수)
  - `emitDustRoll(frameIdx: number)` - 구르는 중 먼지 배출
    - 프레임마다 1개의 입자 생성
    - 각도: -90° ± 0.35라디안 범위 (더 좁은 범위)
    - 속도: 8 ~ 26 px/frame (8 + 18의 난수)
- **precompute() 함수의 먼지 시뮬레이션**:
  - 매 프레임마다 공의 착지 상태 추적 (`wasInAir` 플래그)
  - 착지 순간 (`wasInAir && ball.onPlatform >= 0`): `emitDustLanding()` 호출
  - 구르는 중 (`ball.onPlatform >= 0 && i % 3 === 0`): 3 프레임마다 `emitDustRoll()` 호출
  - 입자는 사전 계산 단계에서 생성되어 `dustParticles` 배열에 누적

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
    2. `ctx.clearRect()` - 캔버스 초기화
    3. `ctx.drawImage(roadCanvas, 0, 0)` - 도로 그리기
    4. 루프: `drawWord(w)` - 모든 문자 플랫폼 렌더링
    5. `drawDust(i)` - 먼지 입자 렌더링
    6. `drawBall(f.x, f.y)` - 공 렌더링
    7. `applyGrain(ts)` - 필름 그레인 오버레이 (ts 기반 노이즈 애니메이션)
    8. `ctx.drawImage(vignette, 0, 0)` - 비그넷 오버레이
- **레이어 순서**: 도로 → 문자 → 먼지 → 공 → 그레인 오버레이 → 비그넷

### 시네마틱 오버레이 시스템
- **먼지 입자 렌더링**: `drawDust(currentFrame: number)` 함수
  - `dustParticles` 배열의 각 입자에 대해 다음 계산 수행:
    - `age = currentFrame - p.spawn` - 입자의 나이(프레임 단위)
    - `t = age / FPS` - 경과 시간(초 단위)
    - `ageT = age / DUST_LIFE_FRAMES` - 정규화된 나이 (0~1)
    - 위치: `x = p.x + p.vx * t`, `y = p.y + p.vy * t + 0.5 * DUST_GRAVITY * t * t` (포물선 운동)
    - 알파: `alpha = (1 - ageT) * 0.55` (시간이 지남에 따라 페이드아웃)
    - 반지름: `radius = 1.4 + ageT * 2.4` (시간에 따라 커짐)
    - 색상: `rgba(232,222,200,${alpha})` (따뜻한 먼지 색)
  - 유효한 입자만 렌더링 (age >= 0 && age < DUST_LIFE_FRAMES)

- **필름 그레인 오버레이**: 시네마틱 감성 강화
  - `grain` 캔버스: 256×256px 노이즈 텍스처
    - `buildGrain()` IIFE로 초기화: RGB 값 100~210 범위의 랜덤 그레이스케일 노이즈
  - `applyGrain(ts: number)` 함수:
    - 글로벌 알파: 0.08 (은은함)
    - 컴포지트 모드: 'overlay' (이미지와 혼합)
    - 타임스탬프 기반 오프셋으로 그레인이 미묘하게 움직이는 효과
      - `offX = (((ts * 0.05) | 0) % 256 + 256) % 256`
      - `offY = (((ts * 0.07) | 0) % 256 + 256) % 256`
    - 화면을 256×256 타일로 채워 그레인 패턴 적용

- **비그넷 오버레이**: 화면 주변 어둡게 처리
  - `vignette` 캔버스: 캔버스 크기(405×720px)와 동일
  - `buildVignette()` IIFE로 초기화:
    - 방사형 그래디언트 (W/2, H/2 중심)
    - 내부 반지름: `Math.min(W, H) * 0.35` (약 141px) - 투명
    - 외부 반지름: `Math.max(W, H) * 0.72` (약 518px) - `rgba(0,0,0,0.55)` (어두움)
    - 화면 주변부를 어둡게 하여 초점 집중 효과

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
    - `ts` 파라미터는 동적 효과(중앙선 흐름, 그레인 애니메이션)에 필수
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

### 스타일 시스템
- **기본 스타일**: 마진/패딩 초기화, border-box 박스 모델
- **#layout**: 전체 레이아웃 컨테이너 (position: fixed, flex column, 중앙 정렬, gap: 20px)
- **#stage**: 상대 위치 컨테이너 (position: relative, 405×720px, box-shadow)
- **#sky**: 비디오 배경 컨테이너 (position: absolute, inset: 0, width: 100%, height: 100%, object-fit: cover, pointer-events: none, filter: saturate(0.82) contrast(1.05) brightness(0.95))
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

