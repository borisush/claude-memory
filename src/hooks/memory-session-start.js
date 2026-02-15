#!/usr/bin/env node
/**
 * Memory System - Session Start Hook
 *
 * Loads relevant memories for the current session based on project detection.
 * Runs decay calculation (daily) and evaluates prospective triggers.
 *
 * Output:
 *   stderr → Human-readable summary (shown to user)
 *   stdout → JSON context (returned to Claude for context)
 */

const {
  readIndex,
  writeIndex,
  readSemanticMemory,
  writeSemanticMemory,
  readEpisodes,
  readDecayConfig,
  readProspective,
  writeProspective,
  listSemanticDomains,
  findDomainForProject,
  sortByRelevance,
  filterBySalience,
  applyDecay,
  evaluateTriggers,
  ensureMemoryDirs
} = require('../lib/memory');
const { getProjectName, getGitRepoName, log } = require('../lib/utils');

const MAX_ENTRIES_IN_CONTEXT = 25;
const GLOBAL_SALIENCE_THRESHOLD = 0.3;

async function main() {
  ensureMemoryDirs();

  const index = readIndex();
  if (!index) {
    log('[Memory] No memory index found — memory system not initialized');
    process.exit(0);
  }

  // ─── Detect Project ───────────────────────────────────────
  const projectName = getGitRepoName() || getProjectName() || null;
  const domain = findDomainForProject(projectName);

  // ─── Run Decay (once per 24 hours) ────────────────────────
  const now = new Date();
  const lastDecay = new Date(index.lastDecayRun || 0);
  const hoursSinceDecay = (now.getTime() - lastDecay.getTime()) / (1000 * 60 * 60);

  if (hoursSinceDecay >= 24) {
    const config = readDecayConfig();
    const domains = listSemanticDomains();
    let totalDecayed = 0;
    let totalWarned = 0;
    let totalPruned = 0;

    for (const d of domains) {
      const data = readSemanticMemory(d);
      if (!data || !data.entries) continue;

      const result = applyDecay(data, config);
      if (result.decayed > 0 || result.pruned > 0) {
        writeSemanticMemory(d, result.updated);
        totalDecayed += result.decayed;
        totalWarned += result.warned;
        totalPruned += result.pruned;
      }
    }

    index.lastDecayRun = now.toISOString();

    if (totalDecayed > 0) {
      log(`[Memory] Decay applied: ${totalDecayed} entries updated, ${totalWarned} near threshold, ${totalPruned} archived`);
    }
  }

  // ─── Load Domain Memories ─────────────────────────────────
  let domainEntries = [];
  let domainName = 'none';

  if (domain) {
    domainName = domain;
    const data = readSemanticMemory(domain);
    if (data && data.entries) {
      domainEntries = sortByRelevance(data.entries);
    }
  }

  // ─── Load Global Memories ─────────────────────────────────
  const globalData = readSemanticMemory('global');
  let globalEntries = [];
  if (globalData && globalData.entries) {
    globalEntries = sortByRelevance(filterBySalience(globalData.entries, GLOBAL_SALIENCE_THRESHOLD));
  }

  // ─── Load Most Recent Episode ─────────────────────────────
  let lastEpisode = null;
  if (domain) {
    const episodes = readEpisodes(domain, 1);
    if (episodes.length > 0) {
      lastEpisode = {
        date: episodes[0].date,
        summary: episodes[0].summary,
        lessonsLearned: episodes[0].lessonsLearned || []
      };
    }
  }

  // ─── Evaluate Prospective Triggers ────────────────────────
  const prospective = readProspective();
  const context = {
    project: projectName,
    cwd: process.cwd(),
    sessionCount: (index.stats && index.stats.totalEpisodes) || 0
  };

  const { fired, updated } = evaluateTriggers(prospective, context);

  if (fired.length > 0) {
    writeProspective(updated);
    for (const trigger of fired) {
      log(`[Memory] REMINDER: ${trigger.reminder}`);
    }
  }

  // ─── Write Updated Index ──────────────────────────────────
  writeIndex(index);

  // ─── Build Output ─────────────────────────────────────────
  const topDomainEntries = domainEntries.slice(0, MAX_ENTRIES_IN_CONTEXT);
  const topGlobalEntries = globalEntries.slice(0, 10);
  const totalLoaded = topDomainEntries.length + topGlobalEntries.length;

  // Human-readable summary to stderr
  log(`[Memory] Project: ${projectName || 'unknown'} → domain: ${domainName}`);
  log(`[Memory] ${totalLoaded} memories loaded (${topDomainEntries.length} domain + ${topGlobalEntries.length} global)`);

  if (lastEpisode) {
    log(`[Memory] Last session: ${lastEpisode.date} — ${lastEpisode.summary}`);
  }

  if (fired.length > 0) {
    log(`[Memory] ${fired.length} prospective reminder(s) fired`);
  }

  // JSON context to stdout (returned to Claude)
  const output = {
    domain: domainName,
    project: projectName,
    memoriesLoaded: totalLoaded,
    topMemories: topDomainEntries.map(e => ({
      id: e.id,
      content: e.content,
      salience: e.salience,
      decayScore: e.decayScore,
      tags: e.tags
    })),
    globalMemories: topGlobalEntries.map(e => ({
      id: e.id,
      content: e.content,
      salience: e.salience,
      tags: e.tags
    })),
    lastEpisode,
    reminders: fired.map(t => t.reminder),
    stats: index.stats
  };

  console.log(JSON.stringify(output));
  process.exit(0);
}

main().catch(err => {
  log(`[Memory] Error: ${err.message}`);
  process.exit(0); // Don't block session start on errors
});
