#!/usr/bin/env node
/**
 * Pre-push guard: catch local imports whose target file isn't tracked by git.
 *
 * The failure this prevents: an agent (or person) commits a file that does
 *   import { x } from '@/lib/newThing'
 * but forgets to `git add src/lib/newThing.jsx`. A local `npm run build` still
 * PASSES because the file is sitting in the working tree — but the pushed tree
 * doesn't contain it, so Vercel dies with "Could not load … ENOENT".
 *
 * So we must validate the COMMITTED tree, never the working tree:
 *   • the set of "files that exist" = files tracked in <ref> (git ls-tree)
 *   • the import lines we scan         = content read from <ref> (git grep)
 * A dirty/clean working tree is irrelevant — we only trust what git has.
 *
 * Resolution mirrors vite.config.js: alias '@' -> './src'. Only local
 * specifiers are checked ('@/…', './…', '../…'); bare packages (react,
 * '@radix-ui/…', etc.) are left to node_modules and ignored.
 *
 * Usage: node scripts/check-local-imports.mjs [ref]   (ref defaults to HEAD)
 * Exit 0 = clean, 1 = unresolved local imports found.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ref = process.argv[2] || 'HEAD';
const SRC_GLOB = 'src/'; // only source lives here
const SOURCE_EXT = /\.(jsx?|tsx?)$/;
// Extensions vite/node will try when the import omits one, plus index files.
const TRY_EXT = ['', '.js', '.jsx', '.ts', '.tsx', '.json', '.css'];
const TRY_INDEX = ['/index.js', '/index.jsx', '/index.ts', '/index.tsx'];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// 1. The universe of files that actually exist in the pushed tree.
const tracked = new Set(
  git(['ls-tree', '-r', '--name-only', ref]).split('\n').filter(Boolean),
);

// 2. Every source file in that tree (we only scan our own code).
const sourceFiles = [...tracked].filter((f) => f.startsWith(SRC_GLOB) && SOURCE_EXT.test(f));

// 3. Pull import/require/dynamic-import lines straight out of the committed
//    content (NOT the working tree) in one pass.
let grepOut = '';
try {
  grepOut = git([
    'grep', '-n', '-I', '-E',
    "(import|require|from)[^\\n]*['\"](@/|\\.\\.?/)",
    ref, '--', 'src/*.js', 'src/*.jsx', 'src/*.ts', 'src/*.tsx',
    'src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx',
  ]);
} catch (e) {
  // git grep exits 1 when there are zero matches — that's fine, not an error.
  if (e.status !== 1) throw e;
  grepOut = '';
}

const sourceSet = new Set(sourceFiles);
const SPEC_RE = /['"]([^'"]+)['"]/g;

function isLocal(spec) {
  return spec.startsWith('@/') || spec.startsWith('./') || spec.startsWith('../');
}

function resolves(fromFile, spec) {
  // strip query/hash suffixes (?raw, ?url, #frag) used by vite asset imports
  const clean = spec.replace(/[?#].*$/, '');
  let base;
  if (clean.startsWith('@/')) base = path.posix.join('src', clean.slice(2));
  else base = path.posix.join(path.posix.dirname(fromFile), clean);
  for (const ext of TRY_EXT) {
    if (tracked.has(base + ext)) return true;
  }
  for (const idx of TRY_INDEX) {
    if (tracked.has(base + idx)) return true;
  }
  return false;
}

const problems = [];
for (const line of grepOut.split('\n')) {
  if (!line) continue;
  // format: <ref>:<path>:<lineno>:<content>
  const m = line.match(/^[^:]+:([^:]+):(\d+):(.*)$/);
  if (!m) continue;
  const [, file, lineno, content] = m;
  if (!sourceSet.has(file)) continue;
  let sm;
  SPEC_RE.lastIndex = 0;
  while ((sm = SPEC_RE.exec(content)) !== null) {
    const spec = sm[1];
    if (!isLocal(spec)) continue;
    if (!resolves(file, spec)) {
      problems.push({ file, lineno, spec });
    }
  }
}

if (problems.length) {
  console.error('\n\x1b[31m✖ Push blocked: local import(s) point to files not tracked by git.\x1b[0m');
  console.error('  These would build locally but ENOENT-crash on Vercel.');
  console.error('  Fix: `git add` the missing file(s), or correct the import path.\n');
  for (const p of problems) {
    console.error(`  ${p.file}:${p.lineno}  →  '${p.spec}'`);
  }
  console.error(`\n  (checked tree: ${ref})\n`);
  process.exit(1);
}

console.log(`✓ local imports all resolve to tracked files (${sourceFiles.length} source files, tree ${ref})`);
process.exit(0);
