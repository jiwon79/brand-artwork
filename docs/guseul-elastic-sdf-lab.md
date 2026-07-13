# Guseul implicit elastic lab

## Goal

`pages/guseul-elastic-lab/` tests a smooth multi-touch silicone deformation
without a visible or simulated triangle mesh. WebGL2 evaluates the shape as an
implicit signed distance field for every pixel, so the silhouette does not have
polygon corners or constraint bands.

## Local capsule touch model

Every contact creates one compact deformation basis aligned from its rest
anchor toward the outside of the ball. The basis rises smoothly from zero at
the fixed center, stays broad around the grabbed material, and fades beyond the
outer surface. A finite `grip radius` plateau moves a small contact area instead
of pulling a single point into a cusp.

There is no global affine scale or shear. Moving one finger therefore changes
only its capsule neighborhood instead of turning the entire ball into an
ellipse or triangle. Multiple contacts use the same formula regardless of
contact count.

The capsule coefficients come from a small regularized weighted least-squares
solve each frame. Rows and columns are multiplied by each contact's transition
influence. An inserted contact starts as a zero column and zero-weight row, so
the previous solution remains valid on the insertion frame. As its influence
rises, the new material constraint enters continuously. This also keeps grabbed
material close to the active handles without sacrificing stability when two
capsules overlap. Two post-solve corrections evaluate the composed flow at each
anchor and feed the remaining error back into its coefficient; the debug GUI
reports the resulting maximum contact error.

## Continuous deformation flow

A single large mapping `p + displacement(p)` can fold when a finger moves far
enough. Instead, the renderer treats the local field as a velocity and composes
sixteen small steps. The shader walks screen pixels backward through that flow;
CPU hit testing and anchor placement use the same sixteen-step field. The
composition stays smooth under stronger pulls and does not create the multiple
inverse branches seen with a one-step warp.

## Local volume response

Each capsule derives its axial strain from the solved coefficient and applies a
Poisson-style contraction only inside the same local support. The contraction
is zero at the grip center, so it rounds the stretched arm without moving the
held material point.

A weaker outer-surface tension models area conservation. It begins outside the
fixed core and pulls untouched outer arcs inward in proportion to average
radial strain. This removes extra convex lobes between contacts while leaving
the center stationary. The old angle-sorted pairwise valley field is no longer
used.

## Contact-count continuity

New contacts start with zero least-squares influence and ramp to full influence
over a short interval. Their anchor is sampled through the current inverse flow,
so the existing shape remains unchanged on the insertion frame.

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
- `2-point anchored` and `3-point local pull` provide automated comparison modes.
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
