# Guseul elastic mesh lab

## Goal

`pages/guseul-elastic-lab/` isolates the multi-touch material response from the
production glass renderer. It tests whether a circular sheet can be pulled by
an arbitrary number of fingers and return like elastic silicone.

## Model

- The rest circle is a 12-ring triangular disk: 469 vertices and a 72-vertex
  boundary.
- Each pointer creates an independent pin. The pin captures nearby vertices
  with a radial falloff, so it holds a patch instead of a single sharp point.
- Structural edge constraints resist stretching and shearing.
- Per-triangle area constraints keep the sheet from collapsing into thin
  strings while it is pulled.
- A rest-position spring and Verlet velocity damping create the release and
  settling motion.
- Releasing one finger removes only that pin. Other fingers continue to hold
  their own patches.

The fixed 120 Hz simulation is independent of display refresh rate. Constraint
passes run several times per step to keep the response stable during large
pulls.

## Controls and testing

- Touch directly supports multiple simultaneous Pointer Events.
- A mouse drag tests one contact.
- Shift-drag leaves a persistent desktop pin so another contact can be tested.
- `3-point demo` drives three independent pins without a touch device.
- `mesh` reveals the actual triangulation used by the solver.
- `?demo=1` starts the automated three-point test on load.

## Production path

This lab renders only a lightweight silicone material. If the feel is accepted,
the same deformed mesh can carry the Guseul rest coordinates into WebGL2. The
glass surface normal is then derived from the rest-space surface field and the
local mesh deformation gradient, keeping refraction, chromatic dispersion, rim,
and specular highlights attached to the deformed edge.
