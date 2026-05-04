# Hanroro Psy Brand Artwork — 스펙

## 파일 구성

- `index.html` - Main interactive music pad interface
- `script.ts` - TypeScript module for audio playback, effects, and interactions
- `style.css` - Styling and 3D cube effects for buttons and LP player
- `/common/touch-cursor.ts` - Shared touch cursor module

## 컨셉

Interactive music pad interface combining:
- **Two LP Record Players** (center): 
  - Primary player (lp): Vinyl spinning at variable speed based on glitch level, with scratch canvas overlay and tonearm. Label displays image asset (IMG_7827.webp) instead of gradient + text
  - Secondary player (lp2): "강남스타일" by PSY, static display with tonearm. Label displays image asset (IMG_7826.webp) instead of text
- **12 Sound Pads** (4x3 grid, bottom): Three rows with distinct visual styles and sound categories
  - Row 1 (Pink/Gangnam): gangnam, ingan, yeoja, ssanai (all sample-based)
  - Row 2 (Cyan/Fart): op, wanjeon, ultungbultung, eo (sample-based sounds)
  - Row 3 (Cream/Hanroro): ehy, damngirl, najeneun, meori (all sample-based)

## 장면 (Scene Structure)

```
#stage (fixed full-screen container)
├── .center (top section: contains two LP players)
│   ├── Layout: flex container with 24px gap and space-around distribution
│   ├── Height: 38vh (fixed), with responsive adjustment to 32vh below 700px viewport height
│   ├── .lp-wrap (LP player 1 - primary interactive)
│   │   ├── Height: min(100%, calc(50vw - 28px)) — constrains to viewport width with aspect-ratio 1:1
│   │   ├── .lp-shadow (drop shadow)
│   │   ├── .lp#lp (spinning vinyl record)
│   │   │   ├── .label (record label with image background IMG_7827.webp, id="labelText")
│   │   │   │   ├── .label-text (hidden with display: none)
│   │   │   │   └── .label-sub (hidden with display: none)
│   │   │   ├── canvas.scratch-canvas (scratch overlay)
│   │   │   └── .pin (center spindle)
│   │   └── .tonearm#tonearm (tonearm element)
│   └── .lp-wrap (LP player 2 - secondary/display)
│       ├── .lp-shadow (drop shadow)
│       ├── .lp#lp2 (static vinyl record - "강남스타일" by PSY)
│       │   ├── .label.label-gangnam (record label with image background IMG_7826.webp)
│       │   │   ├── .label-text (hidden with display: none)
│       │   │   └── .label-sub (hidden with display: none)
│       │   └── .pin (center spindle)
│       └── .tonearm#tonearm2 (tonearm element)
└── .pad-grid (3x4 sound pad grid)
    ├── .pad.row-gangnam (4x, pink background)
    ├── .pad.row-fart (4x, cyan background)
    └── .pad.row-hanroro (4x, cream/paper background)
```

## 상호작용 (Interactions)

### LP Player (Primary - lp)
- **Tap**: Initialize audio context and start playback
- **Long press (700ms)**: Reset glitch level to 0
- **Drag**: Generate scratch sounds and visual scratches on overlay

### LP Player (Secondary - lp2)
- Display-only "강남스타일" by PSY album cover with animated tonearm that plays when app starts (visual reference element with active animation)

### Sound Pads
- **Tap**: Play associated sample sound, emit colored rays and particles, update glitch level
  - Gangnam/Fart rows: Increase glitch (0.08)
  - Hanroro row: Decrease glitch (-0.05)

## 스타일 (Styling)

- **LP Record Labels**: Image-based backgrounds (webp assets)
  - Primary LP (.label): Background image IMG_7827.webp with fallback color #f4a872, center/cover sizing, overflow hidden
  - Secondary LP (.label.label-gangnam): Background image IMG_7826.webp with fallback color #1a1006
  - Text elements (.label-text, .label-sub) are hidden with display: none
- **3D Cube Effect**: Heavy inset box-shadows and layered gradients for tactile button appearance
- **Paper Texture**: Grain noise filter on Hanroro (cream) buttons
- **Neon Glows**: Bright colors with box-shadow halos on Gangnam (pink) and Fart (cyan) buttons
- **Dynamic Animations**: LP spins at variable speed based on glitch level (3.6s to 1.4s)

## 오디오 (Audio System)

- Web Audio API context with master gain node
- Direct routing: source → masterGain → destination
- Sample-based playback with fetch/decode infrastructure
  - `loadSample(name)`: Async loader with caching and pending request deduplication
  - `playSample(name)`: Plays cached audio buffer directly to masterGain (no local gain, no tracking)
  - SAMPLE_URLS map with 12 MP3 assets: gangnam, ingan, yeoja, ssanai, op, wanjeon, ultungbultung, eo, ehy, damngirl, najeneun, meori
  - Samples are preloaded on app startup via `Object.keys(SAMPLE_URLS).forEach(loadSample)`
- Scratch sound generation via `playScratchTick()`: Creates bandpass-filtered noise on pointer drag, routed through gain → masterGain
- Audio Effects: **All FX button handlers have been removed**
  - Previously supported effects (Loop, Reverse, Filter, Echo) are no longer functional
  - FX button elements may still exist in HTML but have no event listeners
  - **NOTE**: `applyFXChain()`, `setEchoLevel()`, reverb convolver, dry/wet routing, `loopInterval` variable, and all FX button event listeners have been removed
- All 12 sounds use sample-based playback (no synthesized sounds)
