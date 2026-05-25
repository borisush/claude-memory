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
| `/memory search <query>` | Hybrid (BM25 + dense) search with pyramid retrieval |
| `/memory add <content>` | Manually add a semantic memory entry |
| `/memory forget <id>` | Remove a specific memory entry |
| `/memory triggers` | List and manage prospective triggers |
| `/memory cross` | **MeMo-style**: find cross-domain patterns worth promoting to `global` |
| `/memory entities <query>` | **MeMo-style**: reverse-lookup — which memories mention X? |
| `/memory entities rebuild` | Rebuild the entity reverse-index (auto-runs at consolidate end) |
| `/memory ask <question>` | **MeMo-style**: staged retrieval — narrows by entity if ambiguous |

### Command-line tools

The entity-index module is also usable directly from a shell:

```bash
node ~/.claude/scripts/lib/memo-entities.js rebuild       # full rebuild
node ~/.claude/scripts/lib/memo-entities.js lookup stripe # query
node ~/.claude/scripts/lib/memo-entities.js stats         # show index health
node ~/.claude/scripts/lib/memo-entities.js validate      # parse-check all memory data
```

The `validate` subcommand catches silent JSON corruption that would otherwise
hide memories from search (it found and helped repair a 31-entry data-loss
bug on the author's machine).

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
│   │   ├── memory.js           # Core library (CRUD, decay, triggers, hybrid+pyramid search)
│   │   ├── memory-dense.js     # Hashed n-gram embeddings for dense retrieval
│   │   ├── memo-cross.js       # Cross-domain pattern finder (MeMo-style)
│   │   ├── memo-entities.js    # Entity reverse-index + lookup + validate CLI
│   │   ├── memo-staged.js      # Staged retrieval with ambiguity detection
│   │   ├── utils.js            # Minimal utilities (bundled or reuses existing)
│   │   ├── package-manager.js, session-aliases.js, session-manager.js
│   └── hooks/
│       ├── memory-session-start.js, memory-session-end.js, memory-access-tracker.js
│       ├── memory-pre-compact.js, pre-compact.js
│       ├── session-start.js, session-end.js
│       └── evaluate-session.js, suggest-compact.js, check-console-log.js
├── commands/
│   └── memory.md               # /memory slash command (10 subcommands)
└── hooks/
    └── hooks.json              # Hook registration
```

## MeMo-style Enhancements (v1.1)

Inspired by the [MeMo paper](https://arxiv.org/abs/2605.15156) (May 2026),
which proposes treating memory as a trainable model. This system stays
symbolic (files, not weights) but borrows three architectural ideas:

**Cross-document synthesis** (`/memory cross`) — scans all project memories
for patterns recurring across ≥2 domains via tag-set + token-set Jaccard
clustering. Surfaces candidates for promotion to `global` entries.
[memo-cross.js](src/lib/memo-cross.js)

**Entity-surfacing reverse index** (`/memory entities <query>`) — 12
extractors (backticks, paths, URLs, slash commands, services, git SHAs,
Stripe IDs, device serials, Calendly slugs, filenames, identifiers,
constants) build a `~/.claude/memory/entity-index.json` reverse lookup.
Kind-weighted ranking — commands and paths beat noisy identifiers on the
same match tier. [memo-entities.js](src/lib/memo-entities.js)

**Staged retrieval with ambiguity detection** (`/memory ask <question>`) —
groups candidates by IDF-distinctive entity, returns either a confident
answer (one entity group dominates) or surfaces competing groups for a
disambiguating follow-up question. [memo-staged.js](src/lib/memo-staged.js)

All three are additive — they import from `memory.js` but don't modify it.

## Hybrid + Pyramid Retrieval (v1.1)

`/memory search` is no longer pure BM25. Search now combines:

- **Sparse**: BM25-inspired TF·IDF + tag boosts + phrase bonus
- **Dense**: Hashed n-gram embeddings, cosine similarity (no external model)
- **Set-union merge**: Dense ordering preserved, sparse-only appended (no
  score reranking, which destroys ordering)
- **Pyramid expansion**: L1 summaries for every candidate; L2 cold-storage
  bodies for high-confidence hits, all gated by an explicit token budget

Memory entries support a hot/cold split — short `summary` in JSON, full body
in `semantic/raw/<domain>/<id>.md` loaded lazily. Migration is automatic via
`migrateEntryHotCold()` on first read of a legacy entry.

## Semantic Memory Entry Format

Entries use a hot/cold split (MAU schema). Hot fields stay in
`semantic/<domain>.json`; the optional full body lives at
`semantic/raw/<domain>/<id>.md`:

```json
{
  "id": "sem-myproject-001",
  "domain": "myproject",
  "summary": "Lead with the rule/fact in ≤ 280 chars — searchable, hot-loaded",
  "bodyRef": "raw/myproject/sem-myproject-001.md",
  "tags": ["keyword1", "keyword2"],
  "salience": 0.8,
  "salienceReason": "architecture-decision",
  "created": "2026-01-15T10:00:00Z",
  "lastAccessed": "2026-02-10T14:00:00Z",
  "accessCount": 5,
  "decayScore": 0.85,
  "associations": ["sem-myproject-002"],
  "embedding": "<base64-encoded hashed n-gram vector>"
}
```

Legacy entries using `content` instead of `summary` are auto-migrated on
first read via `migrateEntryHotCold(entry, domain)`. The `embedding` field
is computed automatically and powers dense retrieval.

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
