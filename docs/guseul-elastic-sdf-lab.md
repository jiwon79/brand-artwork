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

The fixed-center gate uses a rational radial function instead of a narrow
smoothstep band. Its bounded slope, a lower local-warp limit, and four inverse
iterations prevent extra critical points from appearing between the center and
pointer contacts in the normal field.

## Tension necking

The affine and RBF fields place the contacts, but by themselves they keep the
material inflated between those contacts. A separate tension field models the
lateral contraction of stretched silicone.

For each outward-moving contact, the renderer measures the radial stretch from
its fixed rest anchor to its current handle. It applies a Poisson-style
contraction perpendicular to that bond. The contraction is strongest between
the fixed center and the contact, fades smoothly outside that interval, and is
reduced near the grip so the contact remains a rounded lobe instead of becoming
a sharp point. `poisson exponent`, `strength`, `width`, `grip width`, and
`minimum width` expose these terms in the `2 tension neck` GUI folder.

With three or more stretched contacts, their rest-space polar angles are sorted
and each neighboring pair creates one valley at its angular midpoint. The
valley moves only the outer part of the field inward; its magnitude comes from
the weaker strain of the two contacts. This makes the spans between grip lobes
concave without moving the permanent center anchor. `valley strength` controls
the indentation and `valley width` controls how much of the arc participates.
Two-contact pulls omit this pairwise field because their opposing axial necks
already form one continuous waist.

CPU hit testing and the WebGL2 fragment shader evaluate the same residual,
neck, and valley functions. Weight normalization uses a differentiable smooth
maximum, and valley displacement uses a `tanh` saturation instead of a hard
clamp. These avoid threshold contours that would otherwise appear as corners
or bands in the field-normal debug view.

## Contact-count continuity

New contacts start with zero solver influence and ramp to full influence over a
short interval. Their anchor is sampled through the current inverse field, so
the existing shape remains unchanged on the insertion frame.

Released contacts return to their anchors at full influence for 160 ms. Their
influence then fades to zero and the contact is removed at 320 ms. Because every
contact count uses the same solver, these timed removals do not reintroduce
count-driven formula changes.

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
