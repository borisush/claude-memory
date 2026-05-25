/**
 * memo-cross.js — Cross-Document Pattern Synthesis (MeMo-inspired)
 *
 * Finds "converging clues" and "parallel properties" across project memories
 * that may warrant promotion to a `global` entry.
 *
 * Two entries from DIFFERENT domains are considered candidates for the same
 * underlying pattern when BOTH:
 *   - Tag-set Jaccard similarity ≥ tagJaccardMin
 *   - Summary-token Jaccard similarity ≥ tokenJaccardMin
 *
 * Candidates are clustered transitively, then a cluster is reported when it
 * spans ≥ minDomains distinct domains.
 *
 * The library returns candidate clusters with source IDs and overlapping
 * vocabulary. The `/memory cross` slash command hands these to the model,
 * which decides whether to draft a global entry.
 *
 * Reference: MeMo paper, Step 5 of data synthesis pipeline.
 */

const { tokenize, listSemanticDomains, readSemanticMemory } = require('./memory');

const DEFAULTS = {
  tagJaccardMin: 0.34,
  tokenJaccardMin: 0.18,
  minDomains: 2,
  minClusterSize: 2,
  excludeDomains: new Set(['global']),
};

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function entrySignature(entry) {
  const tags = new Set((entry.tags || []).map(t => t.toLowerCase()));
  const summary = entry.summary || entry.content || '';
  const tokens = new Set(tokenize(summary));
  return { tags, tokens };
}

/**
 * Build union-find clusters of pairwise-related entries.
 */
function clusterEntries(annotated, opts) {
  const parent = annotated.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  for (let i = 0; i < annotated.length; i++) {
    for (let j = i + 1; j < annotated.length; j++) {
      const a = annotated[i], b = annotated[j];
      if (a.domain === b.domain) continue;
      const tagSim = jaccard(a.sig.tags, b.sig.tags);
      if (tagSim < opts.tagJaccardMin) continue;
      const tokSim = jaccard(a.sig.tokens, b.sig.tokens);
      if (tokSim < opts.tokenJaccardMin) continue;
      union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < annotated.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(annotated[i]);
  }
  return [...groups.values()];
}

function describeCluster(cluster) {
  const domains = new Set(cluster.map(c => c.domain));
  // Common tags across the whole cluster
  let commonTags = new Set(cluster[0].sig.tags);
  for (let i = 1; i < cluster.length; i++) {
    const next = new Set();
    for (const t of commonTags) if (cluster[i].sig.tags.has(t)) next.add(t);
    commonTags = next;
  }
  // Common content tokens — useful summary vocabulary for the model
  let commonTokens = new Set(cluster[0].sig.tokens);
  for (let i = 1; i < cluster.length; i++) {
    const next = new Set();
    for (const t of commonTokens) if (cluster[i].sig.tokens.has(t)) next.add(t);
    commonTokens = next;
  }
  // Cluster score: size × domain-spread × tag-overlap density
  const score =
    cluster.length *
    domains.size *
    (1 + commonTags.size * 0.5);

  return {
    domains: [...domains].sort(),
    domainCount: domains.size,
    entryCount: cluster.length,
    commonTags: [...commonTags].sort(),
    commonTokens: [...commonTokens].sort().slice(0, 12),
    score: Math.round(score * 100) / 100,
    entries: cluster.map(c => ({
      id: c.entry.id,
      domain: c.domain,
      salience: c.entry.salience,
      summary: c.entry.summary || c.entry.content || '',
    })),
  };
}

/**
 * Scan all (or the given) domains, return cross-domain candidate clusters.
 *
 * @param {object} [options]
 * @param {object} [options.entriesByDomain] - {domain: [entries]}. If omitted, reads from disk.
 * @param {number} [options.tagJaccardMin]
 * @param {number} [options.tokenJaccardMin]
 * @param {number} [options.minDomains]
 * @param {number} [options.minClusterSize]
 * @param {Set<string>} [options.excludeDomains]
 * @returns {object[]} clusters sorted by descending score
 */
function findCrossDomainCandidates(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  opts.excludeDomains = options.excludeDomains || DEFAULTS.excludeDomains;

  let entriesByDomain = options.entriesByDomain;
  if (!entriesByDomain) {
    entriesByDomain = {};
    for (const domain of listSemanticDomains()) {
      if (opts.excludeDomains.has(domain)) continue;
      const data = readSemanticMemory(domain);
      if (data && Array.isArray(data.entries)) {
        entriesByDomain[domain] = data.entries;
      }
    }
  }

  const annotated = [];
  for (const [domain, entries] of Object.entries(entriesByDomain)) {
    if (opts.excludeDomains.has(domain)) continue;
    for (const entry of entries) {
      const sig = entrySignature(entry);
      if (sig.tags.size === 0 && sig.tokens.size === 0) continue;
      annotated.push({ entry, domain, sig });
    }
  }

  const clusters = clusterEntries(annotated, opts);
  const reported = clusters
    .filter(c => c.length >= opts.minClusterSize)
    .map(describeCluster)
    .filter(d => d.domainCount >= opts.minDomains)
    .sort((a, b) => b.score - a.score);

  return reported;
}

module.exports = {
  findCrossDomainCandidates,
  // Exposed for testing / advanced callers
  jaccard,
  entrySignature,
  clusterEntries,
  describeCluster,
  DEFAULTS,
};
