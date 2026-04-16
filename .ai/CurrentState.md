# CurrentState

## Repository purpose

`project-mapper` is a private TypeScript/Node repository for **ProjectMap
**, a CLI that builds a compact, queryable synopsis of a codebase.

This repo appears to serve two closely related goals:

1. maintain a TypeScript implementation of the ProjectMap workflow
2. bundle that implementation into a single executable ESM script at `.ai/scale/project-map.mjs`

The README explicitly describes this as a TypeScript port of the original `project-map.mjs` workflow.

## Practical structure

The repository is small and focused.

Observed top-level areas include:

- `src/`
- `tests/`
- `scripts/`
- `dist/`
- `coverage/`
- `.ai/`

From indexed project stats:

- most source lives under `src`
- most tests live under `tests`
- notable source areas include:
  - `src/projectMap`
  - `src/projectMap/query`
  - `src/text`

Inspected files confirm that `src/projectMap` contains the CLI-facing command and state-loading flow.

## Main entry points

### CLI entry point

Primary CLI entry point:

- `src/projectMap/cli.ts`

Supported commands:

- `build`
- `stats`
- `find "<query>"`
- `inspect "<path-or-id>"`
- `pack "<task-or-question>"`
- `help`

The CLI layer is thin. It parses arguments and delegates to command functions.

### Command/orchestration layer

Main command handler file:

- `src/projectMap/commands.ts`

Current responsibilities evidenced there:

- `runStats`: loads persisted state and prints repo summary
- `runFind`: runs a query and prints ranked files/chunks
- `runInspect`: inspects a file or chunk from persisted state
- `runPack`: prints an investigation packet for browser-based workflows

`runFind` and `runPack` delegate query execution to `src/projectMap/query/core`.
`runInspect` and `runStats` depend on persisted state loaded via `src/projectMap/state.ts`.

### Persisted state layer

Main state loader:

- `src/projectMap/state.ts`

Current persisted inputs loaded from `.ai/scale/state`:

- `build.json`
- `repo.json`
- `files.jsonl`
- `chunks.jsonl`
- `dirs.jsonl` (optional/fallback to empty array)

The loader materializes lookup maps by:

- file id
- file path
- chunk id
- chunk file ownership
- directory id
- directory path

This indicates that ProjectMap is designed around a **build first, query later** model.

## Build, test, and runtime flow

Package scripts currently in use:

- `npm run typecheck` -> `tsc --noEmit`
- `npm run build` -> `tsc`
- `npm run bundle` -> `node scripts/bundle.cjs`
- `npm run dist` -> build then bundle
- `npm test` -> `vitest`
- `npm run coverage` -> `vitest --coverage`
- `npm run test:watch` -> `vitest --watch`
- `npm run start` -> `node dist/cli.js`

Intended developer flow from README:

1. `npm install`
2. `npm run dist`
3. `node .ai/scale/project-map.mjs help`

Important build detail:

- bundling is done through `scripts/bundle.cjs`
- the README says this wrapper exists to avoid Windows shell quoting problems and to apply the shebang reliably across platforms

Target/runtime notes:

- Node 18+ is the documented prerequisite
- the bundled executable target is `.ai/scale/project-map.mjs`

## Architectural boundaries

### 1. Thin CLI front door

`src/projectMap/cli.ts` should remain small and command-oriented.

It is responsible for:

- argument parsing
- help text
- dispatch to command functions
- top-level process error handling

### 2. Command formatting/orchestration

`src/projectMap/commands.ts` is the main boundary between internal logic and user-facing console output.

It currently handles:

- shaping terminal output
- selecting the right internal operation
- persisting query artifacts after query-style commands

### 3. Query/state internals

The command layer depends on internal query/state modules rather than embedding core logic directly.

This is a good boundary to preserve:

- CLI and printing stay separate
- state loading stays centralized
- query behavior stays behind query-core interfaces

### 4. Shared behavior-locking constants

`src/constants.ts` explicitly duplicates constants from the original
`project-map.mjs` so the TypeScript implementation stays behaviorally aligned without modifying the original script.

That file defines important behavior inputs such as:

- ignored directory names
- ignored relative directories
- binary file extensions
- generated-file patterns
- file classification hints

This is an important repo constraint: **compatibility with the original script matters**.

## Important conventions and constraints

### Ignore rules matter

The project intentionally excludes common noise and generated areas from indexing, including:

- `.ai/out`
- `.ai/scale`
- `.ai/scale/state`
- `node_modules`
- `dist`
- `coverage`

This is part of the indexing contract, not incidental cleanup.

### Tests are part of normal change workflow

The README’s current contributor guidance implies:

- source changes should generally be covered by unit tests under `tests/`
- `npm run typecheck` and `npm test` should pass before merging or opening a PR

### Cross-platform bundling is a first-class concern

The build pipeline explicitly accounts for Windows shell quoting differences.
Do not casually replace the bundle wrapper without checking cross-platform behavior.

## Known risks / open questions

### Pack artifact persistence issue

Observed during repo briefing:

- `pack` produced useful console output
- then failed while trying to write its persisted query artifact under `.ai/scale/state/queries/...json`

The implementation confirms that `runPack` persists a query artifact after printing.
Current evidence is not enough to prove the exact root cause, but this looks like a real issue in artifact persistence on Windows for some task strings.

Treat this as an open bug until reproduced and narrowed properly.

### Deeper query/ranking internals not yet briefed

We have not yet inspected enough of the following to summarize them confidently:

- `src/projectMap/query/*`
- build collection internals
- chunking/boundary detection internals
- ranking/scoring strategy
- how query artifacts are named and persisted

That is the main current gap in this briefing.

## Good re-entry points for future work

When re-entering this repo after a gap, start here:

1. `README.md`

- quickest reminder of purpose, scripts, and bundle target

2. `src/projectMap/cli.ts`

- best top-down view of supported commands and invocation contract

3. `src/projectMap/commands.ts`

- best view of how the CLI actually behaves for end users

4. `src/projectMap/state.ts`

- best place to understand the persisted-state model

5. `src/constants.ts`

- best place to understand indexing exclusions and classification rules

If the next task is feature or bug work, inspect the relevant internal module after first confirming which command path owns the behavior.
