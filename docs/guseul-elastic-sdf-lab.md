# Guseul implicit elastic lab

## Goal

`pages/guseul-elastic-lab/` tests a smooth multi-touch silicone deformation
without a visible or simulated triangle mesh. WebGL2 evaluates the shape as an
implicit signed distance field for every pixel, so the silhouette does not have
polygon corners or constraint bands.

## Touch models

### One contact

One pointer translates the circle. On release, its control point returns to its
rest position with a damped spring.

### Two contacts

The line between the two rest contacts becomes the ellipse's major axis. The
current contact distance controls major-axis scale, while the perpendicular
axis uses `majorScale ^ -areaPreservation`. Rotation and midpoint translation
come directly from the two contact pairs. This maps both fingers exactly and
recreates the earlier directional ellipse behavior.

### Three or more contacts

A regularized least-squares affine transform captures the global translation,
rotation, scale, and shear. The remaining error at every contact becomes a
compact Wendland RBF displacement. The shader iteratively inverse-maps each
screen pixel through the affine and RBF fields before sampling the rest circle.

The RBF has continuous derivatives at the end of its support, preventing the
visible kinks created by independently constrained boundary vertices.

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
- `2-point ellipse` and `3-point RBF` provide automated comparison modes.
- `?demo=2` and `?demo=3` start those modes on page load.

## Glass integration

The field normal can replace the circular normal used by the production glass
renderer. Refraction, chromatic dispersion, rim, and specular layers can sample
the same inverse-deformed rest coordinates, keeping the effects attached to the
smooth stretched edge.
