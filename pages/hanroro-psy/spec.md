# Hanroro Psy Brand Artwork — 스펙

## 파일 구성

- `index.html` - Main interactive music pad interface
- `script.ts` - TypeScript module for audio playback and interactions
- `style.css` - Styling and 3D cube effects for buttons and LP player
- `/common/touch-cursor.ts` - Shared touch cursor module

## 컨셉

Interactive music pad interface combining:
- **Two LP Record Players** (center): 
  - Primary player (lp): Vinyl record with tonearm
  - Secondary player (lp2): "강남스타일" by PSY, static display with tonearm
- **12 Sound Pads** (4x3 grid, bottom): Simple clickable pads for sound playback
  - Row 1: gangnam, ingan, yeoja, ssanai
  - Row 2: op, wanjeon, ultungbultung, eo
  - Row 3: ehy, damngirl, najeneun, meori

## 장면 (Scene Structure)

```
#stage (fixed full-screen container)
├── .center (top section: contains two LP players)
│   ├── Layout: flex container with 24px gap and space-around distribution
│   ├── Height: 38vh (fixed), with responsive adjustment to 32vh below 700px viewport height
│   ├── .lp-wrap (LP player 1 - primary)
│   │   ├── Height: min(100%, calc(50vw - 28px)) — constrains to viewport width with aspect-ratio 1:1
│   │   ├── .lp-shadow (drop shadow)
│   │   ├── .lp#lp (spinning vinyl record)
│   │   │   ├── .label (empty - no visual label content)
│   │   │   └── .pin (center spindle)
│   │   └── .tonearm#tonearm (tonearm element)
│   └── .lp-wrap (LP player 2 - secondary/display)
│       ├── .lp-shadow (drop shadow)
│       ├── .lp#lp2 (static vinyl record - "강남스타일" by PSY)
│       │   ├── .label (empty record label - no text content)
│       │   └── .pin (center spindle)
│       └── .tonearm#tonearm2 (tonearm element)
└── .pad-grid (3x4 sound pad grid)
    ├── .pad.row-gangnam (4x)
    ├── .pad.row-fart (4x)
    └── .pad.row-hanroro (4x)
```

## 상호작용 (Interactions)

### LP Player (Primary - lp)
- **Tap**: Initialize audio context and start playback
- Label element is now empty (no text content or canvas)
- All previous scratch, drag, and canvas-based functionality has been removed

### LP Player (Secondary - lp2)
- **Tap**: Initialize audio context and start playback
- Display-only "강남스타일" by PSY album reference with animated tonearm
- Label element is empty (no text content)

### Sound Pads
- **Pointerdown**: Play associated sample sound, add 'held' class for visual feedback
  - 'held' state: Translate down 6px, scale to 0.97, brighten to 1.18x, saturate to 1.25x
  - Gloss opacity reduced to 0.3 with scaleY(0.7) transform
  - Row-specific shadow adjustments for pressed appearance
- **Pointerup/Pointerleave/Pointercancel**: Remove 'held' class
- All visual effects (rays, particles, glitch updates) have been removed

## 스타일 (Styling)

### Color System
- Light paper background (`--paper: #f4ead5`) with warm paper secondary (`--paper-warm: #e8d5b0`)
- Deep paper accent (`--paper-deep: #c4b390`)
- Dark ink text (`--ink: #1a1410`, soft: `--ink-soft: #3d2e25`)
- Neon accents: pink (`#ff2e93`), cyan (`#00f0ff`), yellow (`#fff200`)

### Button/Pad Styling
- **Skeuomorphic 3D Design**: Heavy inset box-shadows and layered radial gradients for tactile raised button appearance
- **Paper Texture**: Grain noise filter (SVG-based) applied to Hanroro (cream) row buttons
- **Neon Glows**: Bright colors with layered box-shadow halos on Gangnam (pink) and Fart (cyan) buttons
- **Highlight Gloss**: Subtle white gradient overlay on button surface (::after pseudo-element)
- **Interaction State**: 'held' class for pressed state with brightness/saturation boost and reduced gloss opacity

### LP Player Styling
- **Vinyl Record**: Dark repeating-radial-gradient with realistic platter appearance
- **Inset Shadows**: Deep inner shadows and subtle edge highlight for 3D depth
- **Center Pin**: Radial gradient with bronze/gold tones and inset/outer shadows
- **Tonearm**: Horizontal arm with pivot mount (::before) and cartridge/needle (::after)
  - Position: top 0, right 0 with pivot at top-right corner (48deg rotation at rest)
  - Width: 72% of container
  - Transform origin: 100% 50% (right edge center for pivot rotation)
  - Playing state: rotate to 34deg
  - Pivot mount (::before): 24px circular element at right -12px offset
  - Cartridge/needle (::after): 16px element at left -4px, top -5px
  - Smooth 0.6s transition with cubic-bezier easing

### Background & Texture
- **Radial gradients** at 30% top-left and 70% bottom-right for subtle depth
- **Noise overlay** (SVG-based feTurbulence with feColorMatrix) with 0.55 opacity using multiply blend mode
- **Responsive**: Fixed 38vh center section, adjusts to 32vh below 700px viewport height

## 오디오 (Audio System)

- Web Audio API context with master gain node (gain value: 0.8)
- Direct routing: source → masterGain → destination
- Sample-based playback with fetch/decode infrastructure
  - `loadSample(name)`: Async loader with caching and pending request deduplication
  - `playSample(name)`: Plays cached audio buffer directly to masterGain
  - SAMPLE_URLS map with 12 MP3 assets: gangnam, ingan, yeoja, ssanai, op, wanjeon, ultungbultung, eo, ehy, damngirl, najeneun, meori
  - Samples are preloaded on app startup via `Object.keys(SAMPLE_URLS).forEach(loadSample)`
- All 12 sounds use sample-based playback (no synthesized sounds)
- **All FX and scratch sound generation have been removed**:
  - `playScratchTick()` function removed
  - Scratch canvas functionality removed
  - Glitch level tracking removed
  - Particle and ray emission removed
