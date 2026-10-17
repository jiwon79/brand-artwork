# Example artwork

Bundled examples from [PokéAPI/sprites](https://github.com/PokeAPI/sprites),
`sprites/pokemon/other/official-artwork/{197,94,25}.png` (retrieved 2026-10-17).

- `umbreon.png`: Umbreon / 블래키, #197
- `gengar.png`: Gengar / 팬텀, #094
- `pikachu.png`: Pikachu / 피카츄, #025

Pokémon characters and artwork © Nintendo / Creatures Inc. / GAME FREAK inc.
These are demonstration inputs, not original Studio artwork. No affiliation implied.

Visual reference for the stippling interaction: https://www.instagram.com/f_ge107/
The implementation uses its own procedural dot renderer and reveal mask.

## Procedural ink screen

`ink-screen.png` is original generated data. Run
`node --experimental-strip-types scripts/generate-stipple-screen.mjs` to rebuild.
Periodic Poisson-disk points maintain a minimum spacing. The nearest-point
distance field is ranked uniformly into 16-bit RG thresholds, so input tone
controls covered ink area rather than independently discarding random dots.
The texture contains data and must be sampled without sRGB conversion.
