// The .mcpb manifest is a SECOND declaration of things the code already says,
// and nothing made the two agree. Its version sat at 0.0.44 from 2026-07-16 to
// 2026-08-24 while package.json went to 0.0.52 — eight releases during which
// anyone installing the desktop extension was shown a version that had not
// shipped in five weeks. Nothing failed, because a manifest is data: it is read
// by the extension host, never by a compiler or a test.
//
// So these are the two fields that must not drift, asserted against the source
// of truth rather than against a copy of it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const pkg = read('package.json') as { version: string; name: string };
const manifest = read('mcpb/manifest.json') as {
  version: string;
  tools: Array<{ name: string }>;
};

describe('mcpb manifest tracks the package', () => {
  test('declares the version that is actually being shipped', () => {
    expect(manifest.version).toBe(pkg.version);
  });

  // The manifest's tool list is what the extension directory shows a merchant
  // BEFORE they install. A tool added to the server and not here is invisible;
  // one removed from the server and left here is advertised and then missing.
  test('declares exactly the tools the server registers', () => {
    const source = readFileSync(join(root, 'src/index.ts'), 'utf8');
    const registered = [...source.matchAll(/name: '([a-z_]+)'/g)]
      .map((m) => m[1] as string)
      .filter((n) => n.includes('_'));
    const declared = manifest.tools.map((t) => t.name);

    expect(new Set(declared)).toEqual(new Set(registered));
    // Not just the same set — no duplicates hiding a rename.
    expect(declared.length).toBe(new Set(declared).size);
  });
});
