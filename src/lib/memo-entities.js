/**
 * memo-entities.js — Entity-Surfacing Reverse Index (MeMo-inspired)
 *
 * For each semantic entry, extract the things that "matter" — commands,
 * file paths, URLs, slash commands, service names, identifiers — and build
 * a reverse index { entityKey → [{entryId, domain, kind}] } so that questions
 * like "which memories mention `flutter build apk --release`?" become O(1).
 *
 * Reference: MeMo paper, Step 4 of data synthesis pipeline ("entity-surfacing
 * QA pairs where questions encode entity attributes").
 *
 * ARCHITECTURE
 *
 *   extractEntities(text)       → low-level. Run extractors over a string.
 *   buildEntityIndex(byDomain)  → full rebuild. Reads cold-storage bodies too.
 *   addEntryToIndex(entry, dom) → incremental. Use during /memory consolidate.
 *   lookupEntity(query)         → query-time. Kind-weighted ranking.
 *
 * CLI
 *
 *   node memo-entities.js rebuild
 *   node memo-entities.js lookup <query>
 *   node memo-entities.js stats
 *
 * EXTENDING
 *
 *   To add a domain-specific extractor: write a function taking (text) and
 *   returning [{kind, key, raw}, ...], then append it to BUILTIN_EXTRACTORS.
 *   See SERVICE_ALLOWLIST below to add vendor names worth surfacing.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ENTITY_INDEX_FILENAME = 'entity-index.json';

function getEntityIndexPath() {
  return path.join(os.homedir(), '.claude', 'memory', ENTITY_INDEX_FILENAME);
}

// ─── Service-name allowlist ───────────────────────────────────
//
// Plain English vendor/tool words that are too short or unstructured to be
// caught by regex extractors but carry strong semantic signal. Add words you
// reach for in queries — these become first-class entities.

const SERVICE_ALLOWLIST = new Set([
  // Cloud / infra
  'cloudflare', 'vercel', 'neon', 'supabase', 'fly.io', 'railway', 'render',
  // Auth / payments
  'stripe', 'clerk', 'auth0', 'paypal',
  // CMS / data
  'sanity', 'firebase', 'firestore', 'drift', 'sqlite', 'sqlcipher',
  // AI
  'claude', 'anthropic', 'openai', 'grok', 'xai', 'gemini', 'lyria',
  'musicgen', 'suno', 'replicate', 'apiframe',
  // Web frameworks / runtimes
  'nextjs', 'next.js', 'react', 'astro', 'svelte', 'remix', 'flutter',
  'gradio', 'riverpod',
  // Mobile / devices
  'samsung', 'android', 'jetpack', 'kotlin', 'gradle', 'sdk', 'adb',
  // Marketing / forms
  'calendly', 'jotform', 'eventbrite', 'mailchimp',
  // Dev tools
  'sentry', 'playwright', 'remotion',
]);

// ─── Constant noise filter ────────────────────────────────────
//
// ALL_CAPS words that match the constant pattern but are just common English
// nouns / file-type acronyms — index them, but later downweight them.

const NOISY_CONSTANTS = new Set([
  'JSON', 'HTML', 'CSS', 'PDF', 'PNG', 'JPG', 'JPEG', 'GIF', 'SVG',
  'CRITICAL', 'TODO', 'NOTE', 'FIXME', 'BUG', 'HACK', 'XXX',
  'API', 'URL', 'UI', 'UX', 'CLI', 'IDE', 'OS',
]);

// ─── Extractors ───────────────────────────────────────────────
//
// Each extractor returns { kind, key, raw } for every match.
//   kind: stable category label used for filtering / display / ranking
//   key:  normalized lookup key (lowercased, trimmed)
//   raw:  the original substring as it appeared in the entry — for display
//
// Implementation note: extractors use String.matchAll over RegExp.prototype.exec
// to keep iteration stateless and play well with stricter linters / security hooks.

function ex_backtick(text) {
  const out = [];
  for (const m of text.matchAll(/`([^`\n]{2,120})`/g)) {
    const raw = m[1].trim();
    if (!raw) continue;
    const kind = /^[\/\\.~]|\\\\|[A-Z]:\\|\.(js|ts|md|json|dart|py|yaml|yml|astro|tsx|jsx)$/i.test(raw)
      ? 'path'
      : /\s/.test(raw)
        ? 'command'
        : 'code';
    out.push({ kind, key: raw.toLowerCase(), raw });
  }
  return out;
}

function ex_path(text) {
  const out = [];
  const re = /(?:^|[\s(,])([A-Za-z]:[\\/][\w.\-+/\\]{3,}|~?\/[\w.\-+/]{3,}|\.\/?[\w.\-+/]{3,})/g;
  for (const m of text.matchAll(re)) {
    const raw = m[1].replace(/[.,)]+$/, '');
    if (raw.length < 4) continue;
    out.push({ kind: 'path', key: raw.toLowerCase(), raw });
  }
  return out;
}

function ex_filename(text) {
  // Bare filenames with a recognized code extension. The path extractor
  // requires a separator prefix; this catches `memory.js`, `main.dart` etc.
  const out = [];
  const re = /\b([\w\-]+\.(?:js|ts|tsx|jsx|md|json|dart|py|yaml|yml|astro|kt|swift|gradle|sql|sh|toml|env))\b/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[1];
    out.push({ kind: 'filename', key: raw.toLowerCase(), raw });
  }
  return out;
}

function ex_url(text) {
  const out = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)<>"'`]+/g)) {
    const raw = m[0].replace(/[.,;:!?)`]+$/, '');
    out.push({ kind: 'url', key: raw.toLowerCase(), raw });
  }
  return out;
}

function ex_slash_command(text) {
  const out = [];
  for (const m of text.matchAll(/(?:^|\s)(\/[a-z][a-z0-9_-]{1,40})\b/gi)) {
    out.push({ kind: 'slash', key: m[1].toLowerCase(), raw: m[1] });
  }
  return out;
}

function ex_camel_or_snake_ident(text) {
  // camelCase, PascalCase, or snake_case identifiers with ≥ 2 segments.
  // Single-word identifiers are too noisy.
  const out = [];
  const re = /\b([a-z]+(?:[A-Z][a-z]+){1,}|[A-Z][a-z]+(?:[A-Z][a-z]+){1,}|[a-z]+(?:_[a-z]+){1,})\b/g;
  for (const m of text.matchAll(re)) {
    const raw = m[1];
    if (raw.length < 4 || raw.length > 60) continue;
    out.push({ kind: 'ident', key: raw.toLowerCase(), raw });
  }
  return out;
}

function ex_constant(text) {
  const out = [];
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]{3,40})\b/g)) {
    // Still index noisy constants, but tag them so the ranker can downweight.
    const kind = NOISY_CONSTANTS.has(m[1]) ? 'constant_noisy' : 'constant';
    out.push({ kind, key: m[1].toLowerCase(), raw: m[1] });
  }
  return out;
}

function ex_service_name(text) {
  const out = [];
  // Word-boundary match against the allowlist, case-insensitive.
  // For services containing punctuation (Next.js, fly.io), also emit an
  // alphanumeric alias so queries like "nextjs" or "flyio" still hit.
  for (const m of text.matchAll(/\b([A-Za-z][\w.+-]{2,30})\b/g)) {
    const lower = m[1].toLowerCase();
    if (!SERVICE_ALLOWLIST.has(lower)) continue;
    out.push({ kind: 'service', key: lower, raw: m[1] });
    const alnum = lower.replace(/[^a-z0-9]/g, '');
    if (alnum && alnum !== lower && alnum.length >= 3) {
      out.push({ kind: 'service', key: alnum, raw: m[1] });
    }
  }
  return out;
}

function ex_git_sha(text) {
  const out = [];
  // Git SHA: 7-40 hex chars. Require word boundary AND that it's not a
  // longer alphanumeric token (e.g. a base64 chunk).
  for (const m of text.matchAll(/(?<![A-Za-z0-9])([0-9a-f]{7,40})(?![A-Za-z0-9])/g)) {
    out.push({ kind: 'git_sha', key: m[1].toLowerCase(), raw: m[1] });
  }
  return out;
}

function ex_stripe_id(text) {
  const out = [];
  // Stripe object IDs: <prefix>_<base62>. Common prefixes: price, prod,
  // cus, sub, pi, ch, sk_test, sk_live, pk_test, pk_live, whsec.
  const re = /\b((?:price|prod|cus|sub|pi|ch|whsec|sk_test|sk_live|pk_test|pk_live)_[A-Za-z0-9]{8,})\b/g;
  for (const m of text.matchAll(re)) {
    out.push({ kind: 'stripe_id', key: m[1].toLowerCase(), raw: m[1] });
  }
  return out;
}

function ex_device_serial(text) {
  const out = [];
  // Samsung-style ADB device serial: letter-digit-2letters-4digits-letter-digit-letter
  // e.g. R5GL1127D9J. Loose enough to catch variants, tight enough to skip noise.
  for (const m of text.matchAll(/\b([A-Z][0-9][A-Z]{2}[0-9]{4}[A-Z][0-9][A-Z])\b/g)) {
    out.push({ kind: 'device_serial', key: m[1].toLowerCase(), raw: m[1] });
  }
  return out;
}

function ex_calendly(text) {
  const out = [];
  for (const m of text.matchAll(/calendly\.com\/([\w./-]+)/gi)) {
    const raw = `calendly.com/${m[1]}`;
    out.push({ kind: 'calendly', key: raw.toLowerCase(), raw });
  }
  return out;
}

const BUILTIN_EXTRACTORS = [
  ex_backtick,
  ex_path,
  ex_filename,
  ex_url,
  ex_slash_command,
  ex_camel_or_snake_ident,
  ex_constant,
  ex_service_name,
  ex_git_sha,
  ex_stripe_id,
  ex_device_serial,
  ex_calendly,
];

/**
 * Run every extractor on a text blob, deduplicate within a single text by key.
 * Later extractors with the same key are ignored — the first match wins, so
 * order in BUILTIN_EXTRACTORS encodes per-text precedence.
 */
function extractEntities(text, extractors = BUILTIN_EXTRACTORS) {
  if (!text) return [];
  const seen = new Map();
  for (const fn of extractors) {
    for (const e of fn(text)) {
      if (!seen.has(e.key)) seen.set(e.key, e);
    }
  }
  return [...seen.values()];
}

// ─── Cold-storage body loader ─────────────────────────────────
//
// Entries with bodyRef carry their full content in semantic/raw/<domain>/<id>.md.
// The summary alone misses most URLs, command details, and incident context.
// Reading the body during index-build dramatically expands coverage.

function loadColdBody(domain, entryId) {
  const coldPath = path.join(
    os.homedir(), '.claude', 'memory', 'semantic', 'raw', domain, `${entryId}.md`
  );
  if (!fs.existsSync(coldPath)) return null;
  try {
    return fs.readFileSync(coldPath, 'utf8');
  } catch {
    return null;
  }
}

function entryFullText(entry, domain) {
  const parts = [entry.summary || '', entry.content || ''];
  if (entry.bodyRef) {
    const cold = loadColdBody(domain, entry.id);
    if (cold) parts.push(cold);
  }
  return parts.filter(Boolean).join('\n');
}

// ─── Index build / persistence ────────────────────────────────

function newIndex() {
  return {
    version: '1.1',
    builtAt: new Date().toISOString(),
    stats: { entryCount: 0, entityCount: 0, uniqueKeys: 0 },
    entities: {},
  };
}

function recomputeStats(index) {
  let entityCount = 0;
  const entryIds = new Set();
  for (const info of Object.values(index.entities)) {
    entityCount += info.occurrences.length;
    for (const o of info.occurrences) entryIds.add(`${o.domain}/${o.entryId}`);
  }
  index.stats = {
    entryCount: entryIds.size,
    entityCount,
    uniqueKeys: Object.keys(index.entities).length,
  };
  return index;
}

/**
 * Full rebuild from { domain → [entries] }. Reads cold-storage bodies when
 * present, so the index reflects the FULL memory content, not just summaries.
 */
function buildEntityIndex(entriesByDomain, extractors = BUILTIN_EXTRACTORS) {
  const index = newIndex();

  for (const [domain, entries] of Object.entries(entriesByDomain)) {
    for (const entry of entries) {
      const text = entryFullText(entry, domain);
      const found = extractEntities(text, extractors);
      for (const e of found) {
        if (!index.entities[e.key]) {
          index.entities[e.key] = { raw: e.raw, kind: e.kind, occurrences: [] };
        }
        index.entities[e.key].occurrences.push({ entryId: entry.id, domain });
      }
    }
  }

  return recomputeStats(index);
}

/**
 * Incremental update — add (or refresh) one entry's entities. Use during
 * /memory consolidate so a full rebuild isn't needed after every change.
 *
 * If the entry already has occurrences in the index, they are removed first
 * (so renames / summary edits don't accumulate stale references).
 */
function addEntryToIndex(entry, domain, index, extractors = BUILTIN_EXTRACTORS) {
  // Strip any existing references to this entry across all entity keys
  const emptiedKeys = [];
  for (const [key, info] of Object.entries(index.entities)) {
    const before = info.occurrences.length;
    info.occurrences = info.occurrences.filter(
      o => !(o.entryId === entry.id && o.domain === domain)
    );
    if (info.occurrences.length === 0 && before > 0) emptiedKeys.push(key);
  }
  for (const key of emptiedKeys) delete index.entities[key];

  // Add fresh references
  const text = entryFullText(entry, domain);
  for (const e of extractEntities(text, extractors)) {
    if (!index.entities[e.key]) {
      index.entities[e.key] = { raw: e.raw, kind: e.kind, occurrences: [] };
    }
    index.entities[e.key].occurrences.push({ entryId: entry.id, domain });
  }

  index.builtAt = new Date().toISOString();
  return recomputeStats(index);
}

function writeEntityIndex(index, indexPath = getEntityIndexPath()) {
  // Atomic write — write to .tmp then rename so a crash mid-write doesn't
  // corrupt the existing index.
  const tmp = indexPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, indexPath);
}

function readEntityIndex(indexPath = getEntityIndexPath()) {
  if (!fs.existsSync(indexPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Lookup with kind-weighted ranking ────────────────────────
//
// Higher weight = preferred when multiple kinds tie on match mode.
// Rationale: a user querying "flutter" usually wants an action or path,
// not a class name. Actions > locations > services > identifiers.

const KIND_WEIGHT = {
  command: 10,
  slash: 9,
  stripe_id: 8,
  calendly: 8,
  device_serial: 8,
  url: 7,
  path: 7,
  filename: 6,
  service: 5,
  code: 4,
  git_sha: 4,
  ident: 2,
  constant: 1,
  constant_noisy: 0.3,
};

const MATCH_MODE_WEIGHT = { exact: 100, prefix: 10, substring: 1 };

function scoreMatch(info, matchMode) {
  const kindW = KIND_WEIGHT[info.kind] || 1;
  const modeW = MATCH_MODE_WEIGHT[matchMode] || 1;
  // log(1 + N) tames extreme occurrence counts (a 100× entity isn't 10× better
  // than a 10× entity — diminishing returns).
  const occW = Math.log(1 + info.occurrences.length);
  return kindW * modeW * (1 + occW);
}

/**
 * Look up a query against the entity index. Returns matches ranked by
 * kind weight × match-mode weight × log(1 + occurrences).
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {object} [opts.index] - preloaded index; if omitted, reads from disk
 * @param {number} [opts.maxResults=20]
 * @param {Set<string>} [opts.onlyKinds] - restrict to these kinds
 * @returns {Array<{key, raw, kind, occurrences, matchMode, score}>}
 */
function lookupEntity(query, opts = {}) {
  const index = opts.index || readEntityIndex();
  if (!index) return [];
  const maxResults = opts.maxResults || 20;
  const onlyKinds = opts.onlyKinds || null;
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const hits = [];
  for (const [key, info] of Object.entries(index.entities)) {
    if (onlyKinds && !onlyKinds.has(info.kind)) continue;

    let matchMode = null;
    if (key === q) matchMode = 'exact';
    else if (q.length >= 3 && key.startsWith(q)) matchMode = 'prefix';
    else if (q.length >= 3 && key.includes(q)) matchMode = 'substring';
    else continue;

    hits.push({
      key,
      ...info,
      matchMode,
      score: scoreMatch(info, matchMode),
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, maxResults);
}

// ─── CLI ───────────────────────────────────────────────────────
//
// Direct shell usage: node memo-entities.js <command> [args]

function cliRebuild() {
  // Lazy-require memory.js to avoid a load cycle at module-load time
  const { listSemanticDomains, readSemanticMemory } = require('./memory');
  const byDomain = {};
  const skipped = [];
  for (const domain of listSemanticDomains()) {
    const data = readSemanticMemory(domain);
    if (data && Array.isArray(data.entries)) {
      byDomain[domain] = data.entries;
    } else {
      // readSemanticMemory returns null on parse error or missing file.
      // Surface this loudly — silent skips have masked real data corruption.
      skipped.push(domain);
    }
  }
  if (skipped.length > 0) {
    console.warn(`WARNING: skipped ${skipped.length} domain(s) that failed to parse:`);
    for (const d of skipped) console.warn(`  - ${d}.json (check with: node -e \"JSON.parse(require('fs').readFileSync('${d}.json'))\")`);
  }
  const index = buildEntityIndex(byDomain);
  writeEntityIndex(index);
  console.log(`Rebuilt entity-index.json`);
  console.log(`  domains: ${Object.keys(byDomain).length} loaded${skipped.length ? `, ${skipped.length} skipped` : ''}`);
  console.log(`  entries: ${index.stats.entryCount}`);
  console.log(`  occurrences: ${index.stats.entityCount}`);
  console.log(`  unique keys: ${index.stats.uniqueKeys}`);
}

function cliLookup(query) {
  if (!query) {
    console.error('Usage: node memo-entities.js lookup <query>');
    process.exit(2);
  }
  const hits = lookupEntity(query, { maxResults: 15 });
  if (hits.length === 0) {
    console.log(`No matches for "${query}"`);
    return;
  }
  console.log(`Matches for "${query}":`);
  for (const h of hits) {
    const domains = [...new Set(h.occurrences.map(o => o.domain))].join(', ');
    console.log(
      `  [${h.matchMode}] [${h.kind}] \`${h.raw}\` ` +
      `(${h.occurrences.length}× in ${domains}) score=${h.score.toFixed(2)}`
    );
  }
}

function cliStats() {
  const index = readEntityIndex();
  if (!index) { console.log('No entity-index.json yet. Run `rebuild`.'); return; }
  console.log(`Built: ${index.builtAt}`);
  console.log(`Stats: ${JSON.stringify(index.stats)}`);
  const byKind = {};
  for (const info of Object.values(index.entities)) {
    byKind[info.kind] = (byKind[info.kind] || 0) + 1;
  }
  console.log(`By kind:`);
  for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${n}`);
  }
}

function cliValidate() {
  // Walk every semantic JSON file, every cold-storage body, every episode
  // file. Report parse failures + missing cross-references. Exit non-zero
  // on any problem so this can be cron'd as a nightly sanity check.
  const semanticDir = path.join(os.homedir(), '.claude', 'memory', 'semantic');
  const coldDir = path.join(semanticDir, 'raw');
  const episodesDir = path.join(os.homedir(), '.claude', 'memory', 'episodes');

  const problems = [];
  const checkParse = (file) => {
    try { JSON.parse(fs.readFileSync(file, 'utf8')); return null; }
    catch (e) { return e.message.split('\n')[0]; }
  };

  // Semantic files
  let okSemantic = 0;
  if (fs.existsSync(semanticDir)) {
    for (const f of fs.readdirSync(semanticDir).filter(n => n.endsWith('.json'))) {
      const err = checkParse(path.join(semanticDir, f));
      if (err) problems.push(`semantic/${f}: ${err}`);
      else okSemantic++;
    }
  }

  // Episode files
  let okEpisodes = 0;
  if (fs.existsSync(episodesDir)) {
    for (const f of fs.readdirSync(episodesDir).filter(n => n.endsWith('.json'))) {
      const err = checkParse(path.join(episodesDir, f));
      if (err) problems.push(`episodes/${f}: ${err}`);
      else okEpisodes++;
    }
  }

  // Cross-ref check: every entry with bodyRef must point at a file that
  // actually exists. Older entries use bodyRef paths that don't match the
  // canonical `raw/<domain>/<id>.md` convention (they're named after the
  // content topic), so we resolve bodyRef literally — relative to the memory
  // root — instead of synthesizing a path from entry.id.
  let dangling = 0;
  const memRoot = path.join(os.homedir(), '.claude', 'memory');
  if (fs.existsSync(semanticDir)) {
    for (const f of fs.readdirSync(semanticDir).filter(n => n.endsWith('.json'))) {
      let data;
      try { data = JSON.parse(fs.readFileSync(path.join(semanticDir, f), 'utf8')); }
      catch { continue; }
      const domain = f.replace(/\.json$/, '');
      for (const entry of (data.entries || [])) {
        if (!entry.bodyRef) continue;
        // Try bodyRef both as relative-to-semantic-dir (canonical) and
        // relative-to-memory-root (legacy). One should resolve.
        const candidates = [
          path.join(semanticDir, entry.bodyRef),
          path.join(memRoot, entry.bodyRef),
          path.join(coldDir, domain, `${entry.id}.md`),
        ];
        if (!candidates.some(p => fs.existsSync(p))) {
          problems.push(`dangling bodyRef: ${domain}/${entry.id} → ${entry.bodyRef} (file missing)`);
          dangling++;
        }
      }
    }
  }

  console.log(`Semantic files OK: ${okSemantic}`);
  console.log(`Episode files OK:  ${okEpisodes}`);
  console.log(`Dangling bodyRefs: ${dangling}`);
  console.log(`Problems:          ${problems.length}`);
  if (problems.length > 0) {
    console.log('\nDetails:');
    for (const p of problems) console.log('  - ' + p);
    process.exit(1);
  }
  console.log('\nAll clean.');
}

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'rebuild':  cliRebuild(); break;
    case 'lookup':   cliLookup(rest.join(' ')); break;
    case 'stats':    cliStats(); break;
    case 'validate': cliValidate(); break;
    default:
      console.error('Usage: node memo-entities.js <rebuild|lookup <query>|stats|validate>');
      process.exit(2);
  }
}

module.exports = {
  // Core
  extractEntities,
  BUILTIN_EXTRACTORS,
  // Lifecycle
  buildEntityIndex,
  addEntryToIndex,
  writeEntityIndex,
  readEntityIndex,
  getEntityIndexPath,
  // Query
  lookupEntity,
  // Config (exposed so callers can extend)
  SERVICE_ALLOWLIST,
  NOISY_CONSTANTS,
  KIND_WEIGHT,
  MATCH_MODE_WEIGHT,
  // Individual extractors
  ex_backtick,
  ex_path,
  ex_filename,
  ex_url,
  ex_slash_command,
  ex_camel_or_snake_ident,
  ex_constant,
  ex_service_name,
  ex_git_sha,
  ex_stripe_id,
  ex_device_serial,
  ex_calendly,
  // Internals (exposed for testing)
  loadColdBody,
  entryFullText,
  scoreMatch,
};
