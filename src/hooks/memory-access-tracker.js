#!/usr/bin/env node
/**
 * Memory System - Access Tracker (Stop Hook)
 *
 * Checks for a temp file listing memory entries that Claude accessed
 * during this response cycle. Updates accessCount and lastAccessed
 * for those entries, resetting their decay clock ("resurrection").
 *
 * The temp file (~/.claude/memory/.accessed-this-session.json) is written
 * by Claude during conversation when it reads from memory files.
 */

const {
  consumeAccessLog,
  readSemanticMemory,
  writeSemanticMemory,
  listSemanticDomains,
  ensureMemoryDirs
} = require('../lib/memory');
const { log } = require('../lib/utils');

async function main() {
  ensureMemoryDirs();

  const accessedIds = consumeAccessLog();
  if (accessedIds.length === 0) {
    process.exit(0);
  }

  const now = new Date().toISOString();
  let totalUpdated = 0;
  const domains = listSemanticDomains();

  for (const domain of domains) {
    const data = readSemanticMemory(domain);
    if (!data || !data.entries) continue;

    let domainUpdated = 0;
    for (const entry of data.entries) {
      if (accessedIds.includes(entry.id)) {
        entry.accessCount = (entry.accessCount || 0) + 1;
        entry.lastAccessed = now;
        domainUpdated++;
      }
    }

    if (domainUpdated > 0) {
      writeSemanticMemory(domain, data);
      totalUpdated += domainUpdated;
    }
  }

  if (totalUpdated > 0) {
    log(`[Memory] Updated access for ${totalUpdated} memory entries`);
  }

  process.exit(0);
}

main().catch(err => {
  log(`[Memory] AccessTracker error: ${err.message}`);
  process.exit(0);
});
