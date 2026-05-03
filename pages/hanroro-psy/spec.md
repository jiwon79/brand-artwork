# Hanroro Psy Brand Artwork — 스펙

## 파일 구성

- `index.html` - Main interactive music pad interface
- `script.ts` - TypeScript module for audio playback, effects, and interactions
- `style.css` - Styling and 3D cube effects for buttons and LP player
- `/common/touch-cursor.ts` - Shared touch cursor module

## 컨셉

Interactive music pad interface combining:
- **LP Record Player** (center): Vinyl spinning at variable speed based on glitch level, with scratch canvas overlay and tonearm
- **4 FX Buttons** (2x2 grid, right side): Loop, Reverse, Filter, Echo effects
- **12 Sound Pads** (4x3 grid, bottom): Three rows with distinct visual styles and sound categories
  - Row 1 (Pink/Gangnam): "강남" (sample-based), "인간", "여자", "싸나이" (all sample-based)
  - Row 2 (Cyan/Fart): "옵", "완전", "사나에", "오빠달린다" (Korean labels and synthesized sounds)
  - Row 3 (Cream/Hanroro): "0+0 후렴", "기타", "한숨", "사랑해요"

## 장면 (Scene Structure)

```
#stage (fixed full-screen container)
├── .center (top section: 38vh height)
│   ├── .lp-wrap (LP player container)
│   │   ├── .lp-shadow (drop shadow)
│   │   ├── .lp (spinning vinyl record)
│   │   │   ├── .label (record label with text)
│   │   │   ├── .pin (center spindle)
│   │   │   └── canvas.scratch-canvas (scratch overlay)
│   │   └── .tonearm (tonearm element)
│   └── .fx-grid (2x2 effect buttons)
│       ├── .fx-btn (loop, reverse, filter, echo)
│       └── (repeats 4x)
└── .pad-grid (3x4 sound pad grid)
    ├── .pad.row-gangnam (4x, pink background)
    ├── .pad.row-fart (4x, cyan background)
    └── .pad.row-hanroro (4x, cream/paper background)
```

## 상호작용 (Interactions)

### LP Player
- **Tap**: Initialize audio context and start playback
- **Long press (700ms)**: Reset glitch level to 0
- **Drag**: Generate scratch sounds and visual scratches on overlay

### Sound Pads
- **Tap**: Play associated synthesized sound, emit colored rays and particles, update glitch level
  - Gangnam/Fart rows: Increase glitch (0.08)
  - Hanroro row: Decrease glitch (-0.05)

### FX Buttons
- **Hold Down**: Activate effect
- **Release/Leave**: Deactivate effect

## 스타일 (Styling)

- **3D Cube Effect**: Heavy inset box-shadows and layered gradients for tactile button appearance
- **Paper Texture**: Grain noise filter on Hanroro (cream) buttons
- **Neon Glows**: Bright colors with box-shadow halos on Gangnam (pink) and Fart (cyan) buttons
- **Dynamic Animations**: LP spins at variable speed based on glitch level (3.6s to 1.4s)

## 오디오 (Audio System)

- Web Audio API context with master gain, dry/wet routing
- Convolver for reverb/echo effect
- Hybrid audio playback:
  - Sample-based playback with fetch/decode infrastructure (loadSample, playSample)
  - SAMPLE_URLS map with MP3 assets: gangnam.mp3, ingan.mp3, yeoja.mp3, ssanai.mp3, op.mp3, wanjeon.mp3
  - Samples are preloaded on app startup via `Object.keys(SAMPLE_URLS).forEach((name) => loadSample(name))`
  - Sample caching and pending request deduplication
  - Synthesis for other sounds using oscillators and noise buffers (playEhy, playSexy, playFart, playSanae, playOppa, playZero, playGuitar, playSigh, playLove)
- SOUND_MAP: Maps pad dataset.sound attributes to playback functions
  - gangnam, ingan, yeoja, ssanai, op, wanjeon: playSample() - sample-based playback
  - sanae, oppa, zero, guitar, sigh, love: synthesized sounds
  - Note: fart2 was replaced with wanjeon (sample-based sound)
- Dynamic filters and envelope control for each sound
- FX chain: Filter (lowpass when enabled), Echo (wet/dry routing)
