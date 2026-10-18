// The converter's worker, bundled into the page's own script as text, so the page can start it
// from a blob: URL. A worker loaded from its own file would take its Content Security Policy from
// that file's response headers, and GitHub Pages sends none: it could reach the network even
// though the page can't. A blob: worker inherits the page's policy instead (connect-src 'none').
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ID = 'virtual:converter-worker';
const RESOLVED = `\0${ID}`;

/** @returns {import('vite').Plugin} */
export function workerSource() {
  return {
    name: 'converter-worker-source',
    resolveId(id) {
      return id === ID ? RESOLVED : null;
    },
    async load(id) {
      if (id !== RESOLVED) return null;
      const result = await build({
        configFile: false,
        logLevel: 'silent',
        build: {
          write: false,
          minify: true,
          // A classic script: library mode minifies only that format fully, and the worker exports nothing.
          lib: {
            entry: fileURLToPath(new URL('../src/app/worker.ts', import.meta.url)),
            formats: ['iife'],
            name: 'converterWorker',
          },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const chunk = outputs.flatMap((o) => ('output' in o ? o.output : [])).find((o) => o.type === 'chunk');
      if (!chunk) throw new Error('The worker bundle has no code');
      // Rebuild the page's script when any of the worker's modules changes.
      for (const file of chunk.moduleIds) if (!file.startsWith('\0')) this.addWatchFile(file);
      return `export default ${JSON.stringify(chunk.code)};`;
    },
  };
}
