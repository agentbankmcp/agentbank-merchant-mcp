// Build the self-contained server bundle for the .mcpb desktop extension.
// esbuild (ESM + node) inlines the MCP SDK + the generated card HTML into one
// file; the createRequire banner lets any bundled CJS deps call require(). The
// entry's shebang (src/index.ts line 1) is preserved on line 1 of the output, so
// the banner must NOT add its own (a second `#!` line is invalid JS).
// The `mcpb pack` step runs after this via the `build:mcpb` npm script.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'mcpb/server/index.js',
  banner: { js: "import{createRequire as cr}from'module';const require=cr(import.meta.url);" },
});

console.error('built mcpb/server/index.js');
