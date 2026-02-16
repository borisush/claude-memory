#!/usr/bin/env node
/**
 * Memory System - Session End Hook
 *
 * Runs when a Claude Code session ends.
 * 1. Checks if the session was substantial enough to warrant consolidation
 * 2. Extracts a lightweight session fingerprint (files, keywords, tools)
 *    for cross-session search without full-text indexing
 *
 * Does NOT perform consolidation itself — that requires Claude's reasoning.
 */

const fs = require('fs');
const {
  readIndex,
  writeIndex,
  ensureMemoryDirs,
  extractSessionFingerprint,
  writeSessionFingerprint
} = require('../lib/memory');
const { log, countInFile, getProjectName, getGitRepoName } = require('../lib/utils');

const MIN_MESSAGES_FOR_CONSOLIDATION = 8;
const MIN_MESSAGES_FOR_FINGERPRINT = 3;

async function main() {
  ensureMemoryDirs();

  // Count user messages in session transcript
  const transcriptPath = process.env.CLAUDE_TRANSCRIPT_PATH;
  let messageCount = 0;

  if (transcriptPath && fs.existsSync(transcriptPath)) {
    messageCount = countInFile(transcriptPath, /"type":"user"/g);
  }

  // Update index timestamp
  const index = readIndex();
  if (index) {
    writeIndex(index);
  }

  // Extract and save session fingerprint for substantial sessions
  if (messageCount >= MIN_MESSAGES_FOR_FINGERPRINT && transcriptPath) {
    const projectName = getGitRepoName() || getProjectName() || 'unknown';
    const fingerprint = extractSessionFingerprint(transcriptPath, projectName);

    if (fingerprint && fingerprint.messageCount > 0) {
      writeSessionFingerprint(fingerprint);
      log(`[Memory] Session fingerprint saved (${fingerprint.filesEdited.length} files, ${fingerprint.topKeywords.length} keywords)`);
    }
  }

  // Signal consolidation need for substantial sessions
  if (messageCount >= MIN_MESSAGES_FOR_CONSOLIDATION) {
    log(`[Memory] Substantial session (${messageCount} messages). Consider running /memory consolidate before ending.`);
  }

  process.exit(0);
}

main().catch(err => {
  log(`[Memory] SessionEnd error: ${err.message}`);
  process.exit(0);
});
