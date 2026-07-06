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
