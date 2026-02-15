# Claude Memory System

A human-inspired memory system for [Claude Code](https://claude.ai/code) that persists knowledge across sessions with salience scoring, natural decay, and prospective reminders.

## How It Works

| Human Memory | Claude Implementation |
|---|---|
| Semantic memory | `~/.claude/memory/semantic/*.json` — distilled facts by domain |
| Episodic memory | `~/.claude/memory/episodes/*.json` — session experiences |
| Prospective memory | `~/.claude/memory/prospective.json` — future triggers/reminders |
| Forgetting curve | Exponential decay with salience floors and access-based resurrection |
| Consolidation | `/memory consolidate` — in-conversation distillation |

### Session Lifecycle

1. **Session start** — Hook loads relevant memories into Claude's context, runs daily decay, fires prospective triggers
2. **During session** — Claude works normally; accessed memories get their decay clock reset
3. **Session end** — Hook checks if consolidation is warranted (8+ messages) and prompts
4. **`/memory consolidate`** — Claude reflects on the session, creates an episode, extracts lasting knowledge, updates semantic memory

## Install

```bash
git clone <this-repo> claude-memory
cd claude-memory
node install.js
```

The installer:
- Copies library + hook scripts to `~/.claude/scripts/`
- Installs the `/memory` slash command to `~/.claude/commands/`
- Creates the `~/.claude/memory/` directory structure
- Merges 3 hooks into `~/.claude/hooks/hooks.json`
- Skips anything that already exists (safe to re-run)
- Detects and reuses your existing `utils.js` if compatible

### Options

```bash
node install.js --check   # Dry run — shows what would be installed
node install.js --remove  # Removes hooks only (preserves memory data)
```

## Usage

### Slash Commands

| Command | Description |
|---|---|
| `/memory` or `/memory consolidate` | Distill current session into lasting memory |
| `/memory status` | Show memory stats, fading entries, active triggers |
| `/memory search <query>` | Search memories by keyword across all domains |
| `/memory add <content>` | Manually add a semantic memory entry |
| `/memory forget <id>` | Remove a specific memory entry |
| `/memory triggers` | List and manage prospective triggers |

### Automatic Behavior

- **Session start**: Top 25 domain memories + top 10 global memories loaded into context
- **Decay**: Runs once per 24 hours; unused memories fade, critical ones have a floor
- **Prospective triggers**: Fire based on project name, keywords, dates, or session count
- **Access tracking**: Memories referenced during a session get their decay clock reset

## Architecture

```
~/.claude/
├── memory/
│   ├── index.json              # Master registry with stats
│   ├── decay-config.json       # Tunable decay parameters
│   ├── prospective.json        # Triggers and reminders
│   ├── semantic/               # Knowledge by domain
│   │   ├── global.json         # Cross-project knowledge
│   │   └── {project}.json      # Project-specific knowledge
│   ├── episodes/               # Session records
│   │   └── YYYY-MM-DD-{project}.json
│   └── consolidation/          # Archived entries below prune threshold
├── scripts/
│   ├── lib/
│   │   ├── memory.js           # Core library (CRUD, decay, triggers, search)
│   │   └── utils.js            # Minimal utilities (bundled or reuses existing)
│   └── hooks/
│       ├── memory-session-start.js   # SessionStart hook
│       ├── memory-session-end.js     # SessionEnd hook
│       └── memory-access-tracker.js  # Stop hook
├── commands/
│   └── memory.md               # /memory slash command
└── hooks/
    └── hooks.json              # Hook registration (3 entries added)
```

## Semantic Memory Entry Format

```json
{
  "id": "sem-myproject-001",
  "content": "Description of the knowledge",
  "domain": "myproject",
  "tags": ["keyword1", "keyword2"],
  "salience": 0.8,
  "salienceReason": "architecture-decision",
  "created": "2026-01-15T10:00:00Z",
  "lastAccessed": "2026-02-10T14:00:00Z",
  "accessCount": 5,
  "decayScore": 0.85,
  "associations": ["sem-myproject-002"]
}
```

### Salience Scale

| Score | Meaning | Floor |
|---|---|---|
| 1.0 | Critical (data loss, security) | 50% of salience |
| 0.8 | High (architecture, recurring pitfalls) | 30% |
| 0.5 | Medium (useful context) | 10% |
| 0.2 | Low (minor details) | 0% (can fully decay) |

## Decay Formula

```
decayScore = max(baseWeight * e^(-λ * daysSinceAccess), salienceFloor)

where:
  baseWeight = min(1.0, salience + min(maxAccessBonus, log2(accessCount + 1) * accessBoostFactor))
  λ = 0.03 (configurable in decay-config.json)
  half-life ≈ 23 days
```

Frequently accessed memories resist decay. Critical memories (salience >= 0.8) never drop below 50% of their original salience.

## Prospective Triggers

```json
{
  "trigger": { "type": "keyword-match", "pattern": "deploy|release|publish" },
  "reminder": "Remember to update the changelog before releasing",
  "fires": "recurring",
  "cooldownDays": 14
}
```

Trigger types: `project-match`, `keyword-match`, `date-after`, `session-count`, `always`

## Tuning

Edit `~/.claude/memory/decay-config.json`:

| Parameter | Default | Effect |
|---|---|---|
| `lambda` | 0.03 | Decay rate (higher = faster forgetting) |
| `halfLifeDays` | 23 | Days until memory strength halves |
| `pruneThreshold` | 0.1 | Below this, entries are archived |
| `warningThreshold` | 0.3 | Entries below this are flagged as fading |
| `accessBoostFactor` | 0.1 | How much frequent access resists decay |
| `maxAccessBonus` | 0.3 | Cap on access-based decay resistance |

## License

MIT
