# Guseul Liquid Glass Reference Notes

## Sources

- Apple Newsroom: Liquid Glass is described as a translucent material that reflects and refracts its surroundings, adapts to content/context, and reacts to movement with specular highlights.
  - https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
- Kube.io: Recreates Liquid Glass in the browser with CSS/SVG displacement maps and physics-based refraction. The useful framing is that the background plane is warped through a displacement field, not drawn as a separate texture inside the glass.
  - https://kube.io/blog/liquid-glass-css-svg/
- childrentime/liquid-glass: Uses SVG `feDisplacementMap` with a dynamically generated canvas displacement map. The shader-like function calculates distance to the edge and increases displacement near that edge.
  - https://github.com/childrentime/liquid-glass
- shuding/liquid-glass: Uses a generated displacement map with `feDisplacementMap`. The fragment function maps each local UV to another UV, then the map is encoded into red/green channels for X/Y displacement.
  - https://github.com/shuding/liquid-glass
- rdev/liquid-glass-react: Wraps the same displacement-map idea in React and separates the wiggly backdrop layer from sharp foreground content. It also exposes modes, chromatic aberration, blur, saturation, and elasticity controls.
  - https://github.com/rdev/liquid-glass-react
- iyinchao/liquid-glass-studio: Uses WebGL2/WebGPU and lists the higher fidelity ingredients: refraction, dispersion, Fresnel reflection, SDF shapes, blur masking, anti-aliasing, and multipass rendering.
  - https://github.com/iyinchao/liquid-glass-studio
- AndrewPrifer/liquid-dom: Uses WebGPU plus the experimental HTML-in-Canvas API. The important reference point is that it does not use a single hard `edgeStart` threshold; it builds an SDF-derived surface-slope field, blurs that field, then computes refraction from IOR, thickness, dispersion, and a continuous bevel profile.
  - https://github.com/AndrewPrifer/liquid-dom
  - Inspected source snapshot: `5232ed5` (`2026-06-16`, "Adjust blending app layout spacing")

## Common Implementation Model

Liquid Glass implementations do not usually place a decorative image inside the glass. They render or capture a background plane, then resample that same plane through a displacement field.

The important fields are:

- `distanceToEdge`: how close the current pixel is to the glass boundary.
- `edgeT`: a smooth value that is small in the center and large near the edge.
- `normal`: the direction from the glass center or SDF boundary toward the current pixel.
- `source`: the coordinate in the underlying plane to sample.

The usual shape is:

```ts
const distanceToEdge = radius - length(p);
const edgeT = smoothstep(edgeWidth, 0, distanceToEdge);
const source = p + normal * pull(edgeT) + tangent * swirl(edgeT);
```

The displacement map approach then encodes `source - p` into red/green channels and lets `feDisplacementMap` warp the backdrop. A direct canvas/WebGL implementation can skip the SVG map and directly sample the source plane.

## Why The Previous Guseul Model Was Wrong

The previous Guseul prototype rendered an offscreen content texture and only sampled it inside the ball. Outside the ball was a separate white band. That made the image read as a pattern inside the sphere rather than a continuous plane being bent by glass.

It had this structure:

```text
outside ball: white band
inside ball: separate content texture
```

The target behavior is:

```text
outside ball: visible 2D content plane
inside ball: the same plane sampled through nonlinear glass displacement
```

This is the key difference behind the "plane stretches at the edge" look. A colored/image region should be visible outside the glass and then visibly dragged, compressed, and smeared as it crosses the glass edge.

## Guseul Implementation Direction

For the current prototype:

- Draw one source plane for the white band and colored placeholder circles.
- Draw that plane normally first.
- Render the glass ball by sampling the same plane in screen coordinates.
- Keep the center close to identity sampling.
- Apply stronger nonlinear radial pull, tangent smear, blur, and chromatic offset in an edge annulus.
- Add specular/rim/fresnel as a shell pass after refraction.

The next fidelity step after the placeholder circles is replacing the source plane with photo/image cards. The same displacement model should remain unchanged.

## Current Prototype Structure

After comparing the first implementation with the reference, the page changed away from a visible outside source-plane model. The colored placeholder circles should live inside the marble, while the outside remains mostly a white stage.

The Guseul page now follows this order:

1. Draw the black background and plain white band.
2. Draw a ball-sized offscreen content layer with only complete colored circles. No ellipse scaling or decorative curved cuts are used.
3. Move that internal circle layout with drag offset.
4. For each circle center, calculate the sphere normal's camera-facing component:

```ts
const normalDotCamera = sqrt(1 - x * x - y * y);
```

5. Reduce the circle size as `normalDotCamera` approaches `0`, because that means the surface normal is becoming perpendicular to the camera vector.
6. Render the glass ball by resampling that internal content layer through an edge displacement field.
7. Near the rim, sample inward and add tangent smear/chromatic offsets so content appears squeezed and pulled by the glass edge.
8. Add shell-only lighting: rim, fresnel wash, glass haze, and specular highlights.

The important implementation detail is that the colored circles are not visible outside the ball. The drag interaction adjusts their internal positions. Edge proximity is suggested by circle scale reduction, then reinforced by a Liquid Glass-style resampling pass that bends the internal content strongest in the rim annulus.

## 2026-07-06 Edge-Following Distortion Notes

The current Guseul baseline is intentionally simple again: each output pixel near the marble rim samples a point farther inward from the same internal content plane. This is stable, but it only creates radial compression:

```ts
const edgeT = smoothstep(edgeStart, edgeEnd, radial);
const edgeFold = edgeT ** inwardPower * radius * inwardStrength;
const source = p - normal * edgeFold;
```

That is not the full Liquid Glass look. Apple describes the material as lensing: it bends and concentrates light through the glass shape. Public web implementations approximate that by building a displacement field from the glass boundary, usually through an SDF or an authored displacement map:

- Apple: Liquid Glass is identified by lensing, with light bending around the material and stronger refraction when the material feels thicker.
  - https://developer.apple.com/videos/play/wwdc2025/219/
- Kube.io: the web prototype uses SVG displacement maps and says the field comes from a rounded bezel profile; pixels are pushed along the profile gradient.
  - https://kube.io/blog/liquid-glass-css-svg/
- childrentime/liquid-glass: generates an SVG displacement map from a distance-to-edge function; red and green encode x/y pixel movement.
  - https://github.com/childrentime/liquid-glass/blob/main/LIQUID_GLASS_EFFECT_EN.md
- rdev/liquid-glass-react: exposes modes for edge bending/refraction, chromatic aberration, and elasticity around an SVG displacement-map implementation.
  - https://github.com/rdev/liquid-glass-react

For Guseul, the next useful model should stay analytic instead of returning to per-circle contact gates:

1. Treat the marble boundary as the SDF: `distanceToEdge = 1 - radial`.
2. Build a rim band: `rimT = 1 - smoothstep(0, rimWidth, distanceToEdge)`.
3. Use the SDF gradient as the glass edge normal: `normal = normalize(p)`.
4. Use the perpendicular vector as tangent: `tangent = vec2(-normal.y, normal.x)`.
5. Apply two coordinated offsets:
   - normal pull: samples deeper inside the plane near the rim.
   - tangent magnification: compresses source coordinates along tangent inside the rim band, so the output appears stretched along the marble edge.
6. Keep chromatic and specular layers on top of this sampling field.

In inverse-sampling terms, tangent magnification means the output covers a wider arc than the source sample interval. The code should not smear arbitrary extra samples; it should calculate a single source coordinate in the rim's local normal/tangent basis, then optionally add chromatic offsets from that same field.

This should address the reference behavior more directly: when a colored plane approaches the rim, it should broaden and flow along the glass edge instead of only being pulled inward.

## 2026-07-06 Implementation Update

The Guseul sampler now implements that model directly in canvas instead of generating an SVG displacement map:

```ts
const normalPull = edgeT ** inwardPower * inwardAmount;
const edgeStretch = edgeT ** edgeStretchPower * edgeStretchAmount;
const edgeScale = 1 - edgeStretch;
const source = p * edgeScale - normal * normalPull;
```

This keeps the old inward pull as the normal-axis refraction, then adds Liquid Glass-style coordinate scaling in the rim band. The scaling is the important part for the edge-following look: near the marble boundary, a wider output arc samples a smaller source arc, so colored circles and their white strokes appear broadened along the edge.

The implementation is still analytic and marble-level. It does not inspect per-circle pixels or reintroduce contact gates, so every colored plane follows the same continuous glass field.

## 2026-07-06 AndrewPrifer/liquid-dom Implementation Notes

`liquid-dom` is the closest inspected reference for HTML-in-Canvas Liquid Glass. It is a WebGPU renderer, not a CSS-only filter. Its repo is split into:

- `@liquid-dom/core`: imperative scene graph, DOM-backed content capture, WebGPU render core, shaders, and layout bridge.
- `@liquid-dom/react`: React components over the same scene/layout objects.
- `@liquid-dom/three` and `@liquid-dom/r3f`: adapters that composite the same WebGPU glass pass over a Three WebGPU scene.
- `@liquid-dom/layout`: renderer-agnostic layout engine.

The scene graph has three important node levels:

```text
Scene
  Html        -> normal scene/backdrop DOM layers
  Container   -> one optical material / one fused SDF field
    Glass     -> one or more glass shapes inside the container
      Html    -> DOM content sampled through that glass
```

A `Container` owns the optical constants shared by its child glass shapes: `blur`, `bezelWidth`, `thickness`, `displacementFactor`, `displacementBlur`, `ior`, `contentIor`, `contentDepth`, `dispersion`, `surfaceProfile`, tint, shadow, reflection, and specular controls. A `Glass` owns geometry: width, height, corner radius, smoothing, transform, pointer behavior, and z order.

### DOM Capture Pipeline

`liquid-dom` uses Chrome's experimental HTML-in-Canvas API for real DOM content:

1. The renderer canvas is marked with `layoutsubtree="true"`.
2. Each `Html` node owns a real `HTMLElement` host.
3. The renderer keeps those hosts mounted under the canvas and synchronizes CSS transforms/z-index to match the scene graph.
4. Canvas `paint` events identify changed DOM hosts.
5. `GPUQueue.copyElementImageToTexture()` copies each host into a GPU texture.
6. Scene-level HTML uses individual textures; HTML inside glass is packed into a shared atlas.
7. Optional `Html.blur` is not CSS blur. It is applied by the WebGPU adaptive blur pipeline after the DOM texture copy.

That means the glass pass works from textures, but the source content can still be live DOM. For Guseul, our colored-circle offscreen canvas is equivalent to a much simpler glass-content texture source.

### Render Order

The core frame loop is a multipass ping-pong compositor:

1. Start from an optional external backdrop texture.
2. Composite scene-level `Html` layers in z order.
3. For each `Container`:
   - pack active `Glass` shapes into a shape buffer.
   - upload container optical uniforms.
   - blur the current scene texture into a backdrop-blur target.
   - render a displacement/surface field from the fused SDF.
   - blur that displacement field by `displacementBlur`.
   - render and blur the shadow mask.
   - run the main glass shader over the current scene.
4. Blit the final ping-pong texture to the canvas/output texture.

The key part for edge behavior is that the displacement field is a separate intermediate texture. It is not calculated as a one-off offset inside the final color shader only.

### SDF And Surface Profile

`liquid-dom` builds the glass boundary from SDF samples:

- Each `Glass` is evaluated as a smooth rounded rectangle / squircle SDF in local space.
- Multiple glass shapes inside one `Container` are fused with a smooth union.
- Normal gating and blend-support gating suppress invalid smoothing when shapes overlap or are nested.
- The SDF sample returns both distance and gradient. The gradient is the edge normal used for rim, refraction, and specular.

For the displacement field, the shader computes:

```ts
inwardDistance = max(-distance, 0)
bezelProgress = clamp(inwardDistance / bezelWidth, 0, 1)
surfaceDerivative = derivative(surfaceProfile, bezelProgress)
surfaceSlope = sdfGradient * surfaceDerivative
```

This is the major difference from our current Guseul `edgeStart` control. `liquid-dom` does not say "start all distortion at normalized radius 0.85." It defines a physical bevel width in pixels, evaluates a continuous surface-height profile inside that bevel, and uses the profile derivative as the slope field. The effective edge region is therefore continuous and tied to the glass SDF.

Supported `surfaceProfile` modes are:

- `convex`: outward dome-like bevel.
- `concave`: inverted curve.
- `lip`: blends convex and concave for a raised rim/lip.

The displacement prepass writes the slope field premultiplied by the fill mask, then blurs it. Blurring the field lets the edge influence spread smoothly without creating an abrupt bend where a hard annulus begins.

### Refraction Shader

The main glass shader samples the blurred surface-slope field and rebuilds a 3D-ish normal:

```ts
surfaceNormal = normalize(vec3(surfaceSlope.x, surfaceSlope.y, 1))
```

It then uses `refract()` with the configured IOR to bend a camera ray through the surface. Red, green, and blue use slightly different IOR values when `dispersion` is enabled, which creates chromatic separation. The resulting ray direction is projected into screen-pixel displacement:

```ts
displacementPx = refractedRay.xy / -refractedRay.z * surfaceHeight * displacementFactor
refractedUv = uv + displacementPx / canvasSize
```

Backdrop color is sampled from the blurred backdrop texture at three channel-specific UVs. This gives the "background/content is pulled through glass" look.

Glass-attached HTML content is handled separately:

- content uses `contentIor` and `contentDepth` instead of the container's main `ior`/`thickness`.
- content layers are sampled from the glass content atlas.
- red/green/blue local positions are offset independently if dispersion is enabled.
- the sampled content is composited over the tinted refracted backdrop before specular highlights.

### Lighting And Shell

After refraction and content compositing, the shader adds shell effects:

- tint over the refracted glass interior.
- reflection color sampled from the blurred backdrop along the rim normal.
- reflection is gated by backdrop/refraction luminance, so it appears when reflected content is bright and the refracted interior can accept it.
- white rim specular is a separate band based on SDF distance in screen pixels and normal-light alignment.
- opposite-side specular can be added with its own strength/falloff.

Specular width is resolved in device pixels, and derivative-scaled SDF distance is used so hairline highlights do not become wider when SDF blending changes the distance scale.

### What This Means For Guseul

The current Guseul prototype is simpler:

```ts
edgeT = smoothstep(edgeStart, edgeEnd, radial)
normalPull = edgeT ** inwardPower * inwardAmount
edgeStretch = edgeT ** edgeStretchPower * edgeStretchAmount
source = p * (1 - edgeStretch) - normal * normalPull
```

This can create a readable rim stretch, but it has two structural weaknesses:

1. `edgeStart` creates a normalized annulus with a visible behavioral boundary. When `edgeStart` is high, the distortion is squeezed into a very thin band, so overlapping colored planes can appear to kink or fold abruptly near the rim.
2. `edgeStretch` directly scales coordinates in the final sampler. It does not model a surface slope field, blur that field, then derive refraction from a normal. So it can look like 2D coordinate compression instead of light bending through a glass shell.

A closer canvas implementation should replace the hard annulus with the same conceptual steps as `liquid-dom`, adapted to a circular marble:

```ts
distance = radial - 1
inwardDistance = max(-distance, 0)
bezelProgress = clamp(inwardDistance / bezelWidth, 0, 1)
slope = profileDerivative(bezelProgress)
surfaceSlope = normal * slope
```

Then either:

- approximate field blur analytically or with a small offscreen texture pass; and
- use the slope to compute a single refraction displacement, with chromatic offsets derived from the same field.

For tuning, the Guseul controls should eventually map closer to:

- `bezelWidth`: how far the rim profile reaches inward.
- `surfaceProfile`: convex/concave/lip-like curve choice.
- `thickness`: how much refraction displacement the surface height can produce.
- `displacementFactor`: overall multiplier after the optical model.
- `displacementBlur`: how softly the rim influence spreads.
- `ior` / `dispersion`: base bending and chromatic separation.

This is why the reference implementations feel less like a thresholded edge band: the edge is an SDF-derived bevel profile plus a blurred slope field, not a fixed normalized radius cutoff.

## 2026-07-06 Guseul Liquid-DOM-Inspired Refactor

The Guseul canvas implementation now mirrors the useful parts of `liquid-dom` without moving the page to WebGPU:

```text
draw content texture
  -> render circular SDF surface field
  -> blur surface field
  -> sample content through refracted ray offsets
  -> add shell lighting
```

The old hard annulus controls were removed from the live sampler:

- removed from code path: `edgeStart`, `edgeEnd`, `inwardStrength`, `edgeStretchStrength`.
- new live controls: `surfaceProfile`, `bezelWidth`, `thickness`, `displacementFactor`, `displacementBlur`, `ior`, `dispersion`.

The new intermediate field stores:

- `slopeX`
- `slopeY`
- `fillMask`

It is premultiplied by `fillMask` before blur, matching the `liquid-dom` pattern where the displacement field can blur across the edge without leaking invalid vectors. When the final sampler reads the field, it divides the blurred slope by the blurred mask.

The circular marble is treated as the SDF:

```ts
distance = radial - 1
inwardDistance = max(1 - radial, 0)
bezelProgress = clamp(inwardDistance / bezelWidth, 0, 1)
slope = derivative(surfaceProfile, bezelProgress)
surfaceSlope = normal * slope
```

The final color sampler now rebuilds a surface normal and computes refraction:

```ts
surfaceNormal = normalize(vec3(surfaceSlope.x, surfaceSlope.y, 1))
ray = refract(cameraRay, surfaceNormal, 1 / ior)
source = outputPixel + ray.xy / -ray.z * surfaceHeight * displacementFactor
```

Chromatic separation now follows the same optical path by evaluating the red and blue rays with `ior + dispersion` and `ior - dispersion`. This is closer to `liquid-dom` than the previous radial `aberration` offset because the color split comes from the same slope field as the main refraction.

This is still not a full `liquid-dom` port:

- There is no DOM-to-texture capture path.
- There is no WebGPU adaptive blur pyramid.
- There is only one circular SDF shape, so smooth-union, normal gating, and blend-support gating are unnecessary.
- The internal colored circles are still generated directly into an offscreen canvas instead of packed into an atlas.

The important structural change is that Guseul now has a separate surface-field prepass. Future tuning should happen by shaping `bezelWidth`, `surfaceProfile`, `thickness`, `displacementFactor`, and `displacementBlur`, not by reintroducing a fixed `edgeStart` threshold.

## 2026-07-06 Edge Kink Follow-Up

The sharp bend seen on colored circles near the marble edge was not an unavoidable glass artifact. It came from an artificial source-texture boundary:

```text
content texture was clipped to a circle first
  -> refraction sampled that already-clipped texture
  -> near the rim, source coordinates hit the clip boundary or texture clamp
  -> colored planes appeared to kink or flatten at the edge
```

That is different from the `liquid-dom` model. In `liquid-dom`, source/backdrop textures exist as larger planes, and the glass shape masks the final composite. The source texture is not pre-cut to the exact glass silhouette before refraction.

The Guseul source layer now uses a larger internal content plane with overscan:

- colored circles are drawn beyond the visible marble silhouette into an offscreen guard band.
- the final glass ball alpha still clips the visible result to a perfect circle.
- `sampleContent()` returns the background color when sampling outside the overscan plane instead of clamping to the texture edge.
- GUI folders are reorganized by pipeline stage: scene, source content, surface field, refraction, glass shell, final composite.

This does not remove every possible fold from extreme optical settings. A very high `thickness`, high `displacementFactor`, or narrow `bezelWidth` can still make the inverse mapping non-monotonic. But the visible one-sided kink from the reference screenshot should be reduced because the sampler no longer runs into a pre-clipped content edge.

## 2026-07-07 Experimental Smear/Tangent Removal

The live prototype no longer has the separate `edge smear` or tangent-slip sampling layers. Those controls were local experiments for forcing edge-following color spread, but they are not part of the `liquid-dom`-style structure.

Current live sampling is:

```text
source content
  -> SDF surface field with blur
  -> refracted source coordinate
  -> optional chromatic dispersion from the same refracted field
  -> glass shell overlays
  -> final circular composite
```

This keeps the edge behavior tied to one optical field. If the edge needs more stretch later, tune the surface field (`bezelWidth`, `profilePower`, `displacementBlur`, `thickness`, `displacementFactor`) instead of adding extra tangent or smear samples that create multiple competing directions.

## 2026-07-07 Outer Edge Displacement Fade

The prototype now fades source displacement down at the absolute outer rim with `edgeFadeWidth`. This is applied after the surface field is sampled and before RGB refraction offsets are calculated:

```text
refractionHeight = surfaceHeight * smoothFadeFromOuterRim
source = outputPixel + refractedRay.xy * refractionHeight
```

The glass shell layers still draw to the full circular silhouette. Only the internal source-image displacement is faded, which reduces the small reverse bend that can appear when a highly displaced source coordinate meets the final circular mask.
