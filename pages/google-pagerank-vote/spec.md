# Google PageRank Vote — Media Art Spec

## Status

Pre-production spec for `pages/google-pagerank-vote`.

This page is intended as a reel/web artwork concept, not yet an implementation. The reference video is stored next to this file as `reference.mp4`.

## Presentation

The video itself should not explain PageRank, show equations, or include instructional copy. Social copy is managed in Notion; see [the location guide](../../docs/social/README.md#캡션은-notion에서-확인).

## Reference

- File: `reference.mp4`
- Source imported from the Obsidian vault file `CFNetworkDownload_AmTGRd.tmp.mp4`
- Duration: 3.0s
- Size: 480 x 480
- SHA-256: `35975336d9905042517253887326527188a7f449de5c4d640eb1067a15308dc5`

### What To Keep

- Black background.
- White repeated text moving along closed organic loops.
- Pebble/island-like loop silhouettes.
- Dense typographic outlines that read first as texture, then as motion.
- Overall high-contrast, monochrome-first feel.

### What To Change

- Arrange the loops into a quickly recognizable Google `G` silhouette.
- Replace the reference text with short PageRank/search tokens.
- Add color propagation through contact points between nearby loops.
- Use Google colors as infection/rank energy, not as flat logo fill.

## Core Concept

A large Google `G` is built from many organic text conveyor belts.

Each conveyor belt is a closed loop. Short tokens repeat along its path and move continuously, like text printed on a belt. At first the scene is nearly monochrome. A single loop lights up, then color spreads through places where loops nearly touch. The spread should feel like rank/importance passing through links.

The audience should understand the motion without on-screen explanation: connection touches connection, and importance propagates.

## Canvas And Format

Primary target is Instagram reel capture.

- Design resolution: `1080 x 1920`.
- Runtime should remain responsive, but the art direction is vertical-first.
- Main `G` occupies roughly 80-88% of the viewport height.
- Keep enough black margin for the reference's stark contrast.
- Duration target: 12 seconds, loopable.
- First frame must already be moving.

## Visual System

### Silhouette

Use a geometric Google `G` mask, not a generic text glyph if possible.

The mask should preserve the fast recognition points:

- Circular outer body.
- Inner counter/hole.
- Right-side opening.
- Horizontal inner bar.

The loops must be placed only inside this mask. The mask itself is not drawn directly; it is revealed by the loop layout and later by color propagation.

### Loop Shape

Use organic pebble loops, closest to the reference.

Each loop is a closed Catmull-Rom or similar smooth path generated from 8-14 radial control points with jitter. Loops should feel hand-placed but be generated deterministically from a seed.

Loop requirements:

- Closed path.
- Rounded, irregular silhouette.
- No hard corners.
- Mostly separated from other loops.
- Some loops nearly touch to create propagation contact points.
- Reject loops that cross the `G` mask boundary too much.

### Text Tokens

Text is material, not explanation. Keep tokens short.

Recommended token pool:

```txt
LINK VOTE RANK PAGE SEARCH INDEX CRAWL PR
```

Optional rare tokens:

```txt
QUERY SCORE WEB
```

Avoid long explanatory phrases such as `PAGERANK ALGORITHM`. They weaken the reference texture and make the piece feel like an infographic.

### Color

Base state:

- Background: `#000000`.
- Inactive text: white to soft white, around `#f5f5f5`.
- Inactive glow: minimal or none.

Active Google colors:

- Blue: `#4285F4`
- Red: `#EA4335`
- Yellow: `#FBBC05`
- Green: `#34A853`

Color should attach to active text segments and nearby glow, not fill the entire loop as a solid shape. The final image should still look like text conveyor belts, not a flat Google logo.

## Auto Layout Algorithm

Use automatic placement.

1. Build an offscreen `G` mask.
2. Estimate a distance field from mask edges, or approximate one by rejecting points near edges.
3. Sample candidate loop centers inside the mask using Poisson-like spacing.
4. Assign loop radius based on local available space.
5. Generate organic closed paths around each center.
6. Reject candidates that:
   - leave the mask too much,
   - overlap existing loops too heavily,
   - fall inside the inner counter/open notch,
   - reduce `G` readability.
7. Allow near-contacts where paths come within a small threshold.
8. Build a loop graph from those near-contacts for color propagation.

Default target:

- Loop count: 45.
- Acceptable range: 35-55.
- Seeded randomness for reproducible recording.
- Contact threshold: visually near-touching, roughly 8-18 CSS px at 1080p scale.

If the generated layout does not read as `G` within 1 second, bias placement with more/smaller loops along the `G`'s outer stroke and horizontal bar.

## Animation

### Base Conveyor Motion

Every loop has text moving along its path from frame 0.

- No static intro.
- Each loop can have a slightly different speed.
- Adjacent loops should sometimes move in opposite directions for organic motion.
- The motion should be smooth and continuous, closer to the reference than to UI animation.

### Propagation

Color propagation is the PageRank metaphor.

- Start from one seed loop near the upper-left/left side of the `G`.
- The active color travels around that loop along the text path.
- When the active front reaches a near-contact point, the neighboring loop can ignite.
- Newly ignited loops repeat the process.
- Use small delays so propagation reads as contagion, not a global fade.
- Cycle or assign Google colors by region/path rather than randomly flashing.

Suggested timing:

| Time | State |
|---:|---|
| 0.0-1.0s | All loops already moving in white. `G` silhouette is readable but subtle. |
| 1.0-2.0s | First loop ignites blue. |
| 2.0-6.5s | Color spreads through contact points across nearby loops. |
| 6.5-9.5s | Multiple regions activate; `G` becomes unmistakable. |
| 9.5-12.0s | Color energy stabilizes into Google-colored paths while white inactive loops remain for contrast. |

### Looping

The piece should loop cleanly for web preview. For reel capture, a 12s one-way version is enough. If looped, decay active colors near the end and return to the monochrome base state.

## Interaction

Autoplay is the primary mode for reel capture.

Add pointer/touch interaction as a secondary web behavior:

- Tap/click near a loop: restart propagation from nearest loop.
- Drag/hover across loops: speed up activation along touched loops.
- If no pointer interaction happens, the deterministic autoplay sequence runs.

Do not add visible UI controls to the artwork surface unless needed for development. If debug controls are needed, hide them behind a dev flag or query param.

## Implementation Notes

Expected files for the later implementation:

```txt
pages/google-pagerank-vote/
  index.html
  script.ts
  style.css
  spec.md
  reference.mp4
```

Recommended modules inside `script.ts`:

- `buildGMask()` — geometric Google `G` mask.
- `generateLoops()` — automatic organic loop placement.
- `sampleLoopPath()` — equal-distance points along each loop.
- `buildContactGraph()` — near-contact detection between loops.
- `updatePropagation()` — color infection/rank spread.
- `drawTextOnPath()` — conveyor text rendering.
- `render()` — canvas loop.

Canvas 2D is sufficient. No Three.js is required.

Use `devicePixelRatio` scaling and keep all simulation coordinates in CSS pixels. Store sampled path points in typed arrays if text rendering or contact detection becomes heavy.

## Acceptance Criteria

- First frame is already animated.
- Within 1 second, the whole composition reads as a Google `G`.
- Close viewing reveals text moving along many organic closed loops, matching the reference language.
- Color spreads through near-contact points, not through a global fade.
- The final state uses Google colors but preserves the typographic conveyor texture.
- No on-screen equation or explanatory title appears in the animation.
- Works at mobile reel aspect ratio.
- Runs smoothly enough for screen recording.
