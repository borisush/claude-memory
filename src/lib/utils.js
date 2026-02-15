/**
 * Minimal utility functions required by the memory system.
 *
 * If you already have ~/.claude/scripts/lib/utils.js with these exports,
 * the setup script will skip installing this file and memory.js will
 * use your existing utils.js instead.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

/**
 * Ensure a directory exists (create recursively if not)
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * Read a text file safely, returning null on error
 */
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Write a text file, creating parent directories as needed
 */
function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Get current datetime in YYYY-MM-DD HH:MM:SS format
 */
function getDateTimeString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Get the git repository name from cwd.
 * Uses execFileSync (no shell) for safety.
 */
function getGitRepoName() {
  try {
    const result = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return path.basename(result.trim());
  } catch {
    return null;
  }
}

/**
 * Get project name from git repo or current directory
 */
function getProjectName() {
  const repoName = getGitRepoName();
  if (repoName) return repoName;
  return path.basename(process.cwd()) || null;
}

/**
 * Log to stderr (visible to user in Claude Code terminal)
 */
function log(message) {
  console.error(message);
}

/**
 * Count occurrences of a pattern in a file
 */
function countInFile(filePath, pattern) {
  const content = readFile(filePath);
  if (content === null) return 0;
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

module.exports = {
  ensureDir,
  readFile,
  writeFile,
  getDateTimeString,
  getGitRepoName,
  getProjectName,
  log,
  countInFile
};
