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
├── .pad-grid (3x4 sound pad grid)
│   ├── Layout: CSS grid with 4 columns, auto-sized rows, top-aligned content
│   ├── Grid template: `grid-template-columns: repeat(4, 1fr); grid-auto-rows: min-content; align-content: start;`
│   ├── Padding: 16px 18px max(22px, env(safe-area-inset-bottom)) 18px
│   ├── Gap: 12px
│   ├── .pad.row-gangnam (4x)
│   │   ├── Aspect ratio: 1:1 (square)
│   ├── .pad.row-fart (4x)
│   │   ├── Aspect ratio: 1:1 (square)
│   └── .pad.row-hanroro (4x)
│       ├── Aspect ratio: 1:1 (square)
│       └── Last pad: meori (머리푸는)
├── .player (media player controls)
│   ├── .player-btn#playPause (play/pause button)
│   │   └── aria-label="play"
│   └── .player-bar#seekbar (playback progress slider)
│       ├── type="range", min="0", max="1000", value="0", step="1"
└── audio#bgm (background audio element)
    └── preload="metadata"
```

## 상호작용 (Interactions)

### LP Player (Primary - lp)
- **Tap**: Initialize audio context and start playback
- **Scrubbing Interaction**: Interactive drag control for vinyl rotation
  - CSS variable `--lp-angle` controls rotation angle dynamically
  - **Pointerdown**: Add 'scrubbing' class, display cursor: grabbing
  - **Pointermove**: Update `--lp-angle` based on drag movement
  - **Pointerup**: Remove 'scrubbing' class, reset cursor
- Label element is now empty (no text content or canvas)
- No longer auto-spinning (animation removed) — rotation is now user-controlled

### LP Player (Secondary - lp2)
- **Tap**: Initialize audio context and start playback
- Display-only "강남스타일" by PSY album reference with animated tonearm
- Label element is empty (no text content)

### Sound Pads
- **Pointerdown**: Initialize audio context (if not already started), play associated sample sound, add 'held' class for visual feedback
  - If app not started: Call `startApp()` to initialize audio context, then immediately play the sound and add visual feedback
  - Call `pad.setPointerCapture(e.pointerId)` to capture pointer events (wrapped in try-catch for browser compatibility)
  - 'held' state: Translate down 6px, scale to 0.97, brighten to 1.18x, saturate to 1.25x
  - Gloss opacity reduced to 0.3 with scaleY(0.7) transform
  - Row-specific shadow adjustments for pressed appearance
- **Pointerup/Pointercancel/Lostpointercapture**: Remove 'held' class and release pointer capture
  - Call `pad.releasePointerCapture(e.pointerId)` on pointerup and lostpointercapture (wrapped in try-catch)
  - Removed `pointerleave` event listener (replaced with `lostpointercapture` for proper capture handling)
- All visual effects (rays, particles, glitch updates) have been removed

### Media Player Controls
- **.player-btn#playPause**: Play/pause toggle button
  - **Click**: Toggle playback state of #bgm audio element
  - Visual state updates based on audio playback status
- **.player-bar#seekbar**: Range input for audio progress control
  - **Input**: Updates playback position of #bgm audio element
  - Range: 0-1000 (normalized scale, maps to audio duration)
  - Step: 1 unit per increment
  - **Pointerup**: Seek to selected position in audio playback
- **#bgm audio element**: Hidden audio player
  - Preloads metadata for accurate duration information
  - Connected to player controls for playback synchronization

## 스타일 (Styling)

### Color System
- Light paper background (`--paper: #f4ead5`) with warm paper secondary (`--paper-warm: #e8d5b0`)
- Deep paper accent (`--paper-deep: #c4b390`)
- Dark ink text (`--ink: #1a1410`, soft: `--ink-soft: #3d2e25`)
- Neon accents: pink (`#ff2e93`), cyan (`#00f0ff`), yellow (`#fff200`)

### Button/Pad Styling
- **Skeuomorphic 3D Design**: Heavy inset box-shadows and layered radial gradients for tactile raised button appearance
- **Paper Texture**: Grain noise filter (SVG-based) applied to Hanroro (cream) row buttons
- **Neon Glows**: Bright colors with simplified box-shadow halos on Gangnam (pink) and Fart (cyan) buttons
  - **Gangnam (pink)**: Streamlined shadow with 7 outer layers (base highlight + 5 gradient steps + far blur) for enhanced depth
    - Base layer: `0 1px 0 rgba(255, 150, 200, 0.5)` (soft highlight)
    - Gradient step 1: `0 2px 0 #d6207f` (first solid shadow)
    - Gradient step 2: `0 3px 0 #b81570` (second solid shadow)
    - Gradient step 3: `0 4px 0 #960e5e` (third solid shadow)
    - Gradient step 4: `0 5px 0 #730a4a` (fourth solid shadow)
    - Gradient step 5: `0 6px 0 #4a052b` (fifth solid shadow)
    - Mid-blur layer: `0 8px 10px rgba(80, 5, 40, 0.5)` (medium spread)
    - Far-blur layer: `0 16px 24px rgba(60, 30, 40, 0.35)` (distant shadow)
  - **Fart (cyan)**: Streamlined shadow with 7 outer layers (base highlight + 5 gradient steps + far blur) for enhanced depth
    - Base layer: `0 1px 0 rgba(180, 255, 255, 0.6)` (soft highlight)
    - Gradient step 1: `0 2px 0 #00bcd0` (first solid shadow)
    - Gradient step 2: `0 3px 0 #00a0b4` (second solid shadow)
    - Gradient step 3: `0 4px 0 #007a8c` (third solid shadow)
    - Gradient step 4: `0 5px 0 #005268` (fourth solid shadow)
    - Gradient step 5: `0 6px 0 #003a48` (fifth solid shadow)
    - Mid-blur layer: `0 8px 10px rgba(0, 50, 60, 0.5)` (medium spread)
    - Far-blur layer: `0 16px 24px rgba(20, 50, 60, 0.35)` (distant shadow)
  - **Hanroro (cream)**: Streamlined shadow with 7 outer layers (base highlight + 5 gradient steps + far blur) for enhanced depth
    - Base layer: `0 1px 0 rgba(255, 250, 230, 0.7)` (soft highlight)
    - Gradient step 1: `0 2px 0 #c8b896` (first solid shadow)
    - Gradient step 2: `0 3px 0 #a8967a` (second solid shadow)
    - Gradient step 3: `0 4px 0 #877555` (third solid shadow)
    - Gradient step 4: `0 5px 0 #685739` (fourth solid shadow)
    - Gradient step 5: `0 6px 0 #4a3e2a` (fifth solid shadow)
    - Mid-blur layer: `0 8px 10px rgba(80, 60, 30, 0.5)` (medium spread)
    - Far-blur layer: `0 16px 24px rgba(80, 60, 30, 0.35)` (distant shadow)
- **Highlight Gloss**: Subtle white gradient overlay on button surface (::after pseudo-element)
- **Interaction State**: 'held' class for pressed state with brightness/saturation boost and reduced gloss opacity

### Label Typography (.pad .label-ko)
- **Font Family**: 'Black Han Sans', sans-serif (default for all pads)
- **Font Size**: `clamp(15px, 4.4vw, 20px)` — responsive sizing between 15px (minimum) and 20px (maximum)
- **Line Height**: 1.05 — minimal extra spacing for vertical alignment
- **Letter Spacing**: -0.02em (tight kerning)
- **Text Align**: center — centered horizontally on pad
- **Text Shadow**: 0 1px 0 rgba(0, 0, 0, 0.18) — subtle drop shadow for readability
- **Multi-line Support**: Labels may contain `<br>` tags for line breaking (e.g., "Damn<br>Girl", "낮에는<br>따사로운")
- **Override for Hanroro (cream) row**: Uses 'Gowun Batang' serif at `clamp(12px, 3.4vw, 16px)` with font-weight 700

### LP Player Styling
- **LP Wrap Container (.lp-wrap)**:
  - **Fixed Upper-Right Lighting (.lp-wrap::after)**:
    - Pseudo-element that provides fixed top-right illumination independent of LP rotation
    - Ellipse positioned at 75% 18% with warm cream colors
    - Gradient stops: `rgba(255, 245, 220, 0.35) 0%`, `rgba(255, 240, 210, 0.12) 25%`, `transparent 50%`
    - Uses `mix-blend-mode: screen` for light blending effect
    - `pointer-events: none` to avoid interaction interference
    - `z-index: 4` (above record, below tonearm)

- **Vinyl Record**: Dark repeating-radial-gradient with realistic platter appearance
  - Repeating-radial-gradient: White semi-transparent lines (`rgba(255, 255, 255, 0.09)`) at 1px with 6px spacing for groove effect
  - Radial-gradient: Center positioned at 35% 28% with gradient stops at `#2a2018 0%`, `#120e0a 55%`, `#050402 100%`
- **Inset Shadows**: Single deep inner shadow (`inset 0 0 30px rgba(0, 0, 0, 0.55)`) for 3D depth
- **Center Pin**: Radial gradient with bronze/gold tones and inset/outer shadows
- **Tonearm**: Horizontal arm with pivot mount (::before) and cartridge/needle (::after)
  - Position: top 0, right 0 with pivot at top-right corner (48deg rotation at rest)
  - Width: 72% of container
  - Transform origin: 100% 50% (right edge center for pivot rotation)
  - Playing state: rotate to 34deg
  - Pivot mount (::before): 24px circular element at right -12px offset
  - Cartridge/needle (::after): 16px element at left -4px, top -5px
  - Smooth 0.6s transition with cubic-bezier easing

### Media Player Controls Styling (.player, .player-btn, .player-bar)
- **.player** (container):
  - Layout: `flex: 0 0 auto` with flex direction row, center-aligned items, 14px gap
  - Padding: `10px 18px max(14px, env(safe-area-inset-bottom)) 18px` (responsive bottom padding for safe areas)
  - Background: Linear gradient `180deg, #f4ead5 0%, #e3d5b8 100%` (warm paper to deeper paper)
  - Border: Top border `1px solid rgba(110, 80, 50, 0.25)` (subtle dark divider)
  - Shadows: Inset top highlight and bottom soft shadow for subtle depth
  
- **.player-btn** (play/pause button):
  - Dimensions: 44px diameter circular button (`border-radius: 50%`)
  - Background: Radial gradient with ellipse at 30% 25% from light (`#fdf6e0`) to cream (`#f4ead5`) to deep brown (`#c4b390`)
  - Box-shadow: Complex 5-layer shadow system
    - Inset highlight: `inset 0 1px 0 rgba(255, 252, 240, 0.9)` (top light)
    - Inset mid-shadow: `inset 0 -2px 4px rgba(140, 110, 70, 0.4)` (bottom depth)
    - Outer layers: Solid shadows at 2px and 4px offsets, plus soft blur for 3D embossed effect
  - State transitions: `transform 0.06s, box-shadow 0.06s` for quick visual response
  
- **.player-btn::before** (play icon):
  - Default state: Triangle pointing right (play icon) using border trick
    - `border-left: 12px solid var(--ink)` with transparent top/bottom
    - Positioned center with `transform: translate(-35%, -50%)`
  - Playing state (`.player-btn.playing::before`): Pause icon using linear-gradient bars
    - Two vertical bars rendered via gradient pattern
    - `background: linear-gradient(90deg, var(--ink) 0 35%, transparent 35% 65%, var(--ink) 65% 100%)`
  
- **.player-btn:active** (pressed state):
  - Transform: `translateY(3px)` (pushed down appearance)
  - Box-shadow: Reduced depth shadows to match inset pressed effect
  
- **.player-bar** (progress slider):
  - Layout: `flex: 1 1 auto` to fill available width
  - Height: 8px track with 6px border-radius for rounded appearance
  - Background: Linear gradient `180deg, #c4b390 0%, #9a8866 100%` (paper deep to mid-brown)
  - Appearance: Reset with `-webkit-appearance: none; appearance: none;`
  - Outline: Removed for clean look
  - Box-shadow: Inset shadows for track depth and subtle highlights
  
- **.player-bar::-webkit-slider-thumb** (slider thumb - Webkit):
  - Dimensions: 18px circular thumb
  - Background: Radial gradient with light center (`#fdf6e0`) to mid-brown (`#c4b390`) to dark (`#6e5e44`)
  - Box-shadow: Inset highlight plus outer shadow for 3D embossed appearance
  - Cursor: pointer
  
- **.player-bar::-moz-range-thumb** (slider thumb - Firefox):
  - Identical styling to Webkit version for cross-browser consistency
  - No border (reset with `border: none`)
  - Same radial gradient and shadow system

### Background & Texture
- **Radial gradients** at 30% top-left and 70% bottom-right for subtle depth
- **Noise overlay** (SVG-based feTurbulence with feColorMatrix) with 0.55 opacity using multiply blend mode
- **Responsive**: Fixed 38vh center section, adjusts to 32vh below 700px viewport height

## 오디오 (Audio System)

- Web Audio API context with master gain node (gain value: 1.7)
- Audio routing chain: source → masterGain → **dynamics compressor (limiter)** → destination
- **Dynamics Compressor (Limiter)** settings for peak control:
  - Threshold: -3 dB (triggers compression above -3 dB)
  - Knee: 6 dB (smooth transition zone)
  - Ratio: 12:1 (strong compression ratio)
  - Attack: 0.003 seconds (3ms fast response)
  - Release: 0.08 seconds (80ms recovery time)
- Sample-based playback with fetch/decode infrastructure
  - `loadSample(name)`: Async loader with caching and pending request deduplication
  - `playSample(name)`: Plays cached audio buffer directly to masterGain
  - SAMPLE_URLS map with 12 MP3 assets: gangnam, ingan, yeoja, ssanai, op, wanjeon, ultungbultung, eo, ehy, damngirl, najeneun, meori
  - BGM_URL: Background music track loaded separately (`./assets/bgm.mp3`) with volume set to 0.33
  - Samples are preloaded on app startup via `Object.keys(SAMPLE_URLS).forEach(loadSample)`
- All 12 sounds use sample-based playback (no synthesized sounds)
- **All FX and scratch sound generation have been removed**:
  - `playScratchTick()` function removed
  - Scratch canvas functionality removed
  - Glitch level tracking removed
  - Particle and ray emission removed

## 구현 상세 (Implementation Details)

### Animation Loop & Rendering
- **Animation Frame Loop (`tick` function)**:
  - Runs on `requestAnimationFrame` for 60fps smooth rotation
  - Calculates delta time (dt) with 50ms cap for stability
  - Updates both LP rotation angles based on playback state
  - Updates seekbar position synchronized with audio currentTime
  
### LP Player Controls
- **Primary LP (lp) - Interactive Scrubbing**:
  - Angle tracking: `pointerAngleOnLP()` calculates angle from center using `atan2`
  - Scrubbing state: `leftScrubbing` boolean tracks active drag
  - Delta calculation with wraparound handling (±180° normalization)
  - Audio seek mapping: `delta * SCRUB_SEC_PER_DEG` (12 seconds per full rotation)
  - Pointer capture for smooth off-screen dragging
  - Visual feedback: 'scrubbing' class adds `cursor: grabbing`
  
- **Secondary LP (lp2) - Synchronized Rotation**:
  - Spins at same SPIN_DPS rate as primary when playing
  - No scrubbing interaction (display-only)
  
### Playback Control
- **Play/Pause Button (#playPause)**:
  - Click handler toggles bgm.play() / bgm.pause()
  - Async play with error handling
  - UI sync function `syncPlayingUI()` updates button and tonearm classes based on bgm state
  - Event listeners: 'play', 'pause', 'ended' events trigger UI updates
  
- **Seekbar (#seekbar)**:
  - Range input (0-1000) normalized to audio duration
  - Input event updates bgm.currentTime
  - Pointerdown/pointerup flag prevents scrubbing conflicts
  - Reading seekbarDragging prevents animation loop from overwriting user input

### Constants
- `SPIN_DPS = 100`: Rotation speed in degrees per second (≈3.6 seconds per full revolution)
- `SCRUB_SEC_PER_DEG = 12 / 360`: Playback time delta per degree of rotation (12 seconds per full turn)
