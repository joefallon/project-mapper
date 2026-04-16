# project-mapper

ProjectMap is a small Node CLI that builds a compact, queryable synopsis of a codebase.
This repo contains the TypeScript source and a build pipeline that bundles the CLI into
`.ai/scale/project-map.mjs`.

## Prerequisites

- Node.js 18+
- npm

## Install

```powershell
npm install
```

## Build

Build TypeScript and produce the bundled CLI:

```powershell
npm run dist
```

If you only want the bundled file:

```powershell
npm run bundle
```

## Using `project-map.mjs`

After building, run the bundled CLI from the repo root:

```powershell
node .ai/scale/project-map.mjs help
```

Common commands:

```powershell
node .ai/scale/project-map.mjs build
node .ai/scale/project-map.mjs stats
node .ai/scale/project-map.mjs find "sales order rate retrieval"
node .ai/scale/project-map.mjs find "sales order rate retrieval" --json
node .ai/scale/project-map.mjs inspect "application/controllers/QbeSalesOrderViewController.php"
node .ai/scale/project-map.mjs inspect "c0000001" --json
node .ai/scale/project-map.mjs pack "Where does sales order rate retrieval happen?"
node .ai/scale/project-map.mjs pack "Where does sales order rate retrieval happen?" --json
```

Behavior notes:

- `build` rebuilds `.ai/scale/state` from scratch.
- `find` ranks matching files and chunks for a query.
- `inspect` prints structured details for one file or chunk.
- `pack` prints a compact investigation packet for browser-based work.
- `--json` returns structured output for `find`, `inspect`, and `pack`.

On Unix-like systems you can run the bundle directly after making it executable:

```bash
chmod +x .ai/scale/project-map.mjs
./.ai/scale/project-map.mjs help
```

## Development scripts

- `npm run typecheck` - run `tsc --noEmit`
- `npm run build` - emit compiled JS to `dist/`
- `npm run bundle` - produce `.ai/scale/project-map.mjs`
- `npm run dist` - run `build` then `bundle`
- `npm test` - run the unit test suite

## Testing

```powershell
npm test
```

## Troubleshooting

- If `npm run bundle` fails on Windows, run `node scripts/bundle.cjs` directly.
- If TypeScript reports errors, run `npm run typecheck`.

## Contributing

- Follow the existing coding style in `src/`.
- Add unit tests under `tests/` for new behavior.
- Run `npm run typecheck` and `npm test` before opening a PR.

## License

This repository is private in `package.json`; add a license file or update `package.json`
if you plan to publish.
