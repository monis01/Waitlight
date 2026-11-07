// Bundles src/ into one file: dist/extension.js
// Usage: node esbuild.js            (build once)
//        node esbuild.js --watch    (rebuild on every save)
//        node esbuild.js --production (minified, for packaging)
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

// Prints start/finish lines that VS Code's watch task listens for,
// so F5 waits until the first build is done.
const logPlugin = {
  name: 'log',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const e of result.errors) {
        const where = e.location ? ` ${e.location.file}:${e.location.line}` : '';
        console.error(`✘ [ERROR] ${e.text}${where}`);
      }
      console.log('[watch] build finished');
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outfile: 'dist/extension.js',
    external: ['vscode'], // provided by the editor at runtime
    sourcemap: !production,
    minify: production,
    logLevel: 'silent',
    plugins: [logPlugin],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
