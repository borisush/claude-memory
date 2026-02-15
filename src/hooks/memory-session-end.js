#!/usr/bin/env node
/**
 * Memory System - Session End Hook
 *
 * Runs when a Claude Code session ends.
 * Checks if the session was substantial enough to warrant consolidation,
 * and signals Claude to run /memory consolidate.
 *
 * Does NOT perform consolidation itself — that requires Claude's reasoning.
 */

const fs = require('fs');
const { readIndex, writeIndex, ensureMemoryDirs } = require('../lib/memory');
const { log, countInFile } = require('../lib/utils');

const MIN_MESSAGES_FOR_CONSOLIDATION = 8;

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
