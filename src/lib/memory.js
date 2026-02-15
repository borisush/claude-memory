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

/**
 * Search entries by keyword across content and tags
 * @param {object[]} entries
 * @param {string} query
 * @returns {object[]}
 */
function searchEntries(entries, query) {
  const lower = query.toLowerCase();
  return entries.filter(entry => {
    const contentMatch = (entry.content || '').toLowerCase().includes(lower);
    const tagMatch = (entry.tags || []).some(t => t.toLowerCase().includes(lower));
    return contentMatch || tagMatch;
  });
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  // Paths
  getMemoryDir,
  getSemanticDir,
  getEpisodesDir,
  getConsolidationDir,
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

  // Utilities
  generateId,
  sortByRelevance,
  filterBySalience,
  searchEntries
};
