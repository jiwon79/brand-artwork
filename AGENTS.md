# Brand Artwork

Interactive web implementations of brand artworks.

## Tech Stack

- TypeScript + Vite
- lil-gui (debug/parameter tuning UI)
- pnpm (package manager)

## Project Structure

- `common/` — shared modules (touch cursor, etc.)
- `pages/<brand>/` — per-brand artwork (`index.html`, `script.ts(js)`, `style.css`, etc.)

## Workflow

- 작업을 완료하면 항상 커밋하고 푸시한다. (별도 확인 없이 바로 진행)
- 렌더링 확인은 Playwright로 새 브라우저 창을 띄우지 말고, 기존 Chrome 창을 활용한다.
