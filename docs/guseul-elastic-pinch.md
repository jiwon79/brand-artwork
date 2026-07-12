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

The main Canvas2D composite applies one centered transform to the shadow, WebGL2 ball output, and outer stroke. Refraction, chromatic separation, content, and spec therefore deform together without another shader pass.

Pointer hit testing uses the inverse of the same axis/perpendicular transform, so the interactive region follows the visible ellipse rather than the original circular bounds.

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
- `spring frequency`: return speed and oscillation frequency.
- `spring damping`: energy loss; lower values oscillate longer.

Defaults:

```text
sensitivity       0.85
min compression   0.72
max stretch       1.35
spring frequency  3.0 Hz
spring damping    0.28
```

For desktop visual verification without synthetic multitouch, these development-only query parameters set the initial composite transform:

```text
?deformPreview=1.3&deformAngle=0.6
?deformPreview=1.35&springPreview=1
```

`springPreview=1` releases the initial deformation into the normal spring integrator. These parameters do not affect the default page.
