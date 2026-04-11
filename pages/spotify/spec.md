# Spotify Brand Artwork — Lyrics Rain 스펙

## 1. 파일 구성

```
spotify/
  index.html   — Spotify 플레이어 UI (헤더, 캔버스, 곡 정보, 컨트롤)
  style.css    — 전역 스타일
  script.js    — 물리 + 오디오 + 가사 스폰
  assets/
    songs.json            — 곡 목록 [{id, title, artist, audioFile, lyricsFile}]
    <song>.mp3            — 오디오
    <song>-lyrics.json    — { lyrics: [{start, end, word}] }
```

의존성: `matter-js` (ES 모듈).

---

## 2. 컨셉

Spotify 모바일 플레이어 UI를 재현한 뒤, 상단 캔버스를 "가사 비"로 채운다. 현재 재생 중인 곡의 가사 단어가 `start` 타임스탬프에 맞춰 위쪽에서 색색의 알약으로 떨어져 Matter.js 기반 강체 시뮬레이션으로 쌓인다. 단어를 탭하면 폭발하며 주변 단어를 밀어내고 반짝이는 파티클을 생성한다. 오디오 볼륨(FFT analyser)에 따라 단어의 폰트 크기가 커진다.

---

## 3. UI 구조 (Spotify 모바일)

```
.player
  .player-header (아래 화살표 / playlist-name / more)
  .canvas-wrap#canvas-wrap
    canvas#physics-canvas
    #canvas-hint (▶ 재생 버튼을 눌러 시작하세요)
  .bottom
    .song-row (title + artist + like 버튼)
    .progress (fill + thumb + current/total time)
    .controls (shuffle / prev / play / next / repeat)
```

- `<audio id="audio-player" crossorigin="anonymous">` 로 재생.
- 곡명이 길면 `.marquee` 애니메이션으로 좌우 흐름.

---

## 4. 물리 엔진 (Matter.js)

```js
engine = Engine.create({ gravity: { y: 1.0 } })
world  = engine.world
```

### 벽

```js
walls = [
  Bodies.rectangle(W/2, H + 30, W + 120, 60, { isStatic: true }), // floor
  Bodies.rectangle(24 - 30, H/2, 60, H*3, { isStatic: true }),    // left
  Bodies.rectangle(W - 24 + 30, H/2, 60, H*3, { isStatic: true }),// right
]
```

- `CANVAS_PAD = 24` px (좌우 패딩, 하단 섹션과 정렬).
- 천장 없음 → 위에서 스폰 가능.
- 리사이즈 시 `rebuildWalls()`.

---

## 5. 설정 (CFG)

| 이름 | 값 | 설명 |
|------|----|------|
| `minFont` | 7 | 최소 폰트 크기 |
| `maxFont` | 23 | 최대 폰트 크기 (볼륨 1일 때) |
| `gravity` | 1.0 | 월드 중력 y |
| `restitution` | 0.28 | 반발 계수 |
| `friction` | 0.65 | 마찰 |
| `frictionAir` | 0.018 | 공기 저항 |
| `explosionForce` | 0.055 | 클릭 폭발 힘 |
| `explosionRadius` | 190 | 폭발 반경 (px) |
| `fadeSpeed` | 0.04 | 단어 fade 속도 |
| `colors` | 10색 | 단어 배경 팔레트 |

### 팔레트

`#1DB954`(스포티파이 그린), `#FF1744`, `#D500F9`, `#2979FF`, `#FF6D00`, `#1B5E20`, `#FF4081`, `#651FFF`, `#E040FB`, `#F4511E`.

---

## 6. 곡 & 가사 데이터

### songs.json (runtime)

```json
[
  { "id": "...", "title": "...", "artist": "...", "audioFile": "...", "lyricsFile": "..." }
]
```

### 개별 lyrics.json

```json
{ "lyrics": [{ "start": 12.34, "end": 13.80, "word": "..." }] }
```

### `loadSong(songId)`

1. `lyricsFile`을 fetch.
2. `currentSong = { ...meta, lyrics }`.
3. `lyricsQueue = [...lyrics]`, `lyricsIdx = 0`.
4. `fallbackWords = lyrics.map(l => l.word)` (타이밍 없는 fallback용).
5. `#song-title`, `#artist-name` 업데이트 + `updateTitleMarquee()`.
6. `audioEl.src = audioFile; audioEl.load()`.

### 곡 전환 (`switchSong`)

현재 재생 상태 보존 → 정지 → 월드 초기화(`wordBodies`, `particles`, `simTime`, `lastTimingSpawnAt`) → 다음 곡 로드 → 재생 중이었으면 다시 play.

---

## 7. 오디오 파이프라인

```js
audioCtx      = new AudioContext()
mediaSource   = audioCtx.createMediaElementSource(audioEl)
analyserNode  = audioCtx.createAnalyser()   // fftSize=512, smoothing=0.75
gainNode      = audioCtx.createGain()       // gain 1.0
mediaSource → analyserNode → gainNode → destination
```

### 볼륨 읽기

```
data = Uint8Array(frequencyBinCount)
analyser.getByteFrequencyData(data)
avg = mean(data[0..N/2])
volumeLevel = avg / 200
```

analyser 없는 상태(초기)는 sin 조합 pseudo volume:
```
v = 0.35 + 0.25|sin(t×1.3)| + 0.15|sin(t×3.1)| + 0.08|sin(t×7.7)| + 0.05×noise
volumeLevel = clamp(v, 0.08, 1.0)
```

---

## 8. 단어 스폰

### 생성 (`spawnWordText`)

```
fontSize = round(minFont + volumeLevel × (maxFont - minFont))
color    = random(CFG.colors)
tw = measureText(word, bold ${fontSize}px Malgun Gothic...)
bw = tw + fontSize × 0.9      // 좌우 패딩
bh = fontSize + 10
```

```
x = random in [minX, maxX]    // minX = PAD + bw/2
y = random in [bh/2, 1.5×bh]  // 상단에서 약간 아래
angle = (random - 0.5) × 0.3  // ±0.15 rad
body = Bodies.rectangle(x, y, bw, bh, { restitution, friction, frictionAir, label: 'word' })
World.add(world, body)
wordBodies.push({ body, word, fontSize, color, bw, bh, fading: false, opacity: 1 })
```

### 타이밍 스폰 (메인 경로)

```
while lyricsIdx < lyrics.length && audioTime >= lyrics[lyricsIdx].start:
  spawnWordText(lyrics[lyricsIdx].word)
  lyricsIdx++
```

### Fallback 스폰

`FALLBACK_SPAWN_MS = 1400` — 현재 코드에서는 `spawnFallbackWord`가 정의되어 있으나 `tick`에서 호출되지 않음 (타이밍 스폰이 주 경로). `switchSong` / seek 시 인덱스 리셋.

---

## 9. 정리 (Cleanup)

메모리 과부하 방지를 위해 300 ms마다:

```
active = wordBodies.filter(!fading)
totalArea = Σ bw × bh
if totalArea > W × H / 3 && active.length > 0:
  active[0].fading = true
```

`fading = true`인 단어는 매 프레임 `opacity -= fadeSpeed`, 0 이하면 `World.remove + splice`.

---

## 10. 클릭 폭발

```
handleCanvasClick(mx, my):
  hit = 최상단 단어 (역순 pointInBody)
  if !hit: return
  spawnParticles(hit.x, hit.y, hit.color)   // 28개 파티클
  for each 나머지 body:
    d = dist(b, hit)
    if d < explosionRadius:
      str = explosionForce × (1 - d/R)
      applyForce(b, (dx/d)×str, (dy/d)×str - str×0.4)   // 약간 위쪽 편향
  remove(hit)
```

### `pointInBody`

body의 rotation을 역변환하여 local 좌표로 변환 → `|lx| ≤ hw && |ly| ≤ hh`.

---

## 11. 파티클

### 스폰 (`spawnParticles`, 28개)

```
angle = random × 2π
spd   = 1.5 ~ 8.5
glow  = random < 0.35                       // 35%는 큰 블룸
size  = glow ? 3~7 : 1.2~4
vx = cos × spd
vy = sin × spd - 2                          // 위로 편향
life = 1
```

### 업데이트

```
particles = filter(life > 0)
for p:
  x += vx
  y += vy
  vy += 0.18                                // 중력
  vx *= 0.96
  vy *= 0.96
  life -= fadeSpeed + 0.01
```

### 렌더링

- `globalAlpha = life × 0.9`
- **glow**: `shadowBlur = size × 5 × life`, `fillStyle = #fff`, `shadowColor = p.color` (흰 중심 + 큰 컬러 할로)
- **spark**: `shadowBlur = size × 2.5 × life`, `fillStyle = p.color` (컬러 중심 + 모더레이트 글로우)
- 렌더 종료 후 `shadowBlur=0, shadowColor='transparent'`로 명시적 리셋 (블리드 방지)

---

## 12. 단어 렌더링

```
save + globalAlpha = opacity
translate(body.position)
rotate(body.angle)
fillStyle = color
fillRect(-bw/2, -bh/2, bw, bh)        // 알약 배경 (round rect 아님)
fillStyle = '#fff'
font = bold ${fontSize}px Malgun Gothic, ...
textAlign/baseline = center/middle
shadowColor = rgba(0,0,0,0.35), shadowBlur = 3
fillText(word, 0, 1)
shadowBlur = 0
restore
```

---

## 13. 메인 루프 (`tick`)

```
dt = min(ts - lastRaf, 50)
lastRaf = ts

if isPlaying:
  simTime += dt/1000
  readVolume()
  audioTime = getAudioTime()
  spawnTimingWords(ts, audioTime)
  checkCleanup(ts)
  Engine.update(engine, dt)
  updateProgressUI(audioTime)

clearRect(0, 0, W, H)
updateParticles()
renderParticles()
renderWords()
rAF
```

---

## 14. 컨트롤

| 버튼 | 함수 | 동작 |
|------|------|------|
| ▶ / ⏸ | `togglePlay()` / `setPlaying(v)` | audioCtx.resume → `startAudio(pausedAt)` 또는 pause (pausedAt 저장) |
| ⏮ | `skipBack()` | seek 0 + play |
| ⏭ | `skipForward()` | seek +10s |
| ♡ | `toggleLike()` | `.liked` 토글 |
| 🔀 | `toggleShuffle()` | `.active` 토글 |
| 🔁 | `toggleRepeat()` | `.active` 토글, 곡 종료 시 `seekTo(0) + play` |
| 곡 전환 | `switchSong()` | 다음 곡 로드 |

HTML onclick에 노출: `window.togglePlay`, `toggleLike`, `toggleShuffle`, `toggleRepeat`, `skipBack`, `skipForward`, `switchSong`.

### Progress 바 클릭 시크

```
pct = (clientX - rect.left) / rect.width
seekTo(pct × audioDuration)
```

`seekTo(sec)`는 audio.currentTime 설정 + `lyricsIdx = findIndex(l.start >= sec)` + `lastTimingSpawnAt = sec - 0.1`.

---

## 15. Progress UI

```
pct = clamp(sec / duration, 0..1) × 100
#progress-fill.width = pct%
#progress-thumb.left = pct%
#current-time = formatTime(sec)        // "m:ss"
#total-time   = "-" + formatTime(dur - sec)
```

---

## 16. 이벤트

| 이벤트 | 액션 |
|--------|------|
| `canvas click/touchend` | `handleCanvasClick(x, y)` (폭발) |
| `progress-wrap click` | seek |
| `audioEl loadedmetadata` | `audioDuration = duration`, progress 초기화 |
| `audioEl ended` | repeat이면 0 seek + play, 아니면 `setPlaying(false)` |
| `window resize` | `setupCanvas()` + `rebuildWalls()` |
| `DOMContentLoaded` | `init()` |

---

## 17. 캔버스 설정

```
W = #canvas-wrap.clientWidth
H = #canvas-wrap.clientHeight
DPR = devicePixelRatio (최대 제한 없음)
canvas.width/height = W*DPR, H*DPR
ctx.setTransform(DPR, 0, 0, DPR, 0, 0)   // 이후 모든 좌표 CSS px
```
