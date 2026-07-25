# Guseul WebGL2 Renderer (Historical Notes)

> 이 문서는 CPU renderer에서 WebGL2로 이전할 당시의 기록이다. 현재 구현에는 Canvas fallback, `renderer`/`perf` URL parameter, surface field texture가 없다. 최종 구조는 [`guseul-architecture.md`](./guseul-architecture.md)를 기준으로 본다.

## Why The Renderer Changed

The original renderer filled an `ImageData` buffer on the main thread for every marble pixel. Each pixel sampled the source content several times for refraction and chromatic separation, then the completed buffer was copied back with `putImageData`.

That made render cost grow with both marble area and device pixel ratio:

```text
CSS marble diameter * DPR
  -> physical pixel width
  -> width * width fragment count
  -> multiple source samples per pixel on the CPU
```

The WebGL2 backend keeps interaction and scene state in TypeScript, but moves per-pixel glass work into one fragment shader.

## Runtime Selection

WebGL2 is the default renderer. The page records the selected backend on the visible canvas:

```text
canvas[data-renderer="webgl2"]
canvas[data-renderer="canvas"]
```

If WebGL2 initialization or shader compilation fails, the page falls back to the existing Canvas2D renderer. The fallback can also be selected explicitly for visual comparison:

```text
/pages/guseul/?renderer=canvas
```

## Frame Pipeline

The CPU still owns scene-level work:

1. Update drag, inertia, idle rotation, and spec orientation.
2. Project the photo circles to front/back sphere positions.
3. Draw the ordered photo circles into the existing Canvas2D source canvas.
4. Rebuild and blur the SDF-derived surface field only when its size or controls change.
5. Upload the source canvas and any changed surface field to WebGL textures.

The GPU then renders a full-screen triangle into a ball-sized transparent canvas. Its fragment shader performs:

1. Marble-circle clipping and antialiased alpha.
2. Manual bilinear sampling of the cached float surface field.
3. Surface-height reconstruction from the selected profile.
4. IOR refraction and source-texture sampling.
5. Red/green/blue dispersion and source-circle edge gating.
6. Inner shade, milk, top wash, rim, hard rim, and CA rim.
7. Moving rectangular/circular spec highlights.
8. Spec debug color.

The main Canvas2D canvas only draws the stage background, shadow, GPU ball canvas, and outer stroke. No GPU pixels are read back to JavaScript.

## Data Passed To The GPU

The source content is uploaded as an RGBA8 texture every frame because the photo circles move continuously. The source canvas is uploaded directly; `getImageData` is not called by the WebGL2 path.

The surface field is packed into an RGBA32F texture. It is uploaded only when the cached surface signature changes. The shader uses `texelFetch` and performs its own bilinear interpolation, so float-linear texture extensions are not required.

Visible circle geometry is passed as ten `vec4` uniforms:

```text
(centerX, centerY, radius, alpha)
```

Prepared spec geometry is passed as fixed-size uniform arrays containing source direction, tangent axes, shape dimensions, softness, power, intensity, and visibility.

## Visual Parity

The CPU and GPU backends share all scene projection and spec-preparation code. The GLSL implementation follows the Canvas sampler's operation order and uses a custom `smoothRange` helper because the project intentionally uses reversed smoothstep ranges in several masks.

The default and `?renderer=canvas` pages were captured from the same initial state in Chrome. Circle positions, refraction folds, chromatic fringes, shell shading, and spec placement matched visually. Dragging the WebGL2 page also preserved the existing front/back transition and edge behavior.

## Main-Thread Measurement

With `?perf=1`, the page records a rolling 15-frame average of the synchronous `renderer.render()` call in `canvas[data-render-ms]`. This measures the JavaScript time that can block pointer handling; it does not include all asynchronous GPU execution time. Timing is disabled during normal use.

Measured in the existing Chrome window at a 1265 x 860 CSS viewport with DPR 2:

```text
Canvas2D fallback: 541.40 ms per render call
WebGL2:               1.53 ms per render call
```

The important result is the removal of the main-thread pixel loop and canvas readback. Device-level GPU frame time should still be checked on the target iPad, but the previous input-blocking bottleneck is no longer present.

## Remaining CPU Work

Two tasks intentionally remain on the CPU in this first pass:

- Photo circles are painted into a Canvas2D source texture before upload.
- The SDF surface field and its Gaussian blur are rebuilt on the CPU when relevant GUI controls change.

Neither task reads GPU pixels back. The source pass can later become instanced textured quads, and the surface field can become a two-pass GPU render target if profiling on the target iPad shows either task is still material.
