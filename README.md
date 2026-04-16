# project-mapper

ProjectMap — a small, zero-dependency Node CLI that builds a compact, queryable synopsis
of a codebase. This repository contains a TypeScript port of the original `project-map.mjs`
script and a build pipeline that bundles the TypeScript sources into a single
executable ESM file at `.ai/scale/project-map.mjs`.

This README describes how to build, test, and run the bundled CLI on Windows (PowerShell)
and Unix-like systems.

Prerequisites

- Node.js 18+ (the bundle target is Node 18)
- npm (or yarn/pnpm)

Quickstart — build and run

1. Install dev dependencies (once):

```powershell
npm install
```

2. Build TypeScript and produce a single bundled CLI (`.ai/scale/project-map.mjs`):

```powershell
# full flow: typecheck -> tsc -> esbuild bundle
npm run dist
```

If you only want the single-file bundle (esbuild) without running `tsc`, run:

```powershell
npm run bundle
```

3. Run the bundled CLI (example shows the help text):

```powershell
node .ai/scale/project-map.mjs help
```

Development scripts

- `npm run typecheck` — run `tsc --noEmit` to type-check the project
- `npm run build` — run `tsc` to emit compiled JS to `dist/`
- `npm run bundle` — produce `.ai/scale/project-map.mjs` using esbuild (via `scripts/bundle.cjs`)
- `npm run dist` — run `build` then `bundle`
- `npm test` — run unit tests (Vitest)

Where the bundle goes

- The bundle output is `.ai/scale/project-map.mjs` (and a source map `.ai/scale/project-map.mjs.map`).
- The bundle includes a shebang so on Unix-like systems you can run it directly after
  setting the executable bit: `chmod +x .ai/scale/project-map.mjs`.

Notes about the build

- We use esbuild (devDependency) for fast bundling. Because of Windows shell quoting
  differences, the npm `bundle` script runs a small Node wrapper at `scripts/bundle.cjs`
  that calls esbuild's JS API and sets the shebang banner reliably across platforms.
- The TypeScript configuration lives in `tsconfig.json` and emits to `dist/` when you
  run `npm run build`. The single-file bundle is produced from the TypeScript sources
  (esbuild handles TS input directly).

Testing

- Unit tests are powered by Vitest. Run the test suite with:

```powershell
npm test
```

Troubleshooting

- If `npm run bundle` fails with a quoting/CLI error on Windows, ensure `esbuild` is
  installed and run `node scripts/bundle.cjs` directly.
- If TypeScript reports errors, run `npm run typecheck` to see the failures and fix
  the TypeScript source accordingly.

Contributing

- Follow the existing coding style in `src/`.
- Add unit tests under `tests/` for any new behavior.
- Run `npm run typecheck` and `npm test` before opening a PR.

License

- This repository is private in package.json; add a license file or update package.json
  if you plan to publish.

If you'd like, I can add a short contributor-focused checklist, CI steps (GitHub Actions),
or prepare a smaller developer helper script that runs `typecheck`, `test`, and `dist` in one step.
