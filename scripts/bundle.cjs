// Node script to run esbuild programmatically to avoid shell quoting issues on Windows
const esbuild = require('esbuild');

(async () => {
  try {
    await esbuild.build({
      entryPoints: ['src/projectMap/cli.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node18',
      outfile: '.ai/scale/project-map.mjs',
      banner: { js: '#!/usr/bin/env node' },
      sourcemap: true,
      logLevel: 'info',
    });
    console.log('Bundled .ai/scale/project-map.mjs');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();

