#!/usr/bin/env node
/**
 * PreCompact Hook — Memory-Aware Recovery Snapshot
 *
 * Runs before Claude compacts context. Builds a structured snapshot
 * of the session's working state so post-compaction Claude can resume
 * with full context: recent messages, edited files, top memories,
 * and active reminders.
 *
 * Inspired by OpenClaw's memory-flush mechanism, but instead of a raw
 * dump, we output a structured JSON recovery snapshot.
 *
 * Output:
 *   stderr → Human-readable summary (shown to user)
 *   stdout → JSON snapshot (returned to Claude post-compaction)
 */

const {
  buildPreCompactSnapshot,
  findDomainForProject,
  ensureMemoryDirs
} = require('../lib/memory');
const { getProjectName, getGitRepoName, log } = require('../lib/utils');

async function main() {
  ensureMemoryDirs();

  const transcriptPath = process.env.CLAUDE_TRANSCRIPT_PATH;
  const projectName = getGitRepoName() || getProjectName() || null;
  const domain = findDomainForProject(projectName);

  if (!transcriptPath) {
    log('[Memory] PreCompact: No transcript path available');
    process.exit(0);
  }

  const snapshot = buildPreCompactSnapshot(transcriptPath, domain);

  // Human-readable summary to stderr
  const fileCount = snapshot.recentFilesEdited.length;
  const memCount = snapshot.activeMemories.length + snapshot.globalMemories.length;
  const reminderCount = snapshot.prospectiveReminders.length;

  log(`[Memory] Pre-compaction snapshot built:`);
  log(`[Memory]   ${snapshot.sessionStats.userMessages} messages, ${snapshot.sessionStats.toolCalls} tool calls`);
  log(`[Memory]   ${fileCount} files edited, ${memCount} memories preserved`);
  if (reminderCount > 0) {
    log(`[Memory]   ${reminderCount} active reminder(s)`);
  }

  // JSON snapshot to stdout (returned to Claude)
  console.log(JSON.stringify(snapshot));
  process.exit(0);
}

main().catch(err => {
  log(`[Memory] PreCompact error: ${err.message}`);
  process.exit(0); // Don't block compaction on errors
});
