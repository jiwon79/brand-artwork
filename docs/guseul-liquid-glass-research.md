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

## Applied Prototype Structure

The Guseul page now follows this order:

1. Render the visible black background, white band, and colored placeholder circles into an offscreen `sourceCanvas`.
2. Draw that exact source plane to the main canvas.
3. Render the glass ball into `ballCanvas`.
4. For each ball pixel, convert its local circle coordinate back to screen coordinates and sample `sourceCanvas` with nonlinear displacement.
5. Add shell-only lighting: rim, fresnel wash, chromatic edge offset, and specular highlights.

The important implementation detail is that the colored circles outside the ball and the distorted colors inside the ball come from the same `sourceCanvas`. This is what creates the visible "connected plane being dragged through glass" effect.
