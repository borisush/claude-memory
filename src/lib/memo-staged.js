/**
 * memo-staged.js — Staged Retrieval with Ambiguity Detection (MeMo-inspired)
 *
 * MeMo's 3-stage protocol:
 *   1. Grounding         — decompose query, get atomic candidates
 *   2. Entity Identification — when multiple candidates plausibly match,
 *                          narrow by entity instead of dumping everything
 *   3. Answer Seeking    — query confidently within the narrowed scope
 *
 * The library can't decide WHICH question to ask — that's the model's job.
 * What it CAN do: detect when retrieval is ambiguous, surface the competing
 * entity groups, and tell the model what to disambiguate on.
 *
 * Ambiguity signal: candidates span ≥ minDistinctGroups distinct entity groups
 * AND the top-1/top-N score ratio is below confidenceMin (no clear winner).
 *
 * Reference: MeMo paper, "Inference-Time Multi-Turn Protocol".
 */

const { hybridSearch } = require('./memory');
const { extractEntities } = require('./memo-entities');

const DEFAULTS = {
  topK: 12,
  // A group only "competes" if it has at least this many candidates. Singleton
  // groups are just specificity (one entry happens to mention a rare entity),
  // not genuine ambiguity between competing answers.
  minGroupSize: 2,
  // Ambiguous when ≥ minCompetingGroups groups each have ≥ minGroupSize members
  // AND the top group's score isn't a clear winner over the runner-up group.
  minCompetingGroups: 2,
  // Top group wins when its totalScore ≥ dominanceRatio × runner-up group's totalScore.
  dominanceRatio: 1.5,
  // Entity kinds that meaningfully discriminate between memories.
  // 'ident' and 'constant' tend to be noisy; commands/paths/URLs are stable.
  groupingKinds: new Set(['command', 'path', 'url', 'slash', 'code']),
};

/**
 * Pick a candidate's "primary entity" — the most distinctive entity it
 * contains, scored by inverse document frequency within the candidate set.
 *
 * Rare entities are more discriminative; an entity appearing in every
 * candidate is useless for grouping (it's the query topic itself).
 */
function pickPrimaryEntities(candidates, opts) {
  // First pass: count entity occurrences across the candidate set.
  const docFreq = new Map();
  const perCandidateEntities = candidates.map(c => {
    const text = `${c.entry.summary || ''}\n${c.entry.content || ''}`;
    const entities = extractEntities(text).filter(e => opts.groupingKinds.has(e.kind));
    for (const e of entities) {
      docFreq.set(e.key, (docFreq.get(e.key) || 0) + 1);
    }
    return entities;
  });

  const N = candidates.length;
  // Second pass: each candidate gets the entity with the highest IDF.
  return candidates.map((c, i) => {
    const entities = perCandidateEntities[i];
    if (entities.length === 0) return { ...c, primaryEntity: null };
    let best = null;
    let bestScore = -Infinity;
    for (const e of entities) {
      // Skip entities present in EVERY candidate — they don't discriminate
      if (docFreq.get(e.key) === N) continue;
      const idf = Math.log(N / docFreq.get(e.key));
      if (idf > bestScore) {
        bestScore = idf;
        best = e;
      }
    }
    return { ...c, primaryEntity: best };
  });
}

/**
 * Group candidates by their primary entity. Candidates with no primary
 * entity fall into a single "ungrouped" bucket.
 */
function groupByPrimaryEntity(annotated) {
  const groups = new Map();
  for (const c of annotated) {
    const key = c.primaryEntity ? c.primaryEntity.key : '__ungrouped__';
    if (!groups.has(key)) {
      groups.set(key, {
        entityKey: key,
        entityRaw: c.primaryEntity ? c.primaryEntity.raw : null,
        entityKind: c.primaryEntity ? c.primaryEntity.kind : null,
        candidates: [],
        totalScore: 0,
      });
    }
    const g = groups.get(key);
    g.candidates.push(c);
    g.totalScore += c.score;
  }
  return [...groups.values()].sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Staged retrieval with ambiguity detection.
 *
 * @param {object[]} entries - aggregated entries across domains (tag each with _domain)
 * @param {string} query
 * @param {object} [options]
 * @returns {{
 *   status: 'confident' | 'ambiguous' | 'empty',
 *   topGroup?: object,            // present when 'confident'
 *   groups?: object[],            // present when 'ambiguous' — competing entity groups
 *   suggestion?: string,          // human-readable suggested follow-up for ambiguous
 *   metrics: { topScore, runnerUp, confidence, groupCount, candidateCount }
 * }}
 */
function stagedRetrieve(entries, query, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  opts.groupingKinds = options.groupingKinds || DEFAULTS.groupingKinds;

  const candidates = hybridSearch(entries, query, { topK: opts.topK });
  if (candidates.length === 0) {
    return {
      status: 'empty',
      metrics: { topScore: 0, runnerUp: 0, confidence: 0, groupCount: 0, candidateCount: 0 },
    };
  }

  const annotated = pickPrimaryEntities(candidates, opts);
  const allGroups = groupByPrimaryEntity(annotated);

  // Only groups with ≥ minGroupSize members can "compete" — singletons are
  // just specificity, not ambiguity. Filter before counting and ranking.
  const competing = allGroups
    .filter(g => g.entityKey !== '__ungrouped__' && g.candidates.length >= opts.minGroupSize);

  const topScore = candidates[0].score;
  const runnerUp = candidates[1] ? candidates[1].score : 0;
  // Group-level dominance: top group's totalScore relative to second's
  const topGroupScore = competing[0] ? competing[0].totalScore : 0;
  const secondGroupScore = competing[1] ? competing[1].totalScore : 0;
  const groupDominance = secondGroupScore > 0
    ? topGroupScore / secondGroupScore
    : Infinity;

  const metrics = {
    topScore: Math.round(topScore * 1000) / 1000,
    runnerUp: Math.round(runnerUp * 1000) / 1000,
    groupDominance: Number.isFinite(groupDominance)
      ? Math.round(groupDominance * 100) / 100
      : null,
    competingGroupCount: competing.length,
    totalGroupCount: allGroups.length,
    candidateCount: candidates.length,
  };

  // Confident when:
  //   - fewer than minCompetingGroups multi-member groups, OR
  //   - top group dominates the runner-up group by dominanceRatio
  const isConfident =
    competing.length < opts.minCompetingGroups ||
    groupDominance >= opts.dominanceRatio;

  if (isConfident) {
    // Prefer the top competing group if it exists; otherwise fall back to the
    // raw top-ranked candidate (wrapped as a synthetic single-candidate group).
    const topGroup = competing[0] || {
      entityKey: annotated[0].primaryEntity ? annotated[0].primaryEntity.key : '__ungrouped__',
      entityRaw: annotated[0].primaryEntity ? annotated[0].primaryEntity.raw : null,
      entityKind: annotated[0].primaryEntity ? annotated[0].primaryEntity.kind : null,
      candidates: [annotated[0]],
      totalScore: annotated[0].score,
    };
    return { status: 'confident', topGroup, metrics };
  }

  // Ambiguous: show the competing multi-member groups
  const named = competing.slice(0, 4);
  const suggestion = `Which one — ${named.map(g => `\`${g.entityRaw}\``).join(' / ')}?`;

  return {
    status: 'ambiguous',
    groups: named,
    suggestion,
    metrics,
  };
}

module.exports = {
  stagedRetrieve,
  pickPrimaryEntities,
  groupByPrimaryEntity,
  DEFAULTS,
};
