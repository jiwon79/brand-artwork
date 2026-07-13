# Guseul implicit elastic lab

## Goal

`pages/guseul-elastic-lab/` tests a smooth multi-touch silicone deformation
without a visible or simulated triangle mesh. WebGL2 evaluates the shape as an
implicit signed distance field for every pixel, so the silhouette does not have
polygon corners or constraint bands.

## Unified touch model

Every contact count uses the same center-anchored least-squares affine and RBF
field. There are no separate translation, exact ellipse, or three-point modes.
The affine translation is always zero, and the RBF displacement is smoothly
gated to zero around the origin. Together these act as a permanent virtual
contact at the center of the ball.

The affine captures stable global scale, rotation, and shear. The remaining
error at every pointer becomes a compact Wendland RBF displacement. The shader
iteratively inverse-maps each screen pixel through both fields before sampling
the rest circle.

The RBF has continuous derivatives at the end of its support, preventing the
visible kinks created by independently constrained boundary vertices.

RBF residuals are globally saturated before rendering so their displacement
cannot exceed a safe fraction of the support radius. This keeps the inverse
map contractive and prevents folds or split-looking interiors during extreme
pulls.

## Contact-count continuity

New contacts start with zero solver influence and ramp to full influence over a
short interval. Their anchor is sampled through the current inverse field, so
the existing shape remains unchanged on the insertion frame.

Released contacts return to their anchors but remain in the same solver set.
They are cleared as one batch only after every active contact is released and
every spring has settled. This avoids count-driven `3 -> 2 -> 1 -> 0` formula
changes during release.

## Rendering

- A full-screen WebGL2 triangle runs the implicit field fragment shader.
- The rest shape is `length(restPosition) - 1`.
- `fwidth` supplies resolution-independent edge antialiasing.
- Screen derivatives of the signed distance provide a continuous edge normal.
- The same field draws the body, rim, shadow, and optional normal debug view.

## Interaction and testing

- Pointer Events support up to ten simultaneous contacts.
- Releasing one contact springs only that control point back to rest.
- Shift-drag leaves a desktop contact fixed for multi-contact testing.
- `2-point anchored` and `3-point RBF` provide automated comparison modes.
- `2 + add third` specifically verifies contact-count continuity.
- `regression: release all` reproduces a three-contact simultaneous release.
- `regression: re-entry` adds a new contact while an earlier one is returning.
- Query demos use `?demo=2`, `?demo=3`, `?demo=transition`,
  `?demo=release-all`, and `?demo=single-reentry`.

## Glass integration

The field normal can replace the circular normal used by the production glass
renderer. Refraction, chromatic dispersion, rim, and specular layers can sample
the same inverse-deformed rest coordinates, keeping the effects attached to the
smooth stretched edge.
