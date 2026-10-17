# Clouds renderer source snapshot

These ES modules were retrieved from the publicly served [Clouds in Motion](https://clouds-in-motion.pages.dev/) module graph on 2026-10-17. They are the reference implementation, not independently authored Studio code. `upstream.json` records the source URL and original SHA-256 for each module, including the embedded WebAssembly reduction module. The site does not publish an explicit reuse license in the pages inspected; this record does not grant or assert one.

The Gaussian authoring, extinction, scattering, shadow field, sample sequence, and post-processing kernels are preserved. Integration lives in the parent directory. The local integration changes are:

- Import and use `MotionRefinement` to restrict automatic LOD to motion. Restore the reference 1x LOD directly after 180 ms of inactivity, instead of repeatedly completing 128 samples at intermediate LODs.
- Dispatch `samplecomplete` only after its GPU fence signals, so the loading overlay can reveal the first completed frame.
- Capture completed HDR accumulation through asynchronous pixel-pack readback and restore matching lossless cache entries before lens processing. Keep both average and residual planes in 16-bit mode. Cached stills can be ready without rebuilding shadows; changed inputs resume the original renderer. Geometry installation and explicit camera reset start at final LOD without a motion debounce.
- Default and UI choices are supplied by `script.ts`: full device resolution, 128 samples, four samples per static submission, one during motion. Shadow resolution and reuse remain unchanged.

`renderer.d.ts` describes the integration API. All unmodified modules keep their original hashes. The reference UI/main module and its analytics are not included.
