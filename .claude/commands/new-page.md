---
description: Create a feature branch and scaffold a new pages/<slug>/ artwork (modeled on pages/akmu-king-kong/).
argument-hint: <brand name, any form>
---

Scaffold a new brand artwork page. Raw input: `$ARGUMENTS`

## 0. Normalize input

The user types loosely — accept anything and derive two values:

- **slug** — folder name under `pages/`. Must be kebab-case ASCII: lowercase, spaces/underscores → `-`, strip punctuation (apostrophes, commas), collapse repeated `-`. Non-ASCII (Korean, etc.) → romanize or ask the user.
- **display name** — title shown in `<title>` and the root index link. Preserve the user's casing and intent; don't auto-Title-Case acronyms. If the input is all-lowercase and looks like a normal brand word, Title-Case it.

Examples (derive both from one input):

| Input | slug | display |
|-------|------|---------|
| `Supreme` | `supreme` | `Supreme` |
| `supreme` | `supreme` | `Supreme` |
| `AKMU King Kong` | `akmu-king-kong` | `AKMU King Kong` |
| `McDonald's` | `mcdonalds` | `McDonald's` |
| `pixar rapunzel` | `pixar-rapunzel` | `Pixar Rapunzel` |
| `ghibli-totoro` | `ghibli-totoro` | `Ghibli Totoro` |

**Always show the normalized slug + display name and ask "이렇게 진행할까요?" before running any git command.** If the user corrects either, use their version verbatim.

If input is ambiguous (e.g. non-ASCII only, or empty), ask before normalizing.

## 1. Pre-flight (run in parallel)

- `git status` — working tree must be clean. If dirty, **stop** and report.
- `git branch --show-current` — should be `main`. If not, ask whether to branch from HEAD or switch to `main` first.
- Verify `pages/<slug>/` does not exist. If it does, **stop** and ask.

## 2. Sync and branch

```bash
git checkout main
git pull
git checkout -b feat/<slug>
```

## 3. Scaffold `pages/<slug>/`

Model on `pages/akmu-king-kong/` — HTML shell, CSS reset, and `/common/touch-cursor.ts` loading. Keep it minimal, no domain-specific modules.

**`index.html`**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>{{DISPLAY_NAME}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="script.ts"></script>
  <script type="module" src="/common/touch-cursor.ts"></script>
</body>
</html>
```

**`script.ts`** — empty file.

**`style.css`** — reset + full-viewport body (AKMU pattern):

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

body {
  background: #111;
  color: #e0e0e0;
  height: 100vh;
  height: 100dvh;
}

#app {
  width: 100%;
  height: 100%;
  position: relative;
}
```

**`spec.md`** — heading-only template:

```markdown
# {{DISPLAY_NAME}} Brand Artwork — 스펙

## 1. 파일 구성

## 2. 컨셉

## 3. 장면
```

Skip `assets/` (git doesn't track empty dirs; create it when the first asset is added).

## 4. Register in root `index.html`

Append as the last `<a>` inside `<body>`, matching the existing pattern:

```html
  <a href="/pages/{{SLUG}}/">{{DISPLAY_NAME}}</a>
```

## 5. Report

- Branch: `feat/{{SLUG}}`
- Scaffolded files (list them)
- Root `index.html` link added

**Do not commit or push.** Let the user review first.

## Constraints

- Never run `git commit`, `git push`, or any `--force` flag.
- `vite.config.ts` auto-discovers `pages/<dir>/index.html` — no config edit needed.
