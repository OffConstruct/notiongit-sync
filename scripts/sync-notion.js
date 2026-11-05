#!/usr/bin/env node
/**
 * Notion → Jekyll Sync Script
 *
 * Syncs two Notion databases into a Jekyll site:
 *   1. Pages database  → _data/nav.yml + _data/home.yml + _pages/*.md
 *   2. Posts database  → _posts/*.md
 *
 * Environment variables:
 *   NOTION_TOKEN               — Notion integration secret (required)
 *   NOTION_PAGES_DATABASE_ID   — ID of the pages/sections database (optional)
 *   NOTION_POSTS_DATABASE_ID   — ID of the blog posts database (optional)
 *   NOTION_DATABASE_ID         — Legacy fallback for posts database
 *   ALLOW_BULK_DELETE          — "true" (any case) to bypass the bulk-delete guard
 *   MAX_DELETE_RATIO           — Fraction of tracked files a single sync may
 *                                delete before the guard trips (default 0.5)
 *   SITE_ROOT                  — Root of the Jekyll site to write into
 *                                (default: the parent of scripts/, i.e. the
 *                                repository this script lives in; the GitHub
 *                                Action wrapper points it at the consumer's
 *                                checkout, since a composite action's own
 *                                files live outside the workspace)
 *   NOTION_BASE_URL            — Overrides the Notion API origin (default
 *                                https://api.notion.com). Test/harness hook
 *                                only: lets the local Action harness point the
 *                                real client at a fake API; never set in
 *                                production.
 *
 * Files uploaded to Notion (photos, videos, PDFs, cover images, the profile
 * photo) are served from signed URLs that expire after an hour, so the engine
 * downloads them into assets/notion/ and links the local copy. Each copy is
 * named after the stable part of its Notion URL, so an unchanged file is
 * never downloaded or rewritten twice. See SECURITY.md for the host and type
 * checks.
 *
 * At least one of NOTION_PAGES_DATABASE_ID or NOTION_POSTS_DATABASE_ID
 * (/ NOTION_DATABASE_ID) must be set. NOTION_TOKEN, and database id values,
 * are trimmed before checking, so whitespace-only counts as unset.
 *
 * Missing or blank credentials are not a failure: the run exits 0 with
 * changed=false and a safe summary naming the missing configuration key,
 * so a scheduled run that lands before secrets are provisioned stays green.
 *
 * Action outputs — when GITHUB_OUTPUT is set (i.e. under the Action wrapper),
 * the run appends two non-secret outputs for the consumer workflow:
 *   changed                    — "true" when any tracked file was created,
 *                                updated, renamed or deleted this run
 *   summary                    — compact JSON run summary, schema_version 1
 *                                (see docs/run-summary-schema.md). Every
 *                                terminal path — success, no-op, a guarded
 *                                deletion, or an unexpected sync error —
 *                                emits one.
 * When GITHUB_STEP_SUMMARY is set, the same run summary is also rendered as
 * Markdown and appended there, for the human-readable Actions run page.
 * When RUN_SUMMARY_FILE is set (the Action wrapper points it at a
 * runner-temp path), the same run summary JSON is also written to that file
 * so the calling workflow can upload it as a durable artifact and read it
 * back after the run (see docs/run-summary-schema.md). Unset in local runs,
 * which behave exactly as they always have.
 */

'use strict';

const { Client } = require('@notionhq/client');
const fs   = require('fs');
const path = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────

/** Configuration problem — mirrors the script's historical exit-1 messages. */
class ConfigError extends Error {}

/**
 * Normalize a boolean-ish flag. GitHub Actions inputs arrive as strings, so
 * "true", "True" and "TRUE" all mean yes; everything else (including "false",
 * "" and undefined) means no.
 */
function isTrue(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

/**
 * Resolve and validate the environment configuration.
 *
 * `env` is injected so tests can exercise the input mapping without touching
 * process.env. Throws ConfigError (with the messages the script has always
 * exited 1 on) when NOTION_TOKEN is missing or no database ID is set.
 */
function resolveConfig(env = process.env) {
  const notionToken = String(env.NOTION_TOKEN ?? '').trim();
  if (!notionToken) {
    throw new ConfigError('NOTION_TOKEN environment variable is not set.');
  }

  const pagesDbId = String(env.NOTION_PAGES_DATABASE_ID ?? '').trim();
  const postsDbId = String(env.NOTION_POSTS_DATABASE_ID ?? '').trim() ||
                     String(env.NOTION_DATABASE_ID ?? '').trim();
  if (!pagesDbId && !postsDbId) {
    throw new ConfigError('Set NOTION_PAGES_DATABASE_ID and/or NOTION_POSTS_DATABASE_ID.');
  }

  return {
    notionToken,
    pagesDbId,
    postsDbId,
    allowBulkDelete: isTrue(env.ALLOW_BULK_DELETE),
    maxDeleteRatio:  Number(env.MAX_DELETE_RATIO) || 0.5,
    // import.meta.dir, not __dirname: bun build freezes __dirname into a
    // literal absolute path at bundle time (the build machine's checkout
    // path), which breaks both bundle reproducibility and the runtime
    // fallback once bundled. import.meta.dir stays a live runtime lookup
    // through bundling. The Action always sets SITE_ROOT explicitly, so this
    // fallback only matters for local/dev invocations of either form.
    siteRoot:        env.SITE_ROOT || path.join(import.meta.dir, '..'),
    notionBaseUrl:   env.NOTION_BASE_URL || '',
  };
}

// ─── Run state ────────────────────────────────────────────────────────────────

// Initialized per run by initRun(). Module-level so the sync functions below
// close over it exactly as they always have.
let notion;
let PAGES_DB_ID, POSTS_DB_ID, ALLOW_BULK_DELETE, MAX_DELETE_RATIO;
let ROOT_DIR, POSTS_DIR, PAGES_DIR, DATA_DIR, ASSETS_DIR;
let ASSET_URL_PREFIX, TEST_FILE_HOST;

function initRun(config) {
  PAGES_DB_ID       = config.pagesDbId;
  POSTS_DB_ID       = config.postsDbId;
  ALLOW_BULK_DELETE = config.allowBulkDelete;
  MAX_DELETE_RATIO  = config.maxDeleteRatio;
  notion            = new Client({
    auth:   config.notionToken,
    ...(config.notionBaseUrl ? { baseUrl: config.notionBaseUrl } : {}),
  });
  ROOT_DIR          = path.resolve(config.siteRoot);
  POSTS_DIR         = path.join(ROOT_DIR, '_posts');
  PAGES_DIR         = path.join(ROOT_DIR, '_pages');
  DATA_DIR          = path.join(ROOT_DIR, '_data');
  ASSETS_DIR        = path.join(ROOT_DIR, ...ASSETS_SUBDIR.split('/'));
  ASSET_URL_PREFIX  = `${readConfigBaseurl()}/${ASSETS_SUBDIR}/`;
  // The harness serves fake Notion files from its fake API origin.
  TEST_FILE_HOST    = config.notionBaseUrl ? new URL(config.notionBaseUrl).host : null;
}

/**
 * The site's `baseurl` from _config.yml ("" for a user site, "/my-site" for a
 * project site). Downloaded files are linked as root-relative paths, and the
 * themes print cover_image and profile_picture as-is, so the prefix has to be
 * baked in here.
 */
function readConfigBaseurl() {
  try {
    const config = fs.readFileSync(path.join(ROOT_DIR, '_config.yml'), 'utf8');
    const match  = config.match(/^baseurl:[ \t]*["']?([^"'#\n]*?)["']?[ \t]*(#.*)?$/m);
    return (match?.[1] ?? '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

// ─── Rich text → Markdown ─────────────────────────────────────────────────────

function richTextToMarkdown(richText = []) {
  return richText.map((item) => {
    let text = item.plain_text ?? '';
    if (!text) return '';

    const ann  = item.annotations ?? {};
    const href = item.href;

    if (ann.code)                text = `\`${text}\``;
    if (ann.bold && ann.italic)  text = `***${text}***`;
    else if (ann.bold)           text = `**${text}**`;
    else if (ann.italic)         text = `*${text}*`;
    if (ann.strikethrough)       text = `~~${text}~~`;
    if (href)                    text = `[${text}](${href})`;

    return text;
  }).join('');
}

/** Every rich-text part's plain text, joined: a title with one bold word is still one title. */
function richTextToPlain(richText = []) {
  return (richText ?? []).map((item) => item?.plain_text ?? '').join('');
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Block → Markdown ─────────────────────────────────────────────────────────

/** Indent every non-empty line, so nested Markdown stays inside its list item. */
function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map((line) => (line ? pad + line : line)).join('\n');
}

/** Prefix every line with `> `, so nested blocks stay inside their quote. */
function quoteLines(text) {
  return text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}

/** A list item's Markdown with its nested blocks indented under it. */
function listItem(marker, text, children) {
  if (children.length === 0) return `${marker}${text}`;
  const nested = blocksToMarkdown(children);
  if (!nested) return `${marker}${text}`;
  const gap = LIST_TYPES.has(children[0].type) ? '\n' : '\n\n';
  return `${marker}${text}${gap}${indent(nested, marker.length)}`;
}

/** Text followed by its nested blocks (Notion lets most blocks hold children). */
function withChildren(text, children) {
  const nested = children.length ? blocksToMarkdown(children) : '';
  if (!nested) return text;
  return text ? `${text}\n\n${nested}` : nested;
}

function tableCell(richText) {
  return richTextToMarkdown(richText).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function tableToMarkdown(data, rows) {
  const cells = rows
    .filter((row) => row.type === 'table_row')
    .map((row) => `| ${(row.table_row?.cells ?? []).map(tableCell).join(' | ')} |`);
  if (cells.length === 0) return null;
  if (!data.has_column_header) return cells.join('\n');
  const width = rows[0]?.table_row?.cells?.length ?? 1;
  const rule  = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  return [cells[0], rule, ...cells.slice(1)].join('\n');
}

/**
 * The link for a file-bearing block. A Notion-hosted file is linked only once
 * prepareBlocks() has copied it into the site (`block._local_url`): its own
 * URL expires within the hour.
 */
function fileBlockUrl(block, data) {
  if (data.type === 'external') return data.external?.url ?? '';
  return block._local_url ?? null;
}

function blockToMarkdown(block) {
  const type = block.type;
  const data = block[type];
  if (!data) return null;
  const children = block.children ?? [];

  switch (type) {
    case 'paragraph':
      return withChildren(richTextToMarkdown(data.rich_text), children);

    case 'heading_1':
      return withChildren(`# ${richTextToMarkdown(data.rich_text)}`, children);

    case 'heading_2':
      return withChildren(`## ${richTextToMarkdown(data.rich_text)}`, children);

    case 'heading_3':
      return withChildren(`### ${richTextToMarkdown(data.rich_text)}`, children);

    case 'bulleted_list_item':
      return listItem('- ', richTextToMarkdown(data.rich_text), children);

    case 'numbered_list_item':
      return listItem('1. ', richTextToMarkdown(data.rich_text), children);

    case 'to_do':
      return listItem('- ', `[${data.checked ? 'x' : ' '}] ${richTextToMarkdown(data.rich_text)}`, children);

    case 'code': {
      const lang    = data.language && data.language !== 'plain text' ? data.language : '';
      const code    = (data.rich_text ?? []).map((r) => r.plain_text).join('');
      const caption = richTextToMarkdown(data.caption ?? []);
      const block_md = `\`\`\`${lang}\n${code}\n\`\`\``;
      return caption ? `${block_md}\n*${caption}*` : block_md;
    }

    case 'quote':
      return quoteLines(withChildren(richTextToMarkdown(data.rich_text), children));

    case 'callout': {
      const icon = data.icon?.emoji ? `${data.icon.emoji} ` : '';
      return quoteLines(withChildren(`${icon}${richTextToMarkdown(data.rich_text)}`, children));
    }

    case 'divider':
      return '---';

    case 'image': {
      const url = fileBlockUrl(block, data);
      if (!url) return null;
      const caption = richTextToMarkdown(data.caption ?? []);
      return `![${caption}](${url})`;
    }

    case 'video': {
      const url = fileBlockUrl(block, data);
      if (!url) return null;
      const caption = richTextToMarkdown(data.caption ?? []);
      return caption ? `[▶ ${caption}](${url})` : `[▶ Watch video](${url})`;
    }

    case 'file':
    case 'pdf':
    case 'audio': {
      const url = fileBlockUrl(block, data);
      if (!url) return null;
      const label = richTextToMarkdown(data.caption ?? []) || data.name || 'Download the file';
      return `[${label}](${url})`;
    }

    case 'bookmark':
    case 'link_preview':
    case 'embed': {
      const url = data.url ?? '';
      if (!url) return null;
      const caption = richTextToMarkdown(data.caption ?? []);
      return `[${caption || url}](${url})`;
    }

    case 'equation':
      return data.expression ? `\`${data.expression}\`` : null;

    case 'toggle': {
      // markdown="1" lets kramdown render the Markdown inside the HTML block.
      const summary = escapeHtml(richTextToPlain(data.rich_text));
      const body    = children.length ? blocksToMarkdown(children) : '';
      return `<details markdown="1">\n<summary>${summary}</summary>\n\n${body ? `${body}\n\n` : ''}</details>`;
    }

    case 'column_list':
    case 'column':
    case 'synced_block':
      return children.length ? blocksToMarkdown(children) || null : null;

    case 'table':
      return tableToMarkdown(data, children);

    case 'table_of_contents':
      return '';

    case 'child_page':
    case 'child_database':
      return null;

    default:
      return null;
  }
}

// ─── Blocks → Markdown ────────────────────────────────────────────────────────

const LIST_TYPES = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do']);

function blocksToMarkdown(blocks) {
  const lines = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const md    = blockToMarkdown(block);

    if (md === null) continue;

    const prevBlock  = i > 0 ? blocks[i - 1] : null;
    const isList     = LIST_TYPES.has(block.type);
    const prevIsList = prevBlock ? LIST_TYPES.has(prevBlock.type) : false;

    if (lines.length > 0 && !(isList && prevIsList)) lines.push('');
    if (md !== '') lines.push(md);
  }

  return lines.join('\n').trim();
}

/**
 * Keep Liquid out of the author's words. Jekyll runs every post and page
 * through Liquid before Markdown, so a "{{" or "{%" typed in Notion would
 * either vanish or fail the whole site build. Bodies without either are left
 * byte-for-byte as they were.
 */
function protectLiquid(body) {
  if (!/\{[{%]/.test(body)) return body;
  const safe = body.replace(/\{%-?\s*endraw\s*-?%\}/g, '{% endraw %}{{ "{%" }} endraw %}{% raw %}');
  return `{% raw %}\n${safe}\n{% endraw %}`;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry Notion's rate limit (about three requests a second). Nested blocks
 * mean a long page can take dozens of calls, and one 429 must not fail the
 * row.
 */
async function withRateLimitRetry(call) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (err?.code !== 'rate_limited' || attempt >= 3) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function fetchAllBlocks(blockId) {
  const blocks = [];
  let cursor;
  do {
    const res = await withRateLimitRetry(() => notion.blocks.children.list({
      block_id:     blockId,
      start_cursor: cursor,
      page_size:    100,
    }));
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

async function fetchPublished(databaseId, statusValue = 'Published') {
  const pages = [];
  let cursor;
  do {
    const res = await withRateLimitRetry(() => notion.databases.query({
      database_id:  databaseId,
      filter: { property: 'Status', select: { equals: statusValue } },
      start_cursor: cursor,
    }));
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

// Block types blockToMarkdown renders, and the ones it drops on purpose
// (navigation aids with nothing to show). Anything else is counted as
// skipped so the run summary can say "some content was left out".
const RENDERED_BLOCK_TYPES = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item',
  'numbered_list_item', 'to_do', 'code', 'quote', 'callout', 'divider', 'image',
  'video', 'file', 'pdf', 'audio', 'bookmark', 'link_preview', 'embed',
  'equation', 'toggle', 'column_list', 'column', 'synced_block', 'table',
  'table_row',
]);
const SILENT_BLOCK_TYPES = new Set(['table_of_contents', 'breadcrumb']);
const FILE_BLOCK_TYPES   = new Set(['image', 'video', 'file', 'pdf', 'audio']);

/** Nested blocks are fetched this many levels deep (top-level blocks are level 1). */
const MAX_BLOCK_DEPTH = 3;

/**
 * Fetch nested blocks and copy Notion-hosted files into the site, in place,
 * so blocksToMarkdown() can stay a pure function of the prepared tree.
 */
async function prepareBlocks(blocks, ctx, depth = 1) {
  for (const block of blocks) {
    if (!RENDERED_BLOCK_TYPES.has(block.type)) {
      if (!SILENT_BLOCK_TYPES.has(block.type)) ctx.skippedBlocks++;
      continue;
    }
    const syncedFrom = block.type === 'synced_block' ? block.synced_block?.synced_from?.block_id : null;
    if (block.has_children || syncedFrom) {
      if (depth >= MAX_BLOCK_DEPTH) {
        ctx.skippedBlocks++;
      } else if (syncedFrom) {
        // A copy of a synced block holds no content of its own; it lives in
        // the original, which may sit on a page the connection can't read.
        try {
          block.children = await fetchAllBlocks(syncedFrom);
          await prepareBlocks(block.children, ctx, depth + 1);
        } catch {
          ctx.skippedBlocks++;
        }
      } else {
        block.children = await fetchAllBlocks(block.id);
        await prepareBlocks(block.children, ctx, depth + 1);
      }
    }
    const data = block[block.type];
    if (FILE_BLOCK_TYPES.has(block.type) && data?.type === 'file') {
      block._local_url = await localizeFile(data.file?.url, ctx);
    }
  }
}

/** Fetch and convert one row's body. */
async function renderPageBody(pageId, ctx) {
  const blocks = await fetchAllBlocks(pageId);
  await prepareBlocks(blocks, ctx);
  return blocksToMarkdown(blocks);
}

// ─── Notion-hosted files → assets/notion/ ─────────────────────────────────────

const ASSETS_SUBDIR = 'assets/notion';

/** Hosts Notion serves uploaded files from. Anything else is never fetched. */
const NOTION_FILE_HOSTS = [
  'prod-files-secure.s3.us-west-2.amazonaws.com',
  's3.us-west-2.amazonaws.com',
  'file.notion.so',
];

/** Per-file size cap. A git push rejects files over 100 MB, and a site full of 50 MB photos loads slowly anyway. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILE_MB    = MAX_FILE_BYTES / (1024 * 1024);

/** File extension → the content-type family the download must carry. */
const FILE_TYPES = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio',
  pdf: 'application', epub: 'application', zip: 'application',
  doc: 'application', docx: 'application', xls: 'application', xlsx: 'application',
  ppt: 'application', pptx: 'application', odt: 'application', ods: 'application', odp: 'application',
  txt: 'text', csv: 'text',
};
const GENERIC_CONTENT_TYPES = new Set(['application/octet-stream', 'binary/octet-stream']);

class FileProblem extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** cyrb53: a small stable string hash, so a file's name never depends on its expiring query string. */
function stableHash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0').slice(0, 12);
}

/** A file URL may be fetched only over https from a Notion file host (or from the harness's fake API). */
function isAllowedFileUrl(url) {
  if (TEST_FILE_HOST && url.host === TEST_FILE_HOST) return true;
  return url.protocol === 'https:' && NOTION_FILE_HOSTS.includes(url.hostname);
}

/** `photo 1.JPG` → `photo-1.jpg`, keeping only characters every web server and git handle. */
function safeFileName(raw) {
  let name;
  try { name = decodeURIComponent(raw); } catch { name = raw; }
  const dot  = name.lastIndexOf('.');
  const ext  = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const stem = slugify(dot > 0 ? name.slice(0, dot) : name).slice(0, 60) || 'file';
  return { stem, ext };
}

/** Read a response body into memory, giving up past the size cap. */
async function readCapped(res) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) throw new FileProblem('file_too_large');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > MAX_FILE_BYTES) throw new FileProblem('file_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

async function downloadFile(url, family, dest) {
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new FileProblem('file_unavailable');
  }
  let finalUrl;
  try { finalUrl = new URL(res.url || url.href); } catch { finalUrl = url; }
  if (!res.ok || !isAllowedFileUrl(finalUrl)) throw new FileProblem('file_unavailable');

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType && !GENERIC_CONTENT_TYPES.has(contentType) && contentType.split('/')[0] !== family) {
    throw new FileProblem('file_type_unsupported');
  }

  const bytes = await readCapped(res);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const partial = `${dest}.partial`;
  fs.writeFileSync(partial, bytes);
  fs.renameSync(partial, dest);
}

/**
 * Copy one Notion-hosted file into assets/notion/ and return the link to use
 * on the site, or null when the file had to be left out (the reason is
 * recorded on `ctx` for the run summary).
 *
 * The local name hashes the URL's path. Notion signs the same file with a
 * new query string on every read, but the path (which carries the file's own
 * id) stays put until the author uploads a different file, so an unchanged
 * photo is fetched once and never rewritten.
 */
async function localizeFile(rawUrl, ctx) {
  let url;
  try { url = new URL(rawUrl); } catch { return noteFileProblem(ctx, 'file_unavailable'); }
  if (!isAllowedFileUrl(url)) return noteFileProblem(ctx, 'file_unavailable');

  const { stem, ext } = safeFileName(url.pathname.split('/').pop() ?? '');
  const family = FILE_TYPES[ext];
  if (!family) return noteFileProblem(ctx, 'file_type_unsupported');

  const name = `${stableHash(url.pathname)}-${stem}.${ext}`;
  const dest = path.join(ASSETS_DIR, name);
  if (!fs.existsSync(dest)) {
    try {
      await downloadFile(url, family, dest);
      ctx.assets.downloaded++;
      console.log(`     downloaded: ${ASSETS_SUBDIR}/${name}`);
    } catch (err) {
      return noteFileProblem(ctx, err instanceof FileProblem ? err.code : 'file_unavailable');
    }
  }
  return `${ASSET_URL_PREFIX}${name}`;
}

function noteFileProblem(ctx, code) {
  ctx.fileProblems.push(code);
  console.warn(`     [skipped file] ${FILE_PROBLEM_TEXT[code] ?? code}`);
  return null;
}

/** A Files & media property's first file: external links pass through, uploads are copied. */
async function filesPropertyUrl(prop, ctx) {
  const first = prop?.files?.[0];
  if (!first) return '';
  if (first.type === 'external' || first.external) return first.external?.url ?? '';
  return (await localizeFile(first.file?.url, ctx)) ?? '';
}

/**
 * Delete copies that no generated file links to any more. Driven by what is
 * on disk after the sync, not by this run's rows, so a row that errored or
 * was held back keeps the files its last good version uses.
 */
function pruneAssets() {
  if (!fs.existsSync(ASSETS_DIR)) return 0;
  const linked = new Set();
  const scan = (file) => {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    for (const m of text.matchAll(/assets\/notion\/([A-Za-z0-9._-]+)/g)) linked.add(m[1]);
  };
  for (const dir of [POSTS_DIR, PAGES_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) scan(path.join(dir, f));
  }
  scan(path.join(DATA_DIR, 'home.yml'));

  let removed = 0;
  for (const f of fs.readdirSync(ASSETS_DIR)) {
    if (linked.has(f)) continue;
    try {
      fs.unlinkSync(path.join(ASSETS_DIR, f));
      removed++;
      console.log(`   removed (no longer used): ${ASSETS_SUBDIR}/${f}`);
    } catch { /* gone */ }
  }
  return removed;
}

// ─── Slugify ──────────────────────────────────────────────────────────────────

// Letters NFKD does not split into a base letter plus an accent.
const TRANSLITERATE = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', ł: 'l', þ: 'th', ı: 'i' };

/**
 * A web-address-safe slug: accents dropped ("día" → "dia"), apostrophes
 * dropped, every run of other characters turned into one hyphen. Returns "" when nothing usable is
 * left (a title written entirely in Japanese, say); callers then fall back.
 */
function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ßæœøđðłþı]/g, (ch) => TRANSLITERATE[ch])
    .replace(/['’"`]/g, '')
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/-+/g, '-')
    // Jekyll skips files whose name starts with "_".
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 80)
    .replace(/[-_]+$/, '');
}

/** Kept for callers that slug a title; the same rules as slugify(). */
function titleToSlug(title) {
  return slugify(title);
}

/** A slug that is already safe in a URL and a filename is kept exactly as typed, so existing addresses never move. */
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Decide a row's web address.
 *
 * 1. A typed Web address wins; it is cleaned up only when it would break a
 *    URL or a filename ("Mi viaje: día 1" → "mi-viaje-dia-1").
 * 2. Otherwise the address this row already has on the site is kept, so
 *    fixing a typo in a title never breaks a shared link.
 * 3. Otherwise it comes from the title, and failing that from the row's id.
 */
function resolveSlug({ typed, title, existingSlug, pageId }) {
  const typedClean = String(typed ?? '').trim();
  if (typedClean) {
    if (SAFE_SLUG.test(typedClean)) return typedClean;
    const cleaned = slugify(typedClean);
    if (cleaned) return cleaned;
  }
  if (existingSlug && SAFE_SLUG.test(existingSlug)) return existingSlug;
  return slugify(title) || `page-${String(pageId).replace(/-/g, '').slice(0, 8)}`;
}

// ─── YAML helpers ─────────────────────────────────────────────────────────────

/** Escape a string value for inline YAML (double-quoted). */
function yamlStr(value) {
  return JSON.stringify(String(value ?? ''));
}

// ─── Notion properties ────────────────────────────────────────────────────────

/** First property present under any of `names`. Notion names are case-sensitive, so the lists spell each variant. */
function findProp(props, names) {
  for (const name of names) {
    if (props[name] !== undefined) return props[name];
  }
  return undefined;
}

/** The plain text of a title or text property, every part joined. */
function propText(prop) {
  if (!prop) return '';
  if (Array.isArray(prop.title)) return richTextToPlain(prop.title);
  if (Array.isArray(prop.rich_text)) return richTextToPlain(prop.rich_text);
  return '';
}

/** The row's title: whichever column has Notion's title type, whatever it is called. */
function rowTitle(props) {
  const titleProp = Object.values(props).find((prop) => prop?.type === 'title') ??
                    findProp(props, ['Title', 'title', 'Name']);
  return propText(titleProp).trim() || 'Untitled';
}

// Column names the engine reads. The first entry of each list is the
// original (v1 template) name; later entries are aliases, including the
// plain names the v2 template uses. notiongit's src/notion-template.ts holds
// the same lists for validation; change both together.
const PAGE_COLUMNS = {
  slug:        ['Slug', 'slug', 'Web address', 'Web Address'],
  type:        ['Type', 'type'],
  navOrder:    ['Nav Order', 'Nav order', 'Order', 'Menu order', 'Menu Order'],
  showInNav:   ['Show in Nav', 'Show In Nav', 'Nav', 'Show in menu', 'Show in Menu'],
  description: ['Description', 'Excerpt', 'Summary'],
  name:        ['Name', 'Display Name', 'Author Name'],
  picture:     ['Profile Picture', 'Avatar', 'Photo'],
  tagline:     ['Tagline', 'Short Bio', 'Subtitle'],
  social:      ['Social Links', 'Socials', 'Links'],
};

const POST_COLUMNS = {
  slug:        ['Slug', 'slug', 'Web address', 'Web Address'],
  date:        ['Publish Date', 'Date', 'Published'],
  tags:        ['Tags'],
  description: ['Description', 'Excerpt', 'Summary'],
  cover:       ['Cover Image', 'Cover image', 'Cover'],
  canonical:   ['Canonical URL', 'Originally published at'],
  featured:    ['Featured'],
};

/** The v2 template's friendly Type labels, mapped to the engine's ids. */
const TYPE_LABELS = {
  'home page':     'home',
  'list of posts': 'blog-list',
  'regular page':  'markdown',
};

function normalizePageType(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return 'markdown';
  return TYPE_LABELS[value] ?? value;
}

// ─── Deletion guard ───────────────────────────────────────────────────────────

/** Web addresses of the example rows the Notion template ships with. */
const SAMPLE_SLUGS = new Set(['welcome-to-inkdrafts']);

/** The slug and title written in a generated file's front matter. */
function readFrontMatter(file) {
  try {
    const text  = fs.readFileSync(file, 'utf8');
    const head  = text.startsWith('---') ? text.slice(0, text.indexOf('\n---', 3) + 1) : '';
    const field = (key) => {
      const m = head.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
      if (!m) return '';
      const raw = m[1].trim();
      if (raw.startsWith('"')) {
        try { return JSON.parse(raw); } catch { return raw.slice(1, -1); }
      }
      return raw;
    };
    return { slug: field('slug'), title: field('title') };
  } catch {
    return { slug: '', title: '' };
  }
}

/**
 * Delete the files whose Notion pages came back unpublished — but refuse to do
 * it when the query result looks like a bad read rather than a real edit.
 *
 * A dropped Status option, a revoked integration share or a partial API
 * response all look identical to "the author unpublished everything", and the
 * sync commits straight to the default branch, so an unguarded delete can
 * wipe the live site without anyone touching Notion. Hold the deletions back
 * instead and report them; the rest of the section still lands.
 *
 * Allowed without asking:
 * - removing only the template's example rows (a new owner deleting the
 *   sample post leaves zero published posts, which otherwise looks exactly
 *   like a revoked share);
 * - up to two removals while Notion still returned at least one published
 *   row, which a misread database never does.
 *
 * Set ALLOW_BULK_DELETE=true to push a genuine mass unpublish through.
 *
 * Returns `{ deleted, guard }`; `guard` is null unless deletions were held.
 */
function applyDeletions(dir, label, notionIdToFile, processedIds) {
  const stale = [...notionIdToFile].filter(([id]) => !processedIds.has(id));
  if (stale.length === 0) return { deleted: 0, guard: null };

  const tracked = notionIdToFile.size;
  const ratio   = stale.length / tracked;
  const fronts  = stale.map(([, f]) => readFrontMatter(path.join(dir, f)));

  const onlySamples = fronts.every((fm) => SAMPLE_SLUGS.has(fm.slug));
  const suspicious  = !onlySamples && (
    processedIds.size === 0 ||
    (stale.length > 2 && ratio > MAX_DELETE_RATIO)
  );

  if (suspicious && !ALLOW_BULK_DELETE) {
    console.error(
      `\n   HELD BACK: this sync would delete ${stale.length} of ${tracked} tracked ${label} ` +
      `(${Math.round(ratio * 100)}%).\n` +
      `   Notion returned ${processedIds.size} published row(s), which usually means the\n` +
      `   database was misread — a renamed Status option, a revoked integration share,\n` +
      `   or a partial API response — not that you unpublished them.\n\n` +
      `   Would have deleted:\n` +
      stale.map(([, f]) => `     - ${f}`).join('\n') + '\n\n' +
      `   Those files were kept. Check the database in Notion. If the deletion is real,\n` +
      `   re-run this workflow with ALLOW_BULK_DELETE=true.`
    );
    return {
      deleted: 0,
      guard: {
        label,
        staleCount:   stale.length,
        trackedCount: tracked,
        ratio,
        titles:       fronts.map((fm, i) => fm.title || stale[i][1]),
      },
    };
  }

  if (suspicious) {
    console.log(`\n   ALLOW_BULK_DELETE set — deleting ${stale.length} of ${tracked} ${label}.`);
  }

  let deleted = 0;
  for (const [, filename] of stale) {
    try {
      fs.unlinkSync(path.join(dir, filename));
      deleted++;
      console.log(`\n   removed (unpublished): ${filename}`);
    } catch {
      console.warn(`   Warning: could not remove ${filename}`);
    }
  }
  return { deleted, guard: null };
}

// ─── YAML helpers (cont.) ─────────────────────────────────────────────────────

/** Write a YAML list of nav items. */
function buildNavYaml(items) {
  if (items.length === 0) return '[]\n';
  return items.map((item) =>
    `- title: ${yamlStr(item.title)}\n  url: ${yamlStr(item.url)}`
  ).join('\n') + '\n';
}

/** Write the home data YAML. */
function buildHomeYaml(data) {
  const lines = [];
  lines.push(`name: ${yamlStr(data.name)}`);
  lines.push(`tagline: ${yamlStr(data.tagline)}`);
  lines.push(`profile_picture: ${yamlStr(data.profile_picture)}`);

  if (data.social_links && data.social_links.length > 0) {
    lines.push('social_links:');
    for (const link of data.social_links) {
      lines.push(`  - name: ${yamlStr(link.name)}`);
      lines.push(`    url: ${yamlStr(link.url)}`);
    }
  } else {
    lines.push('social_links: []');
  }

  // Bio as a YAML literal block (|)
  if (data.bio) {
    lines.push('bio: |');
    for (const line of data.bio.split('\n')) {
      lines.push(`  ${line}`);
    }
  } else {
    lines.push('bio: ""');
  }

  lines.push(`notion_id: ${yamlStr(data.notion_id)}`);
  return lines.join('\n') + '\n';
}

// ─── Site identity → _config.yml ──────────────────────────────────────────────

/** The description older templates shipped; replaced even when the owner has not written one. */
const LEGACY_DESCRIPTION = 'A Notion-powered Jekyll site.';
const NEUTRAL_DESCRIPTION = 'A personal website, written in Notion.';

/**
 * Point _config.yml's `title`, `author.name` and `description` at the home
 * row's Name and Tagline (or Summary).
 *
 * jekyll-seo-tag builds the browser tab title, the meta description and the
 * link-preview text from `site.title` / `site.description`, and jekyll-feed
 * takes the feed title and author from `site.title` / `site.author.name`. None
 * of those can read a data file, so the values have to land in _config.yml.
 *
 * Edited line by line rather than parsed and re-emitted: _config.yml is otherwise
 * hand-maintained, and a YAML round-trip would drop its comments and ordering.
 * Anything unrecognised is left alone and reported.
 *
 * Returns true when the file was rewritten.
 */
function syncConfigIdentity(name, description = '') {
  if (!name) return false;

  const configPath = path.join(ROOT_DIR, '_config.yml');
  let original;
  try {
    original = fs.readFileSync(configPath, 'utf8');
  } catch {
    console.warn('   Warning: _config.yml not readable — site title left unchanged.');
    return false;
  }

  let inAuthor    = false;
  let sawTitle    = false;
  let sawAuthorName = false;

  const updated = original.split('\n').map((line) => {
    const isBlank    = line.trim() === '';
    const isIndented = /^[ \t]/.test(line);

    // A non-indented, non-blank line either opens the `author:` block or closes it.
    if (!isBlank && !isIndented) inAuthor = /^author:[ \t]*(#.*)?$/.test(line);

    if (!isIndented && /^title:/.test(line)) {
      sawTitle = true;
      return `title: ${yamlStr(name)}`;
    }
    if (!isIndented && /^description:/.test(line)) {
      if (description) return `description: ${yamlStr(description)}`;
      if (line.includes(LEGACY_DESCRIPTION)) return `description: ${yamlStr(NEUTRAL_DESCRIPTION)}`;
      return line;
    }
    if (inAuthor && isIndented && /^[ \t]+name:/.test(line)) {
      sawAuthorName = true;
      return `${line.match(/^[ \t]+/)[0]}name: ${yamlStr(name)}`;
    }
    return line;
  }).join('\n');

  if (!sawTitle)      console.warn('   Warning: no top-level `title:` in _config.yml — tab title not updated.');
  if (!sawAuthorName) console.warn('   Warning: no `author.name` in _config.yml — feed author not updated.');

  if (updated === original) {
    console.log('   unchanged: _config.yml');
    return false;
  }
  fs.writeFileSync(configPath, updated, 'utf8');
  console.log(`   updated: _config.yml (site title → ${name})`);
  return true;
}

// ─── Parse social links text ──────────────────────────────────────────────────

/**
 * Parse the "Social Links" Notion text property.
 * Expected format (one per line):   Name: https://...
 * Returns an array of { name, url } objects.
 */
function parseSocialLinks(raw) {
  if (!raw || !raw.trim()) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return null;
      const name = line.slice(0, colonIdx).trim();
      const url  = line.slice(colonIdx + 1).trim();
      if (!name || !url) return null;
      // url may start without http if user only typed a domain — keep as-is
      return { name, url: url.startsWith('//') ? `https:${url}` : url };
    })
    .filter(Boolean);
}

// ─── Shared section plumbing ──────────────────────────────────────────────────

function newStats() {
  return { created: 0, updated: 0, renamed: 0, deleted: 0, unchanged: 0, errors: 0, scheduled: 0, skipped_blocks: 0 };
}

/** Per-row conversion context: where this row's left-out content is tallied. */
function rowContext(section, title, assets) {
  return { section, title, skippedBlocks: 0, fileProblems: [], assets };
}

/** Fold one row's left-out content into the section's report. */
function recordSkipped(report, ctx) {
  report.stats.skipped_blocks += ctx.skippedBlocks;
  if (ctx.skippedBlocks > 0) {
    report.skipped.push({ section: ctx.section, title: ctx.title, reason_code: 'blocks_unsupported', count: ctx.skippedBlocks });
  }
  const byCode = new Map();
  for (const code of ctx.fileProblems) byCode.set(code, (byCode.get(code) ?? 0) + 1);
  for (const [code, count] of byCode) {
    report.skipped.push({ section: ctx.section, title: ctx.title, reason_code: code, count });
  }
}

/** Index a generated directory by the notion_id in each file's front matter. */
function indexByNotionId(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const notionIdToFile = new Map();
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      const match   = content.match(/^notion_id:\s*"?([a-f0-9-]{36})"?/m);
      if (match) notionIdToFile.set(match[1], file);
    } catch { /* skip */ }
  }
  return { files, notionIdToFile };
}

/**
 * Two published rows that would write the same file: the row that already
 * owns the file keeps it, otherwise the first row Notion returned. Returns
 * the ids that lose.
 */
function findAddressClashes(planned, notionIdToFile) {
  const byFile = new Map();
  for (const item of planned) {
    const list = byFile.get(item.filename) ?? [];
    list.push(item);
    byFile.set(item.filename, list);
  }
  const losers = new Set();
  for (const [filename, list] of byFile) {
    if (list.length < 2) continue;
    const owner = list.find((item) => notionIdToFile.get(item.page.id) === filename) ?? list[0];
    for (const item of list) if (item !== owner) losers.add(item.page.id);
  }
  return losers;
}

/** Write `content` to dir/filename, moving the row's previous file if its address changed. */
function writeRowFile(dir, label, filename, content, prevFilename, existingFiles, stats) {
  const filePath = path.join(dir, filename);
  const renamed  = Boolean(prevFilename && prevFilename !== filename);
  if (renamed) {
    try { fs.unlinkSync(path.join(dir, prevFilename)); } catch { /* gone */ }
    stats.renamed++;
    console.log(`     renamed: ${prevFilename} → ${filename}`);
  }

  const needsWrite = !fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== content;
  if (!needsWrite) {
    console.log('     unchanged');
    stats.unchanged++;
    return;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  // A rename already carries the write; don't also count it as created/updated.
  if (renamed) {
    console.log(`     wrote: ${label}${filename}`);
    return;
  }
  const isNew = !existingFiles.includes(filename);
  console.log(`     ${isNew ? 'created' : 'updated'}: ${label}${filename}`);
  isNew ? stats.created++ : stats.updated++;
}

function rowFailure(report, section, title, reasonCode, err) {
  report.stats.errors++;
  report.failed.push({ section, title, reason_code: reasonCode });
  console.error(`     [error] ${err ? err.message : ROW_PROBLEM_TEXT[reasonCode]}`);
}

/** Notion API failures reading a row, as opposed to bugs in the conversion. */
function reasonForRowError(err) {
  return err && typeof err.code === 'string' && err.status ? 'read_failed' : 'unexpected';
}

// ─── Pages sync ───────────────────────────────────────────────────────────────

/**
 * Extract metadata from a Notion page in the Pages database. `existingSlug`
 * is the slug this row's current file uses, if any (see resolveSlug).
 */
function extractPageMeta(page, existingSlug = '') {
  const props = page.properties;
  const title = rowTitle(props);

  const slug = resolveSlug({
    typed: propText(findProp(props, PAGE_COLUMNS.slug)),
    title,
    existingSlug,
    pageId: page.id,
  });

  const type = normalizePageType(findProp(props, PAGE_COLUMNS.type)?.select?.name);

  const navOrder  = findProp(props, PAGE_COLUMNS.navOrder)?.number ?? 99;
  const showInNav = findProp(props, PAGE_COLUMNS.showInNav)?.checkbox ?? false;

  const description = propText(findProp(props, PAGE_COLUMNS.description)).trim();

  // Home-specific properties
  // `Name` is the display name shown on the home page (separate from the page Title).
  // If not set, falls back to the page Title.
  const displayName = propText(findProp(props, PAGE_COLUMNS.name)).trim() || title;

  // Text (a link) in v1 templates, Files & media in v2; syncPages() copies an
  // uploaded photo into the site.
  const picProp = findProp(props, PAGE_COLUMNS.picture);
  const profile_picture = propText(picProp).trim();

  const tagline = propText(findProp(props, PAGE_COLUMNS.tagline)).trim();

  const socialRaw    = propText(findProp(props, PAGE_COLUMNS.social));
  const social_links = parseSocialLinks(socialRaw);

  return { title, displayName, slug, type, navOrder, showInNav, description, profile_picture, tagline, social_links };
}

/**
 * Build Jekyll front matter for a regular page.
 */
function buildPageFrontMatter(meta, notionId, layout) {
  const lines = ['---'];
  lines.push(`layout: ${layout}`);
  lines.push(`title: ${yamlStr(meta.title)}`);
  lines.push(`slug: ${yamlStr(meta.slug)}`);
  if (meta.description) lines.push(`description: ${yamlStr(meta.description)}`);
  lines.push(`notion_id: ${yamlStr(notionId)}`);
  lines.push('---');
  return lines.join('\n');
}

/**
 * Map a Notion page type to a Jekyll layout name.
 */
function typeToLayout(type) {
  switch (normalizePageType(type)) {
    case 'blog-list':
    case 'blog':
      return 'blog';
    case 'home':
      return 'home'; // handled separately
    default:
      return 'page';
  }
}

function newReport() {
  return { stats: newStats(), failed: [], skipped: [], guard: null };
}

async function syncPages(assets) {
  console.log('\n── Pages sync ────────────────────────────────────────────────');
  console.log(`   Database: ${PAGES_DB_ID}`);

  fs.mkdirSync(PAGES_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR,  { recursive: true });

  const { files: existingFiles, notionIdToFile } = indexByNotionId(PAGES_DIR);

  let publishedPages;
  try {
    publishedPages = await fetchPublished(PAGES_DB_ID);
  } catch (err) {
    throw new Error(`Error querying pages database: ${err.message}`);
  }
  console.log(`   Published pages in Notion: ${publishedPages.length}\n`);
  const navItems     = [];
  let   homeData     = null;
  const processedIds = new Set();
  const report       = newReport();
  const { stats }    = report;

  const planned = [];
  for (const page of publishedPages) {
    processedIds.add(page.id);
    const prev = notionIdToFile.get(page.id);
    let meta;
    try {
      meta = extractPageMeta(page, prev ? readFrontMatter(path.join(PAGES_DIR, prev)).slug : '');
    } catch (err) {
      console.error(`   [skip] Cannot read metadata for ${page.id}: ${err.message}`);
      rowFailure(report, 'pages', rowTitleSafe(page), 'unexpected', err);
      continue;
    }
    planned.push({ page, meta, filename: meta.type === 'home' ? null : `${meta.slug}.md` });
  }
  const clashes = findAddressClashes(planned.filter((p) => p.filename), notionIdToFile);

  for (const { page, meta, filename } of planned) {
    console.log(`   → "${meta.title}" (${meta.type}, /${meta.slug})`);

    if (clashes.has(page.id)) {
      rowFailure(report, 'pages', meta.title, 'duplicate_web_address');
      continue;
    }

    // Accumulate nav
    if (meta.showInNav) {
      navItems.push({
        title: meta.title,
        url:   meta.type === 'home' ? '/' : `/${meta.slug}`,
        order: meta.navOrder,
      });
    }

    const ctx = rowContext('pages', meta.title, assets);

    // Handle home type
    if (meta.type === 'home') {
      try {
        const bio = await renderPageBody(page.id, ctx);
        const picProp = findProp(page.properties, PAGE_COLUMNS.picture);
        const profile_picture = picProp?.files ? await filesPropertyUrl(picProp, ctx) : meta.profile_picture;
        homeData = {
          name:            meta.displayName,
          tagline:         meta.tagline,
          description:     meta.description,
          profile_picture,
          social_links:    meta.social_links,
          bio,
          notion_id:       page.id,
        };
        recordSkipped(report, ctx);
        console.log('     home data collected');
      } catch (err) {
        rowFailure(report, 'pages', meta.title, reasonForRowError(err), err);
      }
      continue; // don't write a _pages/ file for home
    }

    // Write _pages/{slug}.md
    try {
      const body    = protectLiquid(await renderPageBody(page.id, ctx));
      const layout  = typeToLayout(meta.type);
      const fm      = buildPageFrontMatter(meta, page.id, layout);
      const content = `${fm}\n\n${body}\n`;
      writeRowFile(PAGES_DIR, '_pages/', filename, content, notionIdToFile.get(page.id), existingFiles, stats);
      recordSkipped(report, ctx);
    } catch (err) {
      rowFailure(report, 'pages', meta.title, reasonForRowError(err), err);
    }
  }

  // Remove pages no longer published
  const deletion = applyDeletions(PAGES_DIR, 'pages', notionIdToFile, processedIds);
  stats.deleted += deletion.deleted;
  report.guard = deletion.guard;

  // A held-back deletion means this read of the database is not trusted, so
  // the menu and the home page keep their last good version too.
  if (report.guard) {
    console.log('\n   kept as they were: _data/nav.yml, _data/home.yml, _config.yml');
    console.log(`\n   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
    return { ...report, navChanged: false, homeChanged: false, configChanged: false };
  }

  // Write _data/nav.yml
  navItems.sort((a, b) => a.order - b.order);
  const navYaml = buildNavYaml(navItems);
  const navPath = path.join(DATA_DIR, 'nav.yml');
  const existingNav = fs.existsSync(navPath) ? fs.readFileSync(navPath, 'utf8') : '';
  let navChanged = false;
  if (existingNav !== navYaml) {
    fs.writeFileSync(navPath, navYaml, 'utf8');
    navChanged = true;
    console.log('\n   updated: _data/nav.yml');
  } else {
    console.log('\n   unchanged: _data/nav.yml');
  }

  // Write _data/home.yml (use existing if no home page found)
  let homeChanged   = false;
  let configChanged = false;
  if (homeData) {
    const homeYaml = buildHomeYaml(homeData);
    const homePath = path.join(DATA_DIR, 'home.yml');
    const existingHome = fs.existsSync(homePath) ? fs.readFileSync(homePath, 'utf8') : '';
    if (existingHome !== homeYaml) {
      fs.writeFileSync(homePath, homeYaml, 'utf8');
      homeChanged = true;
      console.log('   updated: _data/home.yml');
    } else {
      console.log('   unchanged: _data/home.yml');
    }

    configChanged = syncConfigIdentity(homeData.name, homeData.tagline || homeData.description);
  }

  console.log(`\n   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
  return { ...report, navChanged, homeChanged, configChanged };
}

/** A title for the run summary even when the row's metadata could not be read. */
function rowTitleSafe(page) {
  try { return rowTitle(page.properties ?? {}); } catch { return 'Untitled'; }
}

// ─── Posts sync ───────────────────────────────────────────────────────────────

/** Today's date (YYYY-MM-DD) in the site's time zone, which the template pins to UTC. */
function todayDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Whether a post's date is still ahead. A date without a time is compared as
 * a calendar day; one with a time and offset is compared as an instant.
 */
function isFutureDate(date, now = new Date()) {
  if (!date) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date > todayDate(now);
  const at = Date.parse(date);
  return Number.isFinite(at) && at > now.getTime();
}

function extractPostMeta(page, existingSlug = '') {
  const props = page.properties;
  const title = rowTitle(props);

  const slug = resolveSlug({
    typed: propText(findProp(props, POST_COLUMNS.slug)),
    title,
    existingSlug,
    pageId: page.id,
  });

  // An empty date falls back to the day the row was created, not today:
  // post addresses contain the date, and "today" would move it every day.
  const dateProp  = findProp(props, POST_COLUMNS.date);
  const date      = dateProp?.date?.start ??
                    (page.created_time ? String(page.created_time).slice(0, 10) : todayDate());

  const tags      = (findProp(props, POST_COLUMNS.tags)?.multi_select ?? []).map((t) => t.name);

  const description = propText(findProp(props, POST_COLUMNS.description)).trim();

  const coverFiles  = findProp(props, POST_COLUMNS.cover)?.files ?? [];
  const coverImage  =
    coverFiles[0]?.external?.url ??
    coverFiles[0]?.file?.url ??
    '';

  const canonicalUrl = findProp(props, POST_COLUMNS.canonical)?.url ?? '';
  const featured     = findProp(props, POST_COLUMNS.featured)?.checkbox ?? false;

  return { title, slug, date, tags, description, coverImage, canonicalUrl, featured };
}

function buildPostFrontMatter(meta, notionId) {
  const lines = ['---'];
  lines.push(`layout: post`);
  lines.push(`title: ${yamlStr(meta.title)}`);
  lines.push(`date: ${meta.date}`);
  lines.push(`slug: ${yamlStr(meta.slug)}`);
  if (meta.tags.length > 0) {
    lines.push(`tags: [${meta.tags.map(yamlStr).join(', ')}]`);
  }
  if (meta.description)  lines.push(`excerpt: ${yamlStr(meta.description)}`);
  if (meta.coverImage)   lines.push(`cover_image: ${yamlStr(meta.coverImage)}`);
  if (meta.canonicalUrl) lines.push(`canonical_url: ${yamlStr(meta.canonicalUrl)}`);
  if (meta.featured)     lines.push(`featured: true`);
  lines.push(`notion_id: ${yamlStr(notionId)}`);
  lines.push('---');
  return lines.join('\n');
}

/** Jekyll's dated filename; only the calendar day of a date-with-time goes in it. */
function postFilename(date, slug) {
  return `${String(date).slice(0, 10)}-${slug}.md`;
}

/** The slug part of an existing `YYYY-MM-DD-slug.md` post, for posts written before slugs were quoted. */
function existingPostSlug(file) {
  return readFrontMatter(path.join(POSTS_DIR, file)).slug || file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
}

async function syncPosts(assets) {
  console.log('\n── Posts sync ────────────────────────────────────────────────');
  console.log(`   Database: ${POSTS_DB_ID}`);

  fs.mkdirSync(POSTS_DIR, { recursive: true });

  const { files: existingFiles, notionIdToFile } = indexByNotionId(POSTS_DIR);

  console.log(`   Existing posts in _posts/: ${existingFiles.length}`);

  let publishedPages;
  try {
    publishedPages = await fetchPublished(POSTS_DB_ID);
  } catch (err) {
    throw new Error(`Error querying posts database: ${err.message}`);
  }
  console.log(`   Published posts in Notion: ${publishedPages.length}\n`);

  const processedIds = new Set();
  const report       = newReport();
  const { stats }    = report;

  const planned = [];
  for (const page of publishedPages) {
    // Counted as present even when held back below, so a post moved to a
    // future date is neither deleted nor counted toward the guard.
    processedIds.add(page.id);
    const prev = notionIdToFile.get(page.id);
    let meta;
    try {
      meta = extractPostMeta(page, prev ? existingPostSlug(prev) : '');
    } catch (err) {
      console.error(`   [skip] Cannot read metadata for ${page.id}: ${err.message}`);
      rowFailure(report, 'posts', rowTitleSafe(page), 'unexpected', err);
      continue;
    }
    if (isFutureDate(meta.date)) {
      console.log(`   → "${meta.title}" waits for ${meta.date}`);
      stats.scheduled++;
      continue;
    }
    planned.push({ page, meta, filename: postFilename(meta.date, meta.slug) });
  }
  const clashes = findAddressClashes(planned, notionIdToFile);

  for (const { page, meta, filename } of planned) {
    console.log(`   → "${meta.title}"`);

    if (clashes.has(page.id)) {
      rowFailure(report, 'posts', meta.title, 'duplicate_web_address');
      continue;
    }

    const ctx = rowContext('posts', meta.title, assets);
    try {
      const coverProp = findProp(page.properties, POST_COLUMNS.cover);
      const coverImage = coverProp?.files?.length ? await filesPropertyUrl(coverProp, ctx) : '';
      const body     = protectLiquid(await renderPageBody(page.id, ctx));
      const fm       = buildPostFrontMatter({ ...meta, coverImage }, page.id);
      const content  = `${fm}\n\n${body}\n`;
      writeRowFile(POSTS_DIR, '', filename, content, notionIdToFile.get(page.id), existingFiles, stats);
      recordSkipped(report, ctx);
    } catch (err) {
      rowFailure(report, 'posts', meta.title, reasonForRowError(err), err);
    }
  }

  // Remove unpublished posts
  const deletion = applyDeletions(POSTS_DIR, 'posts', notionIdToFile, processedIds);
  stats.deleted += deletion.deleted;
  report.guard = deletion.guard;

  console.log(`\n   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
  return { ...report, navChanged: false, homeChanged: false, configChanged: false };
}

// ─── Action outputs ───────────────────────────────────────────────────────────

/**
 * Fold per-section results into the two values the Action wrapper exposes.
 * `changed` is true when any tracked file was created, updated, renamed or
 * deleted, any of the three data/config files was rewritten, or a Notion
 * file was copied in or cleaned out of assets/notion/. `summary` is a single
 * non-secret line of counts (titles, IDs and tokens deliberately excluded).
 */
function buildActionResult(sections, assets = { downloaded: 0, removed: 0 }) {
  let changed = assets.downloaded > 0 || assets.removed > 0;
  const parts = [];

  for (const { label, stats, navChanged, homeChanged, configChanged } of sections) {
    if (stats.created || stats.updated || stats.renamed || stats.deleted ||
        navChanged || homeChanged || configChanged) {
      changed = true;
    }

    const counts = [
      `${stats.created} created`,
      `${stats.updated} updated`,
      `${stats.renamed} renamed`,
      `${stats.deleted} deleted`,
      `${stats.unchanged} unchanged`,
    ];
    if (stats.scheduled) counts.push(`${stats.scheduled} scheduled`);
    if (stats.errors) counts.push(`${stats.errors} errors`);
    const section = `${label}: ${counts.join(', ')}`;

    const dataFiles = [
      navChanged    ? 'nav.yml'     : null,
      homeChanged   ? 'home.yml'    : null,
      configChanged ? '_config.yml' : null,
    ].filter(Boolean);
    parts.push(dataFiles.length ? `${section} (${dataFiles.join(', ')} updated)` : section);
  }

  if (assets.downloaded || assets.removed) {
    parts.push(`files: ${assets.downloaded} downloaded, ${assets.removed} removed`);
  }
  if (sections.length === 0) parts.push('no sections synced');
  return { changed, summary: parts.join('; ') };
}

// ─── Run summary (schema_version 1) ───────────────────────────────────────────
//
// See docs/run-summary-schema.md and schema/run-summary.v1.json for the
// documented, versioned contract this section builds and emits. Kept in sync
// by test/run-summary-schema.test.js.

const RUN_SUMMARY_SCHEMA_VERSION = 1;

/** At most this many rows are named in `affected` and `skipped`; the counts carry the rest. */
const SUMMARY_ROWS_MAX = 20;

/**
 * Plain-language reasons, for the Actions run page and as a fallback for
 * dashboards that do not know a `reason_code` yet. A dashboard should map
 * `reason_code` to its own wording.
 */
const ROW_PROBLEM_TEXT = {
  duplicate_web_address: 'Another row already uses the same web address. Give one of them a different Web address.',
  read_failed:           'Notion did not hand it over this time. It will be tried again at the next update.',
  unexpected:            'Something in it could not be converted. Try removing the most recent change.',
  would_remove:          'No longer Published in Notion.',
};

const FILE_PROBLEM_TEXT = {
  file_too_large:        `A file larger than ${MAX_FILE_MB} MB was left out.`,
  file_type_unsupported: 'A file of a type websites cannot show was left out.',
  file_unavailable:      'A file could not be downloaded from Notion. It will be tried again at the next update.',
  blocks_unsupported:    'Some blocks your site cannot show (such as a linked database or a sub-page) were left out.',
};

/**
 * Replace every occurrence of a known secret value (a credential or database
 * ID) with a fixed placeholder. Applied to any text that reaches the run
 * summary's `detail` field — the only place free-form error text (which may
 * echo a Notion API error message containing a database ID) can end up.
 * Plain substring replacement, not a regex: secrets are opaque values, never
 * patterns, so there is nothing to escape.
 */
function redact(text, secrets = []) {
  let safe = String(text ?? '');
  for (const secret of secrets) {
    if (!secret) continue;
    safe = safe.split(secret).join('[redacted]');
  }
  return safe;
}

/** The section counts for one section label, or null if that section didn't run. */
function sectionCounts(sections, label) {
  const section = sections.find((s) => s.label === label);
  return section ? { ...section.stats } : null;
}

/**
 * Whether nav.yml/home.yml/_config.yml were rewritten anywhere in this run.
 * Only the pages section ever sets these (posts always reports all three
 * false), so aggregating with `.some()` across every section that ran — not
 * just pages — gives the same answer regardless of which sections ran, with
 * one place computing it instead of two definitions that could drift apart.
 */
function dataFilesChanged(sections) {
  return {
    nav:    sections.some((s) => s.navChanged),
    home:   sections.some((s) => s.homeChanged),
    config: sections.some((s) => s.configChanged),
  };
}

function cleanTitle(title) {
  return String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled';
}

/**
 * The rows the site owner needs to look at: the rows that failed, or, when
 * the guard held deletions back, the rows that would have been removed.
 * Titles of published (or formerly published) rows only — never drafts,
 * which the engine does not read.
 */
function affectedRows(sections) {
  const rows = [];
  for (const section of sections) {
    for (const row of section.failed ?? []) rows.push(row);
    for (const title of section.guard?.titles ?? []) {
      rows.push({ section: section.label, title, reason_code: 'would_remove' });
    }
  }
  return rows.slice(0, SUMMARY_ROWS_MAX).map((row) => ({
    section:     row.section,
    title:       cleanTitle(row.title),
    reason_code: row.reason_code,
    reason:      ROW_PROBLEM_TEXT[row.reason_code] ?? ROW_PROBLEM_TEXT.unexpected,
  }));
}

/** Published rows that went live with something left out (a too-large photo, an unsupported block). */
function skippedContent(sections) {
  return sections.flatMap((section) => section.skipped ?? []).slice(0, SUMMARY_ROWS_MAX).map((row) => ({
    section:     row.section,
    title:       cleanTitle(row.title),
    reason_code: row.reason_code,
    reason:      FILE_PROBLEM_TEXT[row.reason_code] ?? FILE_PROBLEM_TEXT.blocks_unsupported,
    count:       row.count,
  }));
}

/**
 * Build the schema_version 1 run summary object — the single source of truth
 * for both the `summary` Action output (compact JSON) and the
 * $GITHUB_STEP_SUMMARY Markdown rendering. Every terminal path in main()
 * calls this exactly once, so every path — success, no-op, a guarded
 * deletion, or an unexpected sync error — produces a parseable summary.
 *
 * `sections` (from run()) is only available on paths that ran to completion
 * (`synced` / `row_errors` / `bulk_delete_guard`); a run that aborted
 * (`sync_error`) passes no sections, so pages/posts/data_files are null — a
 * documented fallback, not a missing value. A run where only one of
 * pages/posts is configured also leaves the other `null` — `null` there
 * means "this section didn't run", not "this run failed" (see
 * docs/run-summary-schema.md).
 *
 * `affected` and `skipped` are optional and appear only when non-empty.
 *
 * `secrets` has no default on purpose: every call site must state its
 * redaction stance explicitly (`[]` when a path genuinely has no secrets
 * yet, e.g. before config resolves) rather than silently redacting nothing
 * because a future caller forgot the argument.
 */
function buildRunSummary({ result, code, changed, startedAt, finishedAt, sections = [], detail, secrets }) {
  if (!Array.isArray(secrets)) {
    throw new TypeError('buildRunSummary: secrets must be an array (pass [] when none apply yet)');
  }

  const affected = affectedRows(sections);
  const skipped  = skippedContent(sections);
  return {
    schema_version: RUN_SUMMARY_SCHEMA_VERSION,
    result,
    code,
    changed,
    started_at:  startedAt,
    finished_at: finishedAt,
    pages:       sectionCounts(sections, 'pages'),
    posts:       sectionCounts(sections, 'posts'),
    data_files:  sections.length === 0 ? null : dataFilesChanged(sections),
    detail:      redact(detail, secrets),
    ...(affected.length ? { affected } : {}),
    ...(skipped.length ? { skipped } : {}),
  };
}

const RESULT_ICON = { success: '✅', no_op: '⏭️', failure: '❌' };

/** Titles can hold Markdown and pipes; the step summary shows them as plain text. */
function mdText(text) {
  return String(text).replace(/[\\`*_[\]<>|]/g, '\\$&');
}

/** Render a run summary as Markdown for $GITHUB_STEP_SUMMARY — the same data as the JSON output, for a human reading the Actions run page. */
function renderStepSummaryMarkdown(summary) {
  const lines = [
    `### Notion → Jekyll sync — ${RESULT_ICON[summary.result] ?? ''} ${summary.result} (\`${summary.code}\`)`,
    '',
    `- **Changed:** ${summary.changed ? 'yes' : 'no'}`,
    `- **Started:** ${summary.started_at}`,
    `- **Finished:** ${summary.finished_at}`,
    '',
  ];

  if (summary.pages || summary.posts) {
    lines.push('| Section | Created | Updated | Renamed | Deleted | Unchanged | Errors |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const [label, counts] of [['Pages', summary.pages], ['Posts', summary.posts]]) {
      if (!counts) continue;
      lines.push(`| ${label} | ${counts.created} | ${counts.updated} | ${counts.renamed} | ${counts.deleted} | ${counts.unchanged} | ${counts.errors} |`);
    }
    lines.push('');
  }

  if (summary.data_files) {
    const updated = Object.entries({ 'nav.yml': summary.data_files.nav, 'home.yml': summary.data_files.home, '_config.yml': summary.data_files.config })
      .filter(([, changed]) => changed).map(([name]) => name);
    lines.push(`**Data files updated:** ${updated.length ? updated.join(', ') : 'none'}`);
    lines.push('');
  }

  if (summary.affected?.length) {
    lines.push(summary.code === 'bulk_delete_guard' ? '**Kept on the site, waiting for you to confirm:**' : '**Not published this time:**');
    for (const row of summary.affected) lines.push(`- ${mdText(row.title)} (${row.section}): ${row.reason}`);
    lines.push('');
  }

  if (summary.skipped?.length) {
    lines.push('**Published, with something left out:**');
    for (const row of summary.skipped) lines.push(`- ${mdText(row.title)} (${row.section}): ${row.reason}`);
    lines.push('');
  }

  if (summary.detail) lines.push(summary.detail);

  return `${lines.join('\n')}\n`;
}

/**
 * Echo the run's `changed` / `summary` result and, when GITHUB_OUTPUT is set
 * (the Action wrapper's sync step), append both as step outputs — `summary`
 * as compact JSON matching schema_version 1. When GITHUB_STEP_SUMMARY is set,
 * append the same data as Markdown. When RUN_SUMMARY_FILE is set, write the
 * same JSON to that file — the durable-artifact channel the calling workflow
 * uploads. All three are non-secret by construction: the `detail` field is
 * redacted before this function ever sees it.
 */
function writeActionOutputs(summary) {
  const json = JSON.stringify(summary);

  const runSummaryPath = process.env.RUN_SUMMARY_FILE;
  if (runSummaryPath) {
    try {
      fs.mkdirSync(path.dirname(runSummaryPath), { recursive: true });
      fs.writeFileSync(runSummaryPath, json + '\n');
    } catch (err) {
      // Contained on purpose: the file channel is observational, and a throw
      // here would reach main().catch and flip a green run red.
      console.warn(`   Warning: could not write the run summary file: ${err.message}`);
    }
  }

  console.log(`\n   result: ${summary.result} (${summary.code})`);
  console.log(`   changed: ${summary.changed}`);
  console.log(`   summary: ${json}`);

  const outPath = process.env.GITHUB_OUTPUT;
  if (outPath) {
    fs.appendFileSync(outPath, [
      `changed=${summary.changed}`,
      'summary<<NOTIONGIT_SYNC_SUMMARY_EOF',
      json,
      'NOTIONGIT_SYNC_SUMMARY_EOF',
      '',
    ].join('\n'));
  }

  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummaryPath) {
    fs.appendFileSync(stepSummaryPath, renderStepSummaryMarkdown(summary));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Sync every configured section. Each section stands on its own: a guard
 * that holds back posts deletions still lets the pages changes land, and the
 * other way round. Only a failed database query (or a filesystem error)
 * aborts the whole run.
 */
async function run(config) {
  initRun(config);
  console.log('Notion → Jekyll sync\n');

  const sections = [];
  const assets   = { downloaded: 0, removed: 0 };

  if (PAGES_DB_ID) {
    sections.push({ label: 'pages', ...(await syncPages(assets)) });
  } else {
    console.log('Skipping pages sync (NOTION_PAGES_DATABASE_ID not set).');
  }

  if (POSTS_DB_ID) {
    sections.push({ label: 'posts', ...(await syncPosts(assets)) });
  } else {
    console.log('Skipping posts sync (NOTION_POSTS_DATABASE_ID / NOTION_DATABASE_ID not set).');
  }

  assets.removed = pruneAssets();
  return { sections, assets };
}

async function main() {
  const startedAt = new Date().toISOString();

  let config;
  try {
    config = resolveConfig();
  } catch (err) {
    // Only a recognized missing-credentials shape is a no-op; anything else
    // resolveConfig might throw is a real defect and must still fail loudly.
    if (!(err instanceof ConfigError)) throw err;

    // No usable Notion credentials yet — most commonly a freshly generated
    // repository whose provisioning hasn't written secrets before its first
    // scheduled run. That is not a failure: exit 0 with an explicit no-op
    // rather than a red run, so scheduling ahead of provisioning is safe.
    console.log(`Notion sync skipped: ${err.message}`);
    console.log(
      'Configure NOTION_TOKEN and at least one of NOTION_PAGES_DATABASE_ID / ' +
      'NOTION_POSTS_DATABASE_ID (repository secrets/variables), then re-run this workflow.'
    );
    writeActionOutputs(buildRunSummary({
      result: 'no_op', code: 'missing_credentials', changed: false,
      startedAt, finishedAt: new Date().toISOString(),
      detail: `skipped: ${err.message}`,
      secrets: [], // nothing was ever configured — nothing to redact
    }));
    return;
  }

  // Only ever holds credential values — never printed, only used to redact
  // them out of error text that ends up in the run summary's `detail` field.
  const secrets = [config.notionToken, config.pagesDbId, config.postsDbId].filter(Boolean);

  let sections, assets;
  try {
    ({ sections, assets } = await run(config));
  } catch (err) {
    // A section threw mid-run (a database query failed, or a filesystem
    // error) — the run did not finish. Files already rewritten earlier in
    // this pass may remain on disk as uncommitted changes; the next
    // successful sync reconciles them, and `changed` stays false so the
    // consumer's commit step never pushes a half-finished pass. The run
    // summary below still reports the failure — every terminal path emits
    // one, even this one.
    console.error(`\nFatal: ${err.message}`);

    writeActionOutputs(buildRunSummary({
      result: 'failure',
      // `sync_error`, not `api_error`: run() can also throw on something
      // that isn't a Notion API call at all (e.g. an unwritable site
      // checkout) — this code names the generic case honestly rather than
      // overclaiming a specific cause.
      code: 'sync_error',
      changed: false,
      startedAt, finishedAt: new Date().toISOString(),
      secrets,
      // The wrapped error message, redacted for the database IDs a Notion
      // "not found" error commonly echoes back.
      detail: `sync failed: ${err.message}`,
    }));
    process.exit(1);
  }

  const totalErrors = sections.reduce((n, s) => n + s.stats.errors, 0);
  const guarded     = sections.find((s) => s.guard);

  console.log('\n─────────────────────────────────────────────────────────────');
  const { changed, summary: counts } = buildActionResult(sections, assets);

  // Guard detail is built from structured counts, never filenames or titles
  // (those go only in `affected`, which the owner's dashboard shows).
  const guardDetail = guarded
    ? `bulk-delete guard tripped for ${guarded.guard.label}: would delete ${guarded.guard.staleCount} of ${guarded.guard.trackedCount} tracked (${Math.round(guarded.guard.ratio * 100)}%); `
    : '';

  writeActionOutputs(buildRunSummary({
    result: guarded || totalErrors > 0 ? 'failure' : 'success',
    code:   guarded ? 'bulk_delete_guard' : totalErrors > 0 ? 'row_errors' : 'synced',
    changed,
    startedAt, finishedAt: new Date().toISOString(),
    sections, detail: `${guardDetail}${counts}`, secrets,
  }));

  if (guarded) {
    // Red on purpose: removing many rows at once needs the owner's yes. The
    // other changes of this run are already on disk and `changed` says so,
    // so the workflow still commits them.
    console.error('Sync finished, but some deletions were held back. See above for details.');
    process.exit(1);
  }
  if (totalErrors > 0) {
    // Green on purpose: the rest of the site updated, and a red run every
    // ten minutes would bury the one row that needs fixing in failure mail.
    console.log(`::warning::${totalErrors} row(s) could not be published this time. The rest of the site was updated.`);
    console.log(`Sync finished with ${totalErrors} row error(s). See above for details.`);
    return;
  }
  console.log('Sync complete.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nFatal: ${err.message}`);
    process.exit(1);
  });
}

// Exposed for tests: input mapping/normalization, output emission, result
// folding, and the pure Notion → Markdown/front-matter conversion functions —
// all pure or env-driven, none touching the network or the filesystem. The
// full sync (including pagination, which lives in the fetch helpers that
// close over the module-level Notion client) is exercised end-to-end by the
// harness in test/ against a local fake Notion API.
module.exports = {
  ConfigError,
  isTrue,
  resolveConfig,
  buildActionResult,
  RUN_SUMMARY_SCHEMA_VERSION,
  redact,
  buildRunSummary,
  renderStepSummaryMarkdown,
  writeActionOutputs,
  richTextToMarkdown,
  richTextToPlain,
  blockToMarkdown,
  blocksToMarkdown,
  protectLiquid,
  slugify,
  titleToSlug,
  resolveSlug,
  normalizePageType,
  typeToLayout,
  isFutureDate,
  extractPageMeta,
  extractPostMeta,
  buildPageFrontMatter,
  buildPostFrontMatter,
  postFilename,
};
