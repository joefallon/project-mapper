Plan: Scaffold TypeScript + Vitest for ProjectMap

TL;DR — Add a small, typed project layout (`src/`, `tests/`) and strict TypeScript config (ESNext + nodenext) so you can extract and unit-test pure helpers from `project-map.mjs` with Vitest. Migrate incrementally: extract utils first, add types and tests, then split larger modules, keeping the CLI ESM-compatible.

Steps
1. Create project layout and core files: `src/`, `tests/`, `dist/`, `package.json`, `tsconfig.json`.
2. Configure TypeScript: create `tsconfig.json` with `module: "ESNext"`, `moduleResolution: "nodenext"`, `target: "ES2020"`, `strict` enabled.
3. Adopt Vitest: add `vitest` devDependency and create `vitest.config.ts` for Node ESM testing.
4. Extract pure helpers from `project-map.mjs` into `src/utils.ts` and export their symbols.
5. Preserve CLI/ESM compatibility: keep `"type":"module"` in `package.json` and a small ESM entry in `package.json`/`bin` that delegates to compiled ESM.
6. Create initial scaffold files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `README.md`, `src/utils.ts`, `tests/utils.test.ts`.

Further Considerations
1. TypeScript choices & rationale: use `module: "ESNext"` + `moduleResolution: "nodenext"` for native ESM imports, `target: "ES2020"` for wide Node support, `allowJs: true` to migrate `.mjs` gradually, `strict: true` for safer refactors.
2. Initial test targets (pure, deterministic helpers): `normalizeWhitespace`, `splitCamelCase`, `normalizeTerm`, `isUsefulTerm`, `tokenizeText`, `countTerms`, `topTermsFromCounts`, `safeSlug`, `truncate`, `bucketForTerm`, `buildPreviewFromLines`, `extractQuotedStrings`. These avoid fs and side effects.
3. Incremental migration (recommended sequence): extract helpers → add types & tests → convert tests to TypeScript → group related helpers into `src/parse.ts`, `src/index.ts`, `src/build.ts` → replace internals of `project-map.mjs` with imports → compile to `dist/` and update `bin` to point to compiled entry.

Checklist-ready actionable items you can execute next
1. Create the folders and files named in Step 6.
2. Populate `tsconfig.json` per Step 2.
3. Install devDeps (`vitest`, `typescript`) and set up `vitest.config.ts`.
4. Copy pure helper implementations from `project-map.mjs` into `src/utils.ts` and export them.
5. Write unit tests for the functions listed in Further Considerations #2 under `tests/utils.test.ts`.
6. Run Vitest and iterate until tests pass, then continue module extractions and CLI wiring.

Pause here — review the plan or tell me which part you want expanded into exact file contents and example test cases next.
