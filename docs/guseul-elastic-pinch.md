# Guseul Elastic Pinch

## Interaction Contract

One pointer keeps the existing sphere rotation. Two pointers that both begin on the currently deformed marble switch the interaction into elastic pinch mode.

During a pinch:

- Rotation, inertia, and idle motion stop.
- The line between the pointers becomes the deformation axis.
- Increasing pointer distance stretches the marble along that axis.
- Decreasing pointer distance compresses the marble along that axis.
- A third pointer is ignored.

If one pointer lifts first, the current shape is held and the remaining pointer does not suddenly become a rotation gesture. The spring starts only after all tracked pointers have lifted. Idle motion resumes after the spring has settled and the normal idle delay has elapsed.

## Deformation Model

Pointer distance is converted to logarithmic deformation so equal relative pinch changes feel symmetric:

```text
deformation = initialDeformation
  + log(currentDistance / initialDistance) * pinchSensitivity

axisScale = exp(deformation)
perpendicularScale = 1 / sqrt(axisScale)
```

The perpendicular scale approximates volume preservation for a three-dimensional elastic sphere. A 1.35 axis stretch produces a perpendicular scale of about 0.86 instead of flattening the marble by the full inverse amount.

The main Canvas2D composite applies one centered transform to the shadow, WebGL2 ball output, and outer stroke. This defines the elastic silhouette; the shader counter-transforms source sampling separately as described below.

Pointer hit testing uses the inverse of the same axis/perpendicular transform, so the interactive region follows the visible ellipse rather than the original circular bounds.

## Fixed Source Sampling

The composite transform still deforms the glass boundary, rim, spec, shadow, and outer stroke. The source photos no longer inherit that transform by default.

For each canonical glass point `q`, the final composite places the pixel at `D * q`, where `D` is the directional deformation matrix. The shader now samples source content in that same final coordinate space:

```text
fixed source:    sourcePoint = D * (q + refractionOffset)
following source: sourcePoint = q + refractionOffset
```

Because the later composite maps `q` to `D * q`, the fixed-source equation cancels the visual stretching of the photos. The deformed glass surface still controls clipping, normal direction, refraction, chromatic separation, and shell lighting.

`source follow` interpolates between the two coordinate systems. Its default is `0.3`, so source photos respond slightly without looking printed onto the elastic glass. A value of `0` keeps the source completely fixed, while `1` reproduces the previous whole-image stretch.

## Spring Model

The pinch keeps a smoothed logarithmic deformation velocity. When the final pointer lifts, that velocity becomes the spring's initial velocity.

The return motion is an under-damped harmonic oscillator:

```text
omega = 2 * PI * springFrequency
acceleration = -omega^2 * deformation
  - 2 * springDamping * omega * velocity
```

The integrator uses semi-implicit Euler steps no larger than 8 ms. Substeps keep the spring stable when a frame is delayed or the GUI frequency is increased. Motion stops when both deformation and velocity are visually negligible.

At the defaults (`3 Hz`, damping ratio `0.28`), a maximum stretch crosses the resting shape several times, has roughly two to three visible oscillations, and settles in about one second at 60 Hz.

## GUI Controls

`1 scene > elastic pinch` exposes:

- `sensitivity`: response to relative pointer-distance change.
- `min compression`: smallest allowed axis scale.
- `max stretch`: largest allowed axis scale.
- `source follow`: `0` keeps source photos fixed; `1` stretches them with the glass.
- `spring frequency`: return speed and oscillation frequency.
- `spring damping`: energy loss; lower values oscillate longer.

Defaults:

```text
sensitivity       0.85
min compression   0.72
max stretch       1.35
source follow      0.3
spring frequency  3.0 Hz
spring damping    0.28
```

For desktop visual verification without synthetic multitouch, these development-only query parameters set the initial composite transform:

```text
?deformPreview=1.3&deformAngle=0.6
?deformPreview=1.35&springPreview=1
?deformPreview=1.35&sourceFollow=1
```

`springPreview=1` releases the initial deformation into the normal spring integrator. `sourceFollow=1` restores the old whole-composite stretch for comparison. These parameters do not affect the default page.
