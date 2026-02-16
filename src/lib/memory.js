/**
 * Memory System Library - Human-Inspired Memory for Claude Code
 *
 * Core CRUD operations for semantic, episodic, and prospective memory.
 * Uses structured JSON storage with salience scoring, decay tracking,
 * and associative links.
 *
 * Depends on: ./utils.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { ensureDir, readFile, getDateTimeString, getProjectName, getGitRepoName } = require('./utils');

// ─── Directory Paths ─────────────────────────────────────────

function getMemoryDir() {
  return path.join(os.homedir(), '.claude', 'memory');
}

function getSemanticDir() {
  return path.join(getMemoryDir(), 'semantic');
}

function getEpisodesDir() {
  return path.join(getMemoryDir(), 'episodes');
}

function getConsolidationDir() {
  return path.join(getMemoryDir(), 'consolidation');
}

function getIndexPath() {
  return path.join(getMemoryDir(), 'index.json');
}

function getDecayConfigPath() {
  return path.join(getMemoryDir(), 'decay-config.json');
}

function getProspectivePath() {
  return path.join(getMemoryDir(), 'prospective.json');
}

function getAccessedPath() {
  return path.join(getMemoryDir(), '.accessed-this-session.json');
}

/**
 * Ensure all memory directories exist
 */
function ensureMemoryDirs() {
  ensureDir(getMemoryDir());
  ensureDir(getSemanticDir());
  ensureDir(getEpisodesDir());
  ensureDir(getConsolidationDir());
  ensureDir(getSessionsDir());
}

// ─── Atomic Write ────────────────────────────────────────────

/**
 * Write JSON to a file atomically (write to .tmp, then rename).
 * Prevents corruption if the process crashes mid-write.
 */
function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDir(dir);

  const tmpPath = filePath + '.tmp';
  const content = JSON.stringify(data, null, 2) + '\n';

  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Read and parse a JSON file, returning null if missing or invalid
 */
function readJson(filePath) {
  const content = readFile(filePath);
  if (content === null) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ─── Index Operations ────────────────────────────────────────

function readIndex() {
  return readJson(getIndexPath());
}

function writeIndex(data) {
  data.lastUpdated = new Date().toISOString();
  atomicWriteJson(getIndexPath(), data);
}

/**
 * Create a fresh index with default structure
 */
function createIndex() {
  return {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    lastDecayRun: new Date().toISOString(),
    stats: {
      totalSemanticEntries: 0,
      totalEpisodes: 0,
      totalProspective: 0,
      entriesPruned: 0
    },
    domainIndex: {}
  };
}

// ─── Semantic Memory ─────────────────────────────────────────

/**
 * Read semantic memory entries for a domain
 * @param {string} domain - e.g., 'cyrano', 'tesla', 'global'
 * @returns {object|null} { version, domain, entries: [...] }
 */
function readSemanticMemory(domain) {
  const filePath = path.join(getSemanticDir(), `${domain}.json`);
  return readJson(filePath);
}

/**
 * Write semantic memory entries for a domain
 * @param {string} domain
 * @param {object} data - { version, domain, entries: [...] }
 */
function writeSemanticMemory(domain, data) {
  const filePath = path.join(getSemanticDir(), `${domain}.json`);
  atomicWriteJson(filePath, data);
}

/**
 * List all available semantic memory domains
 * @returns {string[]} e.g., ['cyrano', 'tesla', 'global']
 */
function listSemanticDomains() {
  const dir = getSemanticDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

/**
 * Find the best matching domain for a project name.
 * Checks exact match first, then substring match.
 * @param {string} projectName
 * @returns {string|null}
 */
function findDomainForProject(projectName) {
  if (!projectName) return null;
  const domains = listSemanticDomains().filter(d => d !== 'global');
  const lower = projectName.toLowerCase();

  // Exact match
  const exact = domains.find(d => d === lower);
  if (exact) return exact;

  // Substring match (project name contains domain or vice versa)
  const partial = domains.find(d => lower.includes(d) || d.includes(lower));
  return partial || null;
}

// ─── Episodic Memory ─────────────────────────────────────────

/**
 * Read episodes for a project, sorted by date descending
 * @param {string} project - project/domain name
 * @param {number} limit - max episodes to return (default 5)
 * @returns {object[]}
 */
function readEpisodes(project, limit = 5) {
  const dir = getEpisodesDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && f.includes(project))
    .sort()
    .reverse()
    .slice(0, limit);

  return files
    .map(f => readJson(path.join(dir, f)))
    .filter(Boolean);
}

/**
 * Write an episode entry
 * @param {object} episode - episode object with id, project, date, etc.
 */
function writeEpisode(episode) {
  const fileName = `${episode.date}-${episode.project}.json`;
  const filePath = path.join(getEpisodesDir(), fileName);
  atomicWriteJson(filePath, episode);
}

/**
 * Get the most recent episode across all projects
 * @returns {object|null}
 */
function getMostRecentEpisode() {
  const dir = getEpisodesDir();
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;
  return readJson(path.join(dir, files[0]));
}

// ─── Prospective Memory ──────────────────────────────────────

/**
 * Read prospective memory (triggers and reminders)
 * @returns {object} { version, entries: [...] }
 */
function readProspective() {
  const data = readJson(getProspectivePath());
  return data || { version: '1.0', entries: [] };
}

/**
 * Write prospective memory
 * @param {object} data - { version, entries: [...] }
 */
function writeProspective(data) {
  atomicWriteJson(getProspectivePath(), data);
}

// ─── Decay Configuration ─────────────────────────────────────

/**
 * Read decay configuration
 * @returns {object} decay config with defaults
 */
function readDecayConfig() {
  const data = readJson(getDecayConfigPath());
  if (data) return data;

  // Return defaults if config file doesn't exist
  return {
    version: '1.0',
    lambda: 0.03,
    halfLifeDays: 23,
    pruneThreshold: 0.1,
    archiveThreshold: 0.2,
    warningThreshold: 0.3,
    salienceFloor: { critical: 0.5, high: 0.3, medium: 0.1, low: 0.0 },
    accessBoostFactor: 0.1,
    maxAccessBonus: 0.3
  };
}

// ─── Decay Calculation ───────────────────────────────────────

/**
 * Calculate the decay score for a single memory entry
 * @param {object} entry - semantic memory entry
 * @param {object} config - decay configuration
 * @param {Date} now - current time
 * @returns {number} decay score between 0 and 1
 */
function calculateDecayScore(entry, config, now) {
  const lastAccessed = new Date(entry.lastAccessed);
  const daysSince = (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);

  const accessBonus = Math.min(
    config.maxAccessBonus,
    Math.log2((entry.accessCount || 1) + 1) * config.accessBoostFactor
  );
  const baseWeight = Math.min(1.0, entry.salience + accessBonus);
  const rawDecay = baseWeight * Math.exp(-config.lambda * daysSince);

  // Apply salience floor — critical memories never fully decay
  let floorMultiplier = 0;
  if (entry.salience >= 0.8) floorMultiplier = config.salienceFloor.critical;
  else if (entry.salience >= 0.5) floorMultiplier = config.salienceFloor.high;
  else if (entry.salience >= 0.2) floorMultiplier = config.salienceFloor.medium;
  else floorMultiplier = config.salienceFloor.low;

  const effectiveFloor = entry.salience * floorMultiplier;
  return Math.max(rawDecay, effectiveFloor);
}

/**
 * Run decay on all entries in a semantic memory file
 * @param {object} semanticData - { version, domain, entries: [...] }
 * @param {object} config - decay configuration
 * @returns {{ updated: object, decayed: number, warned: number, pruned: number }}
 */
function applyDecay(semanticData, config) {
  const now = new Date();
  let decayed = 0;
  let warned = 0;
  let pruned = 0;

  const activeEntries = [];
  const archivedEntries = [];

  for (const entry of semanticData.entries) {
    const newScore = calculateDecayScore(entry, config, now);
    const oldScore = entry.decayScore || 1.0;

    if (newScore !== oldScore) {
      entry.decayScore = Math.round(newScore * 1000) / 1000; // 3 decimal places
      decayed++;
    }

    if (entry.decayScore < config.pruneThreshold) {
      archivedEntries.push(entry);
      pruned++;
    } else {
      if (entry.decayScore < config.warningThreshold) {
        warned++;
      }
      activeEntries.push(entry);
    }
  }

  const updated = {
    ...semanticData,
    entries: activeEntries,
    archived: [...(semanticData.archived || []), ...archivedEntries]
  };

  return { updated, decayed, warned, pruned };
}

// ─── Prospective Trigger Evaluation ──────────────────────────

/**
 * Evaluate prospective triggers against current context
 * @param {object} prospective - { entries: [...] }
 * @param {object} context - { project, cwd, sessionCount }
 * @returns {{ fired: object[], updated: object }}
 */
function evaluateTriggers(prospective, context) {
  const fired = [];
  const now = new Date();

  for (const entry of prospective.entries) {
    // Skip already-fired one-time triggers
    if (entry.fired && entry.fires === 'once') continue;

    // Respect cooldown for recurring triggers
    if (entry.fires === 'recurring' && entry.lastFired) {
      const daysSince = (now.getTime() - new Date(entry.lastFired).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < (entry.cooldownDays || 1)) continue;
    }

    let matches = false;
    const trigger = entry.trigger;

    switch (trigger.type) {
      case 'project-match':
        matches = context.project
          && context.project.toLowerCase().includes(trigger.pattern.toLowerCase());
        break;
      case 'keyword-match': {
        const regex = new RegExp(trigger.pattern, 'i');
        matches = regex.test(context.cwd || '') || regex.test(context.project || '');
        break;
      }
      case 'date-after':
        matches = now >= new Date(trigger.date);
        break;
      case 'session-count':
        matches = trigger.every && context.sessionCount
          && (context.sessionCount % trigger.every) === 0;
        break;
      case 'always':
        matches = true;
        break;
    }

    if (matches) {
      fired.push(entry);

      // Update trigger state
      if (entry.fires === 'once') {
        entry.fired = true;
        entry.firedAt = now.toISOString();
      } else if (entry.fires === 'recurring') {
        entry.lastFired = now.toISOString();
      }
    }
  }

  return { fired, updated: prospective };
}

// ─── Access Tracking ─────────────────────────────────────────

/**
 * Record that a memory entry was accessed this session
 * @param {string} entryId - the memory entry ID
 */
function recordAccess(entryId) {
  const accessPath = getAccessedPath();
  let accessed = readJson(accessPath) || { entries: [] };
  if (!accessed.entries.includes(entryId)) {
    accessed.entries.push(entryId);
  }
  atomicWriteJson(accessPath, accessed);
}

/**
 * Read and clear the access log for this session
 * @returns {string[]} list of accessed entry IDs
 */
function consumeAccessLog() {
  const accessPath = getAccessedPath();
  const accessed = readJson(accessPath);
  if (!accessed || !accessed.entries || accessed.entries.length === 0) {
    return [];
  }

  // Delete the file after reading
  try { fs.unlinkSync(accessPath); } catch { /* ignore */ }

  return accessed.entries;
}

/**
 * Apply access updates to semantic memory entries
 * @param {string[]} accessedIds - entry IDs that were accessed
 * @param {string} domain - the domain to update
 * @returns {number} number of entries updated
 */
function applyAccessUpdates(accessedIds, domain) {
  if (accessedIds.length === 0) return 0;

  const data = readSemanticMemory(domain);
  if (!data || !data.entries) return 0;

  const now = new Date().toISOString();
  let updated = 0;

  for (const entry of data.entries) {
    if (accessedIds.includes(entry.id)) {
      entry.accessCount = (entry.accessCount || 0) + 1;
      entry.lastAccessed = now;
      updated++;
    }
  }

  if (updated > 0) {
    writeSemanticMemory(domain, data);
  }

  return updated;
}

// ─── ID Generation ───────────────────────────────────────────

/**
 * Generate a unique ID for a memory entry
 * @param {string} prefix - e.g., 'sem', 'ep', 'pm'
 * @param {string} domain - e.g., 'cyrano'
 * @returns {string} e.g., 'sem-cyrano-001'
 */
function generateId(prefix, domain) {
  // Read existing entries to find the next number
  let maxNum = 0;

  if (prefix === 'sem') {
    const data = readSemanticMemory(domain);
    if (data && data.entries) {
      for (const entry of data.entries) {
        const match = entry.id.match(/-(\d+)$/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
    }
  } else if (prefix === 'pm') {
    const data = readProspective();
    if (data && data.entries) {
      for (const entry of data.entries) {
        const match = entry.id.match(/-(\d+)$/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
    }
  }

  const nextNum = String(maxNum + 1).padStart(3, '0');
  return `${prefix}-${domain}-${nextNum}`;
}

// ─── Sorting & Filtering ────────────────────────────────────

/**
 * Sort entries by relevance (decayScore * salience, descending)
 * @param {object[]} entries
 * @returns {object[]} sorted copy
 */
function sortByRelevance(entries) {
  return [...entries].sort((a, b) => {
    const scoreA = (a.decayScore || 1) * (a.salience || 0.5);
    const scoreB = (b.decayScore || 1) * (b.salience || 0.5);
    return scoreB - scoreA;
  });
}

/**
 * Filter entries above a minimum salience threshold
 * @param {object[]} entries
 * @param {number} minSalience
 * @returns {object[]}
 */
function filterBySalience(entries, minSalience) {
  return entries.filter(e => (e.salience || 0) >= minSalience);
}

// ─── Scored Search (BM25-inspired) ──────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because',
  'this', 'that', 'these', 'those', 'it', 'its'
]);

/**
 * Tokenize text into lowercase words, filtering stopwords
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[\s\-_./\\,;:!?()[\]{}"'`~@#$%^&*+=<>|]+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * BM25-inspired scored search across memory entries.
 *
 * Scores each entry by:
 *   1. Term frequency x inverse document frequency (content field)
 *   2. Exact tag matches (2x boost)
 *   3. Metadata boost: salience and decay score
 *
 * @param {object[]} entries - semantic memory entries
 * @param {string} query - search query
 * @param {object} [options]
 * @param {number} [options.maxResults=20] - max results to return
 * @param {number} [options.minScore=0.01] - minimum score threshold
 * @returns {Array<{ entry: object, score: number }>} scored and sorted results
 */
function scoredSearch(entries, query, options = {}) {
  const { maxResults = 20, minScore = 0.01 } = options;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const N = entries.length;
  if (N === 0) return [];

  // Pre-compute document frequency for each query token
  const df = {};
  for (const token of queryTokens) {
    df[token] = 0;
  }

  const entryTokensCache = entries.map(entry => {
    const contentTokens = tokenize(entry.content);
    const tagTokens = (entry.tags || []).map(t => t.toLowerCase());

    for (const token of queryTokens) {
      if (contentTokens.includes(token) || tagTokens.includes(token)) {
        df[token]++;
      }
    }

    return { contentTokens, tagTokens };
  });

  // Compute IDF for each query token: log(N / (df + 1)) + 1
  const idf = {};
  for (const token of queryTokens) {
    idf[token] = Math.log(N / ((df[token] || 0) + 1)) + 1;
  }

  // Score each entry
  const scored = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const { contentTokens, tagTokens } = entryTokensCache[i];

    // Content score: sum of (tf * idf) for each query token
    let contentScore = 0;
    for (const token of queryTokens) {
      const tf = contentTokens.filter(t => t === token).length;
      if (tf > 0) {
        // BM25-lite: saturating TF (diminishing returns for repeated terms)
        const normalizedTf = (tf * 1.5) / (tf + 0.5);
        contentScore += normalizedTf * idf[token];
      }
    }

    // Tag score: exact matches get a 2x boost
    let tagScore = 0;
    for (const token of queryTokens) {
      if (tagTokens.some(t => t === token || t.includes(token))) {
        tagScore += 2.0 * idf[token];
      }
    }

    // Phrase bonus: if the full query appears as a substring in content
    let phraseBonus = 0;
    if (queryTokens.length > 1) {
      const lowerContent = (entry.content || '').toLowerCase();
      const lowerQuery = query.toLowerCase();
      if (lowerContent.includes(lowerQuery)) {
        phraseBonus = queryTokens.length * 1.5;
      }
    }

    const rawScore = contentScore + tagScore + phraseBonus;
    if (rawScore <= 0) continue;

    // Metadata boost: salience and decay score influence ranking
    const salienceBoost = 1 + 0.3 * (entry.salience || 0.5);
    const decayBoost = 0.5 + 0.5 * (entry.decayScore || 1.0);
    const finalScore = rawScore * salienceBoost * decayBoost;

    if (finalScore >= minScore) {
      scored.push({ entry, score: Math.round(finalScore * 1000) / 1000 });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

/**
 * Search entries by keyword across content and tags.
 * Returns matching entries (backward compatible — returns entries, not scored pairs).
 * For scored results, use scoredSearch() directly.
 *
 * @param {object[]} entries
 * @param {string} query
 * @returns {object[]}
 */
function searchEntries(entries, query) {
  const results = scoredSearch(entries, query, { maxResults: 100, minScore: 0.001 });
  return results.map(r => r.entry);
}

// ─── Session Fingerprinting ─────────────────────────────────

function getSessionsDir() {
  return path.join(getMemoryDir(), 'sessions');
}

/**
 * Extract a lightweight session fingerprint from a JSONL transcript.
 *
 * Parses the transcript to identify files edited/read, tools used,
 * user message keywords, and error patterns.
 *
 * @param {string} transcriptPath - path to the session JSONL transcript
 * @param {string} project - current project name
 * @returns {object|null} session fingerprint or null if transcript unreadable
 */
function extractSessionFingerprint(transcriptPath, project) {
  const content = readFile(transcriptPath);
  if (!content) return null;

  const lines = content.split('\n').filter(Boolean);
  const filesEdited = new Set();
  const filesRead = new Set();
  const toolsUsed = {};
  const allUserTokens = [];
  const errors = [];
  let userMessageCount = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    // Track timestamps
    if (entry.timestamp) {
      if (!firstTimestamp) firstTimestamp = entry.timestamp;
      lastTimestamp = entry.timestamp;
    }

    // Count user messages and extract keywords
    if (entry.type === 'user' || entry.role === 'user') {
      userMessageCount++;
      const text = typeof entry.content === 'string'
        ? entry.content
        : (entry.message || '');
      const tokens = tokenize(text);
      allUserTokens.push(...tokens);
    }

    // Extract tool usage from assistant messages
    if (entry.type === 'assistant' || entry.role === 'assistant') {
      const toolUse = entry.tool_use || entry.content;
      if (Array.isArray(toolUse)) {
        for (const block of toolUse) {
          if (block.type === 'tool_use') {
            const toolName = block.name || 'unknown';
            toolsUsed[toolName] = (toolsUsed[toolName] || 0) + 1;

            const input = block.input || {};
            if (toolName === 'Edit' || toolName === 'Write') {
              if (input.file_path) filesEdited.add(input.file_path);
            } else if (toolName === 'Read') {
              if (input.file_path) filesRead.add(input.file_path);
            }
          }
        }
      }
    }

    // Detect error patterns
    if (entry.type === 'tool_result' || entry.tool_result) {
      const output = entry.output || entry.tool_result?.output || '';
      if (typeof output === 'string' && output.includes('error') || output.includes('Error')) {
        const firstLine = output.split('\n')[0];
        if (firstLine && firstLine.length < 200) {
          errors.push(firstLine.slice(0, 150));
        }
      }
    }
  }

  // Compute top keywords by frequency
  const freq = {};
  for (const token of allUserTokens) {
    freq[token] = (freq[token] || 0) + 1;
  }
  const topKeywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);

  // Compute duration
  let duration = null;
  if (firstTimestamp && lastTimestamp) {
    const diffMs = new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin > 0) duration = `${diffMin}min`;
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  return {
    date: dateStr,
    project: project || 'unknown',
    messageCount: userMessageCount,
    filesEdited: [...filesEdited],
    filesRead: [...filesRead],
    topKeywords,
    toolsUsed,
    errors: [...new Set(errors)].slice(0, 10),
    duration
  };
}

/**
 * Write a session fingerprint to the sessions directory
 * @param {object} fingerprint - session fingerprint object
 */
function writeSessionFingerprint(fingerprint) {
  const dir = getSessionsDir();
  ensureDir(dir);
  const fileName = `${fingerprint.date}-${fingerprint.project}.json`;
  const filePath = path.join(dir, fileName);

  // If file already exists for this date+project, append a counter
  let finalPath = filePath;
  let counter = 2;
  while (fs.existsSync(finalPath)) {
    finalPath = path.join(dir, `${fingerprint.date}-${fingerprint.project}-${counter}.json`);
    counter++;
  }

  atomicWriteJson(finalPath, fingerprint);
}

/**
 * Search session fingerprints for keyword matches
 * @param {string} query - search query
 * @param {number} [maxResults=10] - max fingerprints to return
 * @returns {Array<{ fingerprint: object, matches: string[] }>}
 */
function searchSessionFingerprints(query, maxResults = 10) {
  const dir = getSessionsDir();
  if (!fs.existsSync(dir)) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  const results = [];

  for (const file of files) {
    const fp = readJson(path.join(dir, file));
    if (!fp) continue;

    const matches = [];
    const fpKeywords = (fp.topKeywords || []).map(k => k.toLowerCase());
    const fpFiles = [...(fp.filesEdited || []), ...(fp.filesRead || [])];

    for (const token of queryTokens) {
      if (fpKeywords.includes(token)) {
        matches.push(`keyword: ${token}`);
      }
      if (fpFiles.some(f => f.toLowerCase().includes(token))) {
        matches.push(`file: ${fpFiles.find(f => f.toLowerCase().includes(token))}`);
      }
      const fpErrors = (fp.errors || []);
      if (fpErrors.some(e => e.toLowerCase().includes(token))) {
        matches.push(`error: ${token}`);
      }
    }

    if (matches.length > 0) {
      results.push({ fingerprint: fp, matches: [...new Set(matches)] });
    }

    if (results.length >= maxResults) break;
  }

  return results;
}

// ─── Pre-Compaction Snapshot ─────────────────────────────────

/**
 * Extract recent activity from a JSONL session transcript.
 *
 * Parses the transcript to find the last N user messages and
 * files recently edited — used to build a recovery snapshot
 * before context compaction.
 *
 * @param {string} transcriptPath - path to the session JSONL transcript
 * @param {number} [maxMessages=5] - max recent user messages to extract
 * @returns {{ userMessages: string[], filesEdited: string[], toolCalls: number }}
 */
function extractRecentActivity(transcriptPath, maxMessages = 5) {
  const content = readFile(transcriptPath);
  if (!content) return { userMessages: [], filesEdited: [], toolCalls: 0 };

  const lines = content.split('\n').filter(Boolean);
  const userMessages = [];
  const filesEdited = new Set();
  let toolCalls = 0;

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type === 'user' || entry.role === 'user') {
      const text = typeof entry.content === 'string'
        ? entry.content
        : (entry.message || '');
      if (text) userMessages.push(text.slice(0, 300));
    }

    if (entry.type === 'assistant' || entry.role === 'assistant') {
      const blocks = Array.isArray(entry.content) ? entry.content
        : (entry.tool_use ? [entry.tool_use] : []);
      for (const block of blocks) {
        if (block.type === 'tool_use') {
          toolCalls++;
          const input = block.input || {};
          if ((block.name === 'Edit' || block.name === 'Write') && input.file_path) {
            filesEdited.add(input.file_path);
          }
        }
      }
    }
  }

  return {
    userMessages: userMessages.slice(-maxMessages),
    filesEdited: [...filesEdited],
    toolCalls
  };
}

/**
 * Build a pre-compaction recovery snapshot.
 *
 * Combines recent session activity with top domain memories
 * and active prospective reminders into a single JSON object
 * that can be output to stdout for Claude to consume post-compaction.
 *
 * @param {string} transcriptPath - path to the session JSONL transcript
 * @param {string|null} domain - current project domain
 * @returns {object} recovery snapshot
 */
function buildPreCompactSnapshot(transcriptPath, domain) {
  const activity = extractRecentActivity(transcriptPath);

  // Load top memories for the domain
  let activeMemories = [];
  if (domain) {
    const data = readSemanticMemory(domain);
    if (data && data.entries) {
      activeMemories = sortByRelevance(data.entries)
        .slice(0, 10)
        .map(e => ({ id: e.id, content: e.content, salience: e.salience }));
    }
  }

  // Load global critical memories
  const globalData = readSemanticMemory('global');
  let globalMemories = [];
  if (globalData && globalData.entries) {
    globalMemories = filterBySalience(globalData.entries, 0.5)
      .slice(0, 5)
      .map(e => ({ id: e.id, content: e.content, salience: e.salience }));
  }

  // Load active prospective reminders
  const prospective = readProspective();
  const activeReminders = (prospective.entries || [])
    .filter(e => !(e.fired && e.fires === 'once'))
    .map(e => e.reminder);

  return {
    type: 'memory-pre-compact-snapshot',
    project: getProjectName() || 'unknown',
    domain: domain || 'none',
    recentUserMessages: activity.userMessages,
    recentFilesEdited: activity.filesEdited,
    activeMemories,
    globalMemories,
    prospectiveReminders: activeReminders,
    sessionStats: {
      userMessages: activity.userMessages.length,
      toolCalls: activity.toolCalls
    }
  };
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  // Paths
  getMemoryDir,
  getSemanticDir,
  getEpisodesDir,
  getConsolidationDir,
  getSessionsDir,
  getIndexPath,
  getDecayConfigPath,
  getProspectivePath,
  getAccessedPath,

  // Setup
  ensureMemoryDirs,

  // I/O primitives
  atomicWriteJson,
  readJson,

  // Index
  readIndex,
  writeIndex,
  createIndex,

  // Semantic memory
  readSemanticMemory,
  writeSemanticMemory,
  listSemanticDomains,
  findDomainForProject,

  // Episodic memory
  readEpisodes,
  writeEpisode,
  getMostRecentEpisode,

  // Prospective memory
  readProspective,
  writeProspective,

  // Decay
  readDecayConfig,
  calculateDecayScore,
  applyDecay,

  // Triggers
  evaluateTriggers,

  // Access tracking
  recordAccess,
  consumeAccessLog,
  applyAccessUpdates,

  // Search (v2 — BM25-inspired)
  tokenize,
  scoredSearch,
  searchEntries,

  // Session fingerprinting
  extractSessionFingerprint,
  writeSessionFingerprint,
  searchSessionFingerprints,

  // Pre-compaction snapshot
  extractRecentActivity,
  buildPreCompactSnapshot,

  // Utilities
  generateId,
  sortByRelevance,
  filterBySalience
};
