/**
 * Contract tests for the network contract documented in SECURITY.md — where
 * the Action's outbound network can go, and what third-party code ships to
 * consumer runners. Every allowlist here mirrors a claim in SECURITY.md; when
 * one of these tests fails, update SECURITY.md and the allowlist together in
 * the same change (see "Maintainers' checklist" there), never one alone.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const read = (...segments) => readFileSync(path.join(REPO_ROOT, ...segments), 'utf8');

/**
 * Hosts allowed in URL literals across the shipped bundle and the engine
 * source. `developers.notion.com` and `github.com` are inert `@notionhq/client`
 * package-metadata strings (homepage/repository links) embedded verbatim by
 * the bundler — the code never dereferences them. Anything else is an
 * undeclared endpoint.
 */
const BUNDLE_HOST_ALLOWLIST = new Set(['api.notion.com', 'developers.notion.com', 'github.com']);

/** The one API endpoint the engine contacts (through @notionhq/client). */
const NOTION_API_HOST = 'api.notion.com';

/**
 * Hosts Notion serves uploaded files from. The engine's one fetch call
 * downloads from these and nothing else, without credentials — see
 * "Notion-hosted files" in SECURITY.md.
 */
const NOTION_FILE_HOSTS = ['prod-files-secure.s3.us-west-2.amazonaws.com', 's3.us-west-2.amazonaws.com', 'file.notion.so'];

/** Modules the engine source may require — the client, plus stdlib file/path. */
const ENGINE_REQUIRE_ALLOWLIST = new Set(['@notionhq/client', 'fs', 'path']);

/** Executable `uses:` steps allowed in action.yml and our own workflows. */
const ACTIONS_USES_ALLOWLIST = new Set([
  'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6', // pinned at v2.2.0; downloads the Bun runtime from bun.sh — SECURITY.md destinations table
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', // pinned at v7.0.1; consumer-side standard; also used in this repo's own workflows
  './.github/workflows/ci.yml', // local reusable workflow call in release.yml — no network of its own
]);

/** URL literals with a plausible host (won't match the `https://...` doc placeholder). */
function urlHosts(text) {
  return [...text.matchAll(/https?:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*/g)].map((m) => m[0].split('//')[1]);
}

function requireTargets(text) {
  return [...text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
}

function usesWithLines(text) {
  return text.split('\n').flatMap((line) => {
    if (line.trim().startsWith('#')) return [];
    const match = line.match(/uses:\s*['"]?([^\s'"]+)/);
    return match ? [{ value: match[1], line }] : [];
  });
}

describe('network contract: dist bundle', () => {
  const bundle = read('dist', 'index.js');

  it('contains URL literals for allowlisted hosts only', () => {
    const hosts = urlHosts(bundle);
    for (const host of hosts) {
      expect(BUNDLE_HOST_ALLOWLIST.has(host)).toBe(true);
    }
  });

  it('contacts the Notion API and nothing else', () => {
    // The endpoint must actually be present (the client's default prefix URL);
    // combined with the allowlist above, this pins the full host set exactly.
    expect(new Set(urlHosts(bundle))).toEqual(new Set([NOTION_API_HOST, 'developers.notion.com', 'github.com']));
  });

  it('embeds only @notionhq/client third-party code', () => {
    const embedded = [...bundle.matchAll(/\/\/ (node_modules\/[^ "]+)/g)].map((m) => m[1]);
    expect(embedded.length).toBeGreaterThan(0);
    for (const module of embedded) {
      expect(module.startsWith('node_modules/@notionhq/client/')).toBe(true);
    }
  });

  it('never mentions InkDrafts, telemetry, or analytics', () => {
    // One exception: the web address of the example post the InkDrafts Notion
    // template ships, which the bulk-delete guard lets the owner remove. It
    // is compared against local files only, never sent anywhere.
    const text = bundle.toLowerCase().replaceAll("'welcome-to-inkdrafts'", '').replaceAll('"welcome-to-inkdrafts"', '');
    for (const needle of ['inkdrafts', 'analytics', 'telemetry']) {
      expect(text.includes(needle)).toBe(false);
    }
  });
});

describe('network contract: engine source', () => {
  const source = read('scripts', 'sync-notion.js');

  it('requires only the Notion client and stdlib fs/path', () => {
    expect(new Set(requireTargets(source))).toEqual(ENGINE_REQUIRE_ALLOWLIST);
  });

  it('has no direct network-client imports or fetch call sites', () => {
    const networkModules = ['http', 'https', 'net', 'tls', 'dgram', 'dns', 'undici', 'node-fetch', 'axios', 'got', 'superagent', 'ws'];
    for (const module of networkModules) {
      expect(source).not.toContain(`require('${module}')`);
      expect(source).not.toContain(`require("${module}")`);
    }
    // API requests flow through @notionhq/client. The engine itself calls
    // fetch exactly once, in downloadFile(), for Notion-hosted files
    // (fetchPublished/fetchAllBlocks are plain names over the client — this
    // regex matches a bare `fetch(` call only).
    const calls = [...source.matchAll(/(?<![\w.])fetch\s*\(/g)];
    expect(calls.length).toBe(1);
    const downloadFn = source.slice(source.indexOf('async function downloadFile('));
    expect(downloadFn.slice(0, downloadFn.indexOf('\n}\n'))).toMatch(/(?<![\w.])fetch\s*\(/);
  });

  it('downloads files only from the Notion file hosts, without sending credentials', () => {
    const declared = source.match(/const NOTION_FILE_HOSTS = \[([^\]]*)\]/)?.[1] ?? '';
    expect([...declared.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(NOTION_FILE_HOSTS);
    // The whole download function, not just the first call parenthesis: an
    // option added after the timeout signal must not slip past.
    const downloadFn = source.slice(source.indexOf('async function downloadFile('));
    const body = downloadFn.slice(0, downloadFn.indexOf('\n}\n'));
    expect(body).toMatch(/(?<![\w.])fetch\s*\(url\b/);
    expect(body).not.toMatch(/headers\s*:|Authorization|auth\w*\s*:|token|credentials/i);
    // Every download is gated by the host check, before and after redirects.
    expect(source.match(/isAllowedFileUrl\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('references the Notion API host as its only real endpoint', () => {
    const hosts = new Set(urlHosts(source));
    expect(hosts.has(NOTION_API_HOST)).toBe(true);
    for (const host of hosts) {
      if (host !== NOTION_API_HOST) {
        // Anything else must be documented here — today the source has no
        // other real-host URL literal.
        expect(BUNDLE_HOST_ALLOWLIST.has(host)).toBe(true);
      }
    }
  });
});

describe('network contract: package.json', () => {
  const pkg = JSON.parse(read('package.json'));

  it('declares @notionhq/client as the only runtime dependency', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@notionhq/client']);
  });

  it('declares no peer or optional dependencies', () => {
    expect(pkg.peerDependencies ?? {}).toEqual({});
    expect(pkg.optionalDependencies ?? {}).toEqual({});
  });
});

describe('network contract: workflows and action.yml', () => {
  const workflowDir = path.join(REPO_ROOT, '.github', 'workflows');
  const files = [
    path.join(REPO_ROOT, 'action.yml'),
    ...readdirSync(workflowDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => path.join(workflowDir, f)),
  ];

  it('uses only allowlisted actions and local workflows', () => {
    const used = files.flatMap((file) => usesWithLines(readFileSync(file, 'utf8')).map(({ value }) => value));
    expect(used.length).toBeGreaterThan(0);
    for (const uses of used) {
      expect(ACTIONS_USES_ALLOWLIST.has(uses)).toBe(true);
    }
  });

  it('pins every third-party action to a full commit SHA with a version comment', () => {
    const violations = [];
    for (const file of files) {
      const name = path.relative(REPO_ROOT, file);
      for (const { value, line } of usesWithLines(readFileSync(file, 'utf8'))) {
        if (value.startsWith('./')) continue;
        if (!/@[0-9a-f]{40}$/.test(value)) {
          violations.push(`${name}: '${value}' does not end in @ + 40 hex chars`);
        } else {
          const after = line.slice(line.indexOf(value) + value.length);
          if (!/#\s*v?\d+(\.\d+)+/.test(after)) {
            violations.push(`${name}: '${value}' has no '# vX.Y.Z' version comment after the SHA`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('network contract: SECURITY.md stays in sync', () => {
  const doc = read('SECURITY.md');

  it('documents every allowlisted endpoint and action', () => {
    for (const host of [NOTION_API_HOST, 'bun.sh', ...NOTION_FILE_HOSTS]) {
      expect(doc.includes(host)).toBe(true);
    }
    for (const uses of [
      'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    ]) {
      expect(doc.includes(uses)).toBe(true);
    }
  });

  it('documents the engine require allowlist (client, fs, path)', () => {
    // SECURITY.md's audit section claims exactly this import surface.
    expect(doc).toContain('@notionhq/client');
    expect(doc).toContain('`fs` and `path`');
  });
});
