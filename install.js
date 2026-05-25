#!/usr/bin/env node
/**
 * Claude Memory System — Installer
 *
 * Sets up the human-inspired memory system on a new machine.
 * Safe to re-run: skips files that already exist, merges hooks.json.
 *
 * Usage:
 *   node install.js           # Install with fresh (empty) memory
 *   node install.js --check   # Dry run — show what would be installed
 *   node install.js --remove  # Remove memory system hooks (keeps data)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SRC_DIR = path.join(__dirname, 'src');

const DRY_RUN = process.argv.includes('--check');
const REMOVE = process.argv.includes('--remove');

// ─── Helpers ─────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    if (DRY_RUN) {
      console.log(`  [create dir] ${dir}`);
    } else {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  [created] ${dir}`);
    }
  }
}

function copyFile(src, dest, { overwrite = false } = {}) {
  if (fs.existsSync(dest) && !overwrite) {
    console.log(`  [skip] ${dest} (already exists)`);
    return false;
  }
  ensureDir(path.dirname(dest));
  if (DRY_RUN) {
    console.log(`  [copy] ${path.relative(__dirname, src)} → ${dest}`);
  } else {
    fs.copyFileSync(src, dest);
    console.log(`  [installed] ${dest}`);
  }
  return true;
}

function toForwardSlash(p) {
  return p.replace(/\\/g, '/');
}

// ─── Hook Definitions ────────────────────────────────────────

function getMemoryHooks() {
  const scriptsDir = toForwardSlash(path.join(CLAUDE_DIR, 'scripts', 'hooks'));
  return {
    SessionStart: {
      matcher: '*',
      hooks: [{
        type: 'command',
        command: `node "${scriptsDir}/memory-session-start.js"`
      }],
      description: 'Load relevant memories, check prospective triggers, run decay'
    },
    PreCompact: {
      matcher: '*',
      hooks: [{
        type: 'command',
        command: `node "${scriptsDir}/memory-pre-compact.js"`
      }],
      description: 'Build memory-aware recovery snapshot before context compaction'
    },
    Stop: {
      matcher: '*',
      hooks: [{
        type: 'command',
        command: `node "${scriptsDir}/memory-access-tracker.js"`
      }],
      description: 'Track which memories were accessed and update decay clocks'
    },
    SessionEnd: {
      matcher: '*',
      hooks: [{
        type: 'command',
        command: `node "${scriptsDir}/memory-session-end.js"`
      }],
      description: 'Signal consolidation need for substantial sessions'
    }
  };
}

// ─── Check for existing utils.js ─────────────────────────────

function hasCompatibleUtils() {
  const utilsPath = path.join(CLAUDE_DIR, 'scripts', 'lib', 'utils.js');
  if (!fs.existsSync(utilsPath)) return false;

  // Check that it exports the functions memory.js needs
  try {
    const content = fs.readFileSync(utilsPath, 'utf8');
    const required = ['ensureDir', 'readFile', 'getDateTimeString', 'getProjectName', 'getGitRepoName', 'log', 'countInFile'];
    return required.every(fn => content.includes(fn));
  } catch {
    return false;
  }
}

// ─── Install ─────────────────────────────────────────────────

function install() {
  console.log('\n=== Claude Memory System — Install ===\n');

  if (DRY_RUN) {
    console.log('  (dry run — no files will be modified)\n');
  }

  // 1. Library files
  console.log('Step 1: Library files');
  if (hasCompatibleUtils()) {
    console.log('  [skip] utils.js (compatible version already exists)');
  } else {
    copyFile(
      path.join(SRC_DIR, 'lib', 'utils.js'),
      path.join(CLAUDE_DIR, 'scripts', 'lib', 'utils.js')
    );
  }
  for (const lib of [
    'memory.js',
    'memory-dense.js',
    'memo-cross.js',
    'memo-entities.js',
    'memo-staged.js',
    'package-manager.js',
    'session-aliases.js',
    'session-manager.js',
  ]) {
    copyFile(
      path.join(SRC_DIR, 'lib', lib),
      path.join(CLAUDE_DIR, 'scripts', 'lib', lib)
    );
  }

  // 2. Hook scripts — copy every .js in src/hooks/
  console.log('\nStep 2: Hook scripts');
  const hooksSrcDir = path.join(SRC_DIR, 'hooks');
  const hooksDestDir = path.join(CLAUDE_DIR, 'scripts', 'hooks');
  for (const hookFile of fs.readdirSync(hooksSrcDir).filter(f => f.endsWith('.js'))) {
    copyFile(
      path.join(hooksSrcDir, hookFile),
      path.join(hooksDestDir, hookFile)
    );
  }

  // 3. Slash command
  console.log('\nStep 3: Slash command');
  copyFile(
    path.join(SRC_DIR, 'commands', 'memory.md'),
    path.join(CLAUDE_DIR, 'commands', 'memory.md')
  );

  // 4. Memory data directories + config
  console.log('\nStep 4: Memory data directories');
  const memDir = path.join(CLAUDE_DIR, 'memory');
  ensureDir(memDir);
  ensureDir(path.join(memDir, 'semantic'));
  ensureDir(path.join(memDir, 'episodes'));
  ensureDir(path.join(memDir, 'consolidation'));
  ensureDir(path.join(memDir, 'sessions'));

  // Decay config (don't overwrite — user may have tuned it)
  copyFile(
    path.join(SRC_DIR, 'config', 'decay-config.json'),
    path.join(memDir, 'decay-config.json')
  );

  // Create empty prospective.json if missing
  const prospPath = path.join(memDir, 'prospective.json');
  if (!fs.existsSync(prospPath)) {
    const emptyProspective = { version: '1.0', entries: [] };
    if (DRY_RUN) {
      console.log(`  [create] ${prospPath}`);
    } else {
      fs.writeFileSync(prospPath, JSON.stringify(emptyProspective, null, 2) + '\n');
      console.log(`  [created] ${prospPath}`);
    }
  } else {
    console.log(`  [skip] ${prospPath} (already exists)`);
  }

  // Create index.json if missing
  const indexPath = path.join(memDir, 'index.json');
  if (!fs.existsSync(indexPath)) {
    const now = new Date().toISOString();
    const freshIndex = {
      version: '1.0',
      lastUpdated: now,
      lastDecayRun: now,
      stats: {
        totalSemanticEntries: 0,
        totalEpisodes: 0,
        totalProspective: 0,
        entriesPruned: 0
      },
      domainIndex: {}
    };
    if (DRY_RUN) {
      console.log(`  [create] ${indexPath}`);
    } else {
      fs.writeFileSync(indexPath, JSON.stringify(freshIndex, null, 2) + '\n');
      console.log(`  [created] ${indexPath}`);
    }
  } else {
    console.log(`  [skip] ${indexPath} (already exists)`);
  }

  // 5. Merge hooks into hooks.json
  console.log('\nStep 5: Register hooks in hooks.json');
  mergeHooks();

  console.log('\n=== Installation complete ===\n');
  console.log('Next steps:');
  console.log('  1. Start a new Claude Code session — memories will auto-load');
  console.log('  2. Work on any project — the system detects your project automatically');
  console.log('  3. Run /memory consolidate at session end to distill learnings');
  console.log('  4. Run /memory status to check your memory stats\n');
}

// ─── Merge Hooks ─────────────────────────────────────────────

function mergeHooks() {
  const hooksPath = path.join(CLAUDE_DIR, 'hooks', 'hooks.json');
  let hooksData;

  if (fs.existsSync(hooksPath)) {
    try {
      hooksData = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    } catch {
      console.log('  [error] hooks.json exists but is invalid JSON');
      console.log('  [skip] Cannot merge hooks — please fix hooks.json manually');
      return;
    }
  } else {
    hooksData = { hooks: {} };
  }

  if (!hooksData.hooks) {
    hooksData.hooks = {};
  }

  const memoryHooks = getMemoryHooks();
  let added = 0;

  for (const [event, hookDef] of Object.entries(memoryHooks)) {
    if (!hooksData.hooks[event]) {
      hooksData.hooks[event] = [];
    }

    // Check if memory hook already registered (by description keyword)
    const alreadyExists = hooksData.hooks[event].some(h =>
      h.description && (
        h.description.includes('memories') ||
        h.description.includes('memory') ||
        h.description.includes('consolidation')
      ) &&
      h.hooks && h.hooks.some(hh =>
        hh.command && hh.command.includes('memory-')
      )
    );

    if (alreadyExists) {
      console.log(`  [skip] ${event} hook (already registered)`);
    } else {
      if (DRY_RUN) {
        console.log(`  [add] ${event}: ${hookDef.description}`);
      } else {
        hooksData.hooks[event].push(hookDef);
        console.log(`  [added] ${event}: ${hookDef.description}`);
      }
      added++;
    }
  }

  if (added > 0 && !DRY_RUN) {
    ensureDir(path.dirname(hooksPath));
    fs.writeFileSync(hooksPath, JSON.stringify(hooksData, null, 2) + '\n');
    console.log(`  [saved] ${hooksPath}`);
  }
}

// ─── Remove ──────────────────────────────────────────────────

function remove() {
  console.log('\n=== Claude Memory System — Remove Hooks ===\n');
  console.log('  This removes hooks only. Your memory data is preserved.\n');

  const hooksPath = path.join(CLAUDE_DIR, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksPath)) {
    console.log('  [skip] No hooks.json found');
    return;
  }

  let hooksData;
  try {
    hooksData = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  } catch {
    console.log('  [error] hooks.json is invalid JSON');
    return;
  }

  if (!hooksData.hooks) {
    console.log('  [skip] No hooks section found');
    return;
  }

  let removed = 0;
  for (const event of Object.keys(hooksData.hooks)) {
    const before = hooksData.hooks[event].length;
    hooksData.hooks[event] = hooksData.hooks[event].filter(h => {
      const isMemoryHook = h.hooks && h.hooks.some(hh =>
        hh.command && hh.command.includes('memory-')
      );
      if (isMemoryHook) {
        console.log(`  [removed] ${event}: ${h.description}`);
      }
      return !isMemoryHook;
    });
    removed += before - hooksData.hooks[event].length;

    // Clean up empty arrays
    if (hooksData.hooks[event].length === 0) {
      delete hooksData.hooks[event];
    }
  }

  if (removed > 0) {
    fs.writeFileSync(hooksPath, JSON.stringify(hooksData, null, 2) + '\n');
    console.log(`\n  Removed ${removed} hook(s). Memory data preserved at ~/.claude/memory/`);
  } else {
    console.log('  No memory hooks found to remove.');
  }

  console.log('');
}

// ─── Main ────────────────────────────────────────────────────

if (REMOVE) {
  remove();
} else {
  install();
}
