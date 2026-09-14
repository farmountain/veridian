#!/usr/bin/env node
/**
 * PostToolUse formatter hook for Veridian.
 *
 * Runs the formatter this repository already configures, on the file that was just
 * written. Deliberately conservative, because Veridian is greenfield and has no manifest
 * yet (the stack is settled on TypeScript/Node, so `prettier` is the expected formatter):
 *
 *   - never installs anything (`npx --no-install`, module presence probes only)
 *   - never exits non-zero — a formatter failure must not block the agent's flow
 *   - no-ops silently when no formatter is configured yet
 *
 * That last point is the whole design: this hook becomes useful the day a formatter
 * appears in a manifest, with no further setup and no fabricated commands in the meantime.
 *
 * Contract: PostToolUse JSON arrives on stdin; exit 0 means "carry on".
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target',
  '.venv', 'venv', '__pycache__', '.next', 'coverage', '.mypy_cache', '.ruff_cache',
]);

const FORMATTABLE = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc',
  '.css', '.scss', '.less', '.html', '.md', '.mdx', '.yaml', '.yml',
  '.vue', '.svelte', '.astro',
  '.py', '.rs', '.go', '.cs', '.java', '.kt', '.swift',
  '.c', '.h', '.cc', '.cpp', '.hpp',
]);

const PATH_KEYS = [
  'file_path', 'filePath', 'path', 'file', 'target_file', 'targetFile',
  'filename', 'file_name', 'absolute_path',
];

/** A plausible file path: has an extension, is a single line, is not a glob. */
function looksLikeFile(v) {
  if (typeof v !== 'string') return false;
  if (v.length === 0 || v.length > 500) return false;
  if (/[\r\n]/.test(v)) return false;
  if (/[*?]/.test(v)) return false;
  return path.extname(v) !== '';
}

/** Depth-first search for the first plausible file path anywhere in the payload. */
function findPath(node, depth = 0) {
  if (depth > 8 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findPath(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of PATH_KEYS) {
    if (looksLikeFile(node[key])) return node[key];
  }
  for (const v of Object.values(node)) {
    const hit = findPath(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** Nearest ancestor directory containing a manifest or a .git directory. */
function findRoot(fromFile) {
  let dir = path.dirname(fromFile);
  const stop = path.parse(dir).root;
  for (;;) {
    for (const marker of ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', '.git']) {
      if (existsSync(path.join(dir, marker))) return dir;
    }
    if (dir === stop) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function onPath(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [cmd], { stdio: 'ignore' }).status === 0;
}

function tryRun(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: false });
  return { ok: r.status === 0, stderr: (r.stderr || '').trim() };
}

/** On Windows `npx` resolves to npx.ps1, which Node cannot spawn without a shell. */
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/**
 * All usable Python launchers, best first. A project may use a venv whose interpreter
 * lacks the formatter while a system interpreter has it, so callers try each in turn
 * rather than committing to the first one that answers.
 */
function pythonLaunchers() {
  const out = [];
  for (const [cmd, args] of [['python', []], ['py', ['-3']], ['python3', []]]) {
    if (onPath(cmd)) out.push({ cmd, args });
  }
  return out;
}

function readTextIfPresent(p) {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  } catch {
    return '';
  }
}

/** Prettier is considered configured only if it is declared or has a config file. */
function prettierConfigured(root) {
  const pkgPath = path.join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      for (const field of ['devDependencies', 'dependencies', 'peerDependencies']) {
        if (pkg[field] && pkg[field].prettier) return true;
      }
    } catch {
      /* malformed package.json — fall through to config-file detection */
    }
  }
  const configNames = [
    '.prettierrc', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml',
    '.prettierrc.json5', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs',
    'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs',
  ];
  return configNames.some((n) => existsSync(path.join(root, n)));
}

/**
 * Detect the formatter configured at `root` and run it against `file`.
 * Returns a short description of what ran, or null when nothing applies.
 */
function format(root, file) {
  const ext = path.extname(file).toLowerCase();
  const pkgPath = path.join(root, 'package.json');
  const pyprojectPath = path.join(root, 'pyproject.toml');
  const cargoPath = path.join(root, 'Cargo.toml');
  const goModPath = path.join(root, 'go.mod');

  // --- JS/TS and friends: Prettier ---
  if (existsSync(pkgPath) && !['.py', '.rs', '.go'].includes(ext) && prettierConfigured(root)) {
    if (onPath(NPX)) {
      const r = tryRun(NPX, ['--no-install', 'prettier', '--write', file], root);
      return r.ok ? 'prettier' : null;
    }
  }

  // --- Python: ruff, else black ---
  if (ext === '.py' && existsSync(pyprojectPath)) {
    const pyproject = readTextIfPresent(pyprojectPath);
    const attempts = [];
    if (/\bruff\b/.test(pyproject)) attempts.push(['ruff', 'format']);
    if (/\bblack\b/.test(pyproject)) attempts.push(['black', '--quiet']);
    for (const launcher of pythonLaunchers()) {
      for (const [mod, ...modArgs] of attempts) {
        // A venv interpreter may lack the formatter while a system one has it.
        const r = tryRun(launcher.cmd, [...launcher.args, '-m', mod, ...modArgs, file], root);
        if (r.ok) return `${mod} (via ${launcher.cmd})`;
      }
    }
  }

  // --- Rust ---
  if (ext === '.rs' && existsSync(cargoPath) && onPath('rustfmt')) {
    const r = tryRun('rustfmt', ['--edition', '2021', file], root);
    if (r.ok) return 'rustfmt';
  }

  // --- Go ---
  if (ext === '.go' && existsSync(goModPath) && onPath('gofmt')) {
    const r = tryRun('gofmt', ['-w', file], root);
    if (r.ok) return 'gofmt';
  }

  return null;
}

async function main() {
  let payload;
  try {
    const raw = await readStdin();
    if (!raw.trim()) return;
    payload = JSON.parse(raw);
  } catch {
    return; // unparseable stdin — stay silent, never block
  }

  const found = findPath(payload);
  if (!found) return;

  const file = path.resolve(process.cwd(), found);
  if (!existsSync(file)) return;

  const ext = path.extname(file).toLowerCase();
  if (!FORMATTABLE.has(ext)) return;

  const segments = file.split(path.sep).map((s) => s.toLowerCase());
  if (segments.some((s) => SKIP_DIRS.has(s))) return;

  try {
    if (statSync(file).isDirectory()) return;
  } catch {
    return;
  }

  const root = findRoot(file);
  if (!root) return;

  try {
    format(root, file);
  } catch {
    /* never surface formatter problems as hook failures */
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
