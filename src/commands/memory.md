# /memory — Human-Inspired Memory System

You have a structured memory system at `~/.claude/memory/` that mirrors human memory:
- **Semantic memory** (`semantic/*.json`): Distilled facts and knowledge, organized by domain
- **Episodic memory** (`episodes/*.json`): Session-specific experiences and lessons
- **Prospective memory** (`prospective.json`): Triggers and reminders for future sessions
- **Decay system**: Memories naturally fade unless accessed; critical memories have a floor

## Subcommands

The user invoked `/memory` with arguments: `$ARGUMENTS`

### If `$ARGUMENTS` is "consolidate" or empty:

**Consolidation** — Distill this session into lasting memory. Follow these steps:

1. **Reflect** on what happened in the current session:
   - What features were built, bugs fixed, or decisions made?
   - What went wrong? What was learned?
   - Were there any breakthroughs or recurring patterns?

2. **Read** existing semantic memory for the relevant domain:
   - `~/.claude/memory/semantic/{domain}.json`
   - Check for entries that overlap with new learnings (update, don't duplicate)

3. **Create an episode** entry at `~/.claude/memory/episodes/YYYY-MM-DD-{project}.json`:
   ```json
   {
     "id": "ep-YYYY-MM-DD-{project}",
     "project": "{project}",
     "date": "YYYY-MM-DD",
     "summary": "Brief description of the session",
     "events": [
       { "type": "feature|bug-fix|refactor|research|design", "description": "...", "salience": 0.0-1.0, "files": [] }
     ],
     "decisions": ["List of architectural/design decisions made"],
     "lessonsLearned": ["List of things learned"],
     "consolidated": true,
     "decayScore": 1.0,
     "lastAccessed": "{now ISO}",
     "accessCount": 1
   }
   ```

4. **Extract new semantic entries** from the episode using the **MAU schema**:
   - `summary` (≤ 280 chars) — the searchable, hot-loaded one-liner. Lead with the rule/fact.
   - For long entries, put the full detail in cold storage:
     - Write the full body to `~/.claude/memory/semantic/raw/<domain>/<id>.md`
     - Set `bodyRef: "raw/<domain>/<id>.md"` on the entry
   - **Embedding** — call `migrateEntryHotCold(entry, domain)` from `memory.js` after creating the entry; it computes the hashed n-gram embedding automatically. Or call `embedText()` from `memory-dense.js` directly and `encodeEmbedding()` to base64.
   - Salience: 1.0 critical, 0.8 high, 0.5 medium, 0.2 low
   - Tag with relevant keywords
   - Add salienceReason: bug-prevention, architecture-decision, user-preference, breakthrough, recurring-pattern, tool-knowledge
   - Link associations to related entries

5. **Merge with existing entries**: If a new fact overlaps with an existing entry, update the existing one (increment accessCount, update summary if richer, rewrite cold body if longer, recompute embedding). Don't create duplicates.

6. **Update prospective triggers** if the session revealed something to remember for the future.

7. **Update index.json**: Increment episode count, update domain stats, update totalSemanticEntries.

8. **Refresh entity index**: For every entry you created or updated in this consolidation, call `addEntryToIndex(entry, domain, index)` from `~/.claude/scripts/lib/memo-entities.js`. Persist with `writeEntityIndex(index)`. This keeps the reverse-lookup index current without a full O(N) rebuild. If the index file doesn't exist (`readEntityIndex()` returns null), fall back to a full `buildEntityIndex` + `writeEntityIndex`. Either way, the index is fresh by the time consolidation finishes.

9. **Regenerate MEMORY.md**: Read all semantic JSON files and regenerate `~/.claude/projects/D--Projects-cyrano/memory/MEMORY.md` (or the appropriate project memory path) as a human-readable view:
   ```markdown
   # Auto Memory
   <!-- Generated from ~/.claude/memory/semantic/ | Last consolidated: YYYY-MM-DD -->

   ## {Domain} Project
   ### Critical (salience >= 0.8)
   - **content** [Nx accessed, last: YYYY-MM-DD]

   ### Architecture
   - **content** [Nx accessed]

   ### Tools & Paths
   - **content** [Nx accessed]

   ## Fading (decayScore < 0.3)
   - content [last accessed N days ago]
   ```

### If `$ARGUMENTS` is "status":

Read and display:
- `~/.claude/memory/index.json` — show domain counts, total entries, last decay run
- Show entries near decay threshold (decayScore < 0.3)
- Show pending unconsolidated episodes
- Show active prospective triggers

### If `$ARGUMENTS` starts with "search":

Extract the search query from `$ARGUMENTS` (everything after "search").

**Pyramid retrieval** (v3, OMNI-SimpleMem-inspired): Use `pyramidRetrieve(entries, query, opts)` from `~/.claude/scripts/lib/memory.js`. This combines:
- **Hybrid search** — dense (hashed n-gram cosine) ∪ sparse (BM25) via set-union merge (NOT score-rerank, which destroys ordering)
- **3-level expansion** under explicit token budget:
  - **L1**: summary for every top-K candidate (cheap)
  - **L2**: full body from cold storage for high-confidence candidates (`semantic/raw/<domain>/<id>.md`)
  - **L3**: reserved for future multimodal expansion

Procedure:
1. Aggregate entries from all domains. Tag each entry with its source domain: `entry._domain = domainName` (the pyramid loader uses this to find cold bodies).
2. Call `pyramidRetrieve(allEntries, query, { topK: 10, expandThreshold: 0.4, tokenBudget: 6000 })`.
3. Display L1 candidates with their source tag (`[D]` dense / `[S]` sparse), domain, salience, and summary.
4. Below that, show any L2-expanded entries with the additional cold-storage content that was loaded.
5. Also call `searchSessionFingerprints(query)` and show session matches separately.

Display format:

**Memory Matches** (pyramid L1):
```
1. [D 0.42] (cantus, sal 1.0) cantus-002 — Lyria 3 Pro: model='lyria-3-pro-preview'...
2. [S 2.10] (global, sal 0.5) sem-global-007 — Must Read a file before Write/Edit...
```

**Expanded (L2, from cold storage)**:
```
- cantus-002 (cantus): +57 chars
  <full cold body content>
```

**Session Matches**:
```
- Session 2026-02-15 (cyrano): matched keyword "flutter", files: lib/main.dart
```

Token budget used: `result.tokensUsed / result.budget`.

### If `$ARGUMENTS` starts with "add":

Extract the content from `$ARGUMENTS` (everything after "add").
Ask the user for:
- Domain (detect from current project or ask)
- Salience (suggest based on content)
- Tags

Create a new semantic entry with the next available ID.

### If `$ARGUMENTS` starts with "forget":

Extract the entry ID from `$ARGUMENTS` (everything after "forget").
Find the entry across all semantic files and remove it.
Update index.json entry counts.

### If `$ARGUMENTS` is "triggers":

Read `~/.claude/memory/prospective.json` and display all triggers:
- Show trigger type, pattern, reminder text
- Show fire status (once/recurring, fired/unfired, cooldown)
- Allow adding new triggers interactively

### If `$ARGUMENTS` is "cross":

**Cross-document synthesis** (MeMo-inspired) — scan all project memories for
patterns that recur across ≥2 domains and propose promotions to `global`.

Procedure:

1. Call `findCrossDomainCandidates()` from `~/.claude/scripts/lib/memo-cross.js`.
   It returns clusters of entries that share both tag-set overlap and
   summary-vocabulary overlap across multiple domains.

2. For each cluster (in score order, top N):
   - Show: `domainCount`, `entryCount`, `commonTags`, `commonTokens`
   - List each member entry: `id`, `domain`, `salience`, truncated summary
   - Read the cluster and decide whether it's a real cross-domain pattern
     (not just coincidental tag overlap)

3. For clusters that ARE real patterns:
   - Draft a proposed `global` semantic entry that abstracts the pattern
     (lead with the rule, then **Why:** referencing the incident sources)
   - Include `associations` linking to every source entry ID
   - Ask the user: accept / refine / reject

4. On acceptance:
   - Append the new entry to `~/.claude/memory/semantic/global.json` via
     `writeSemanticMemory('global', ...)`
   - Update `index.json` global semanticCount
   - Call `migrateEntryHotCold(entry, 'global')` to compute embedding + cold
     storage

5. Note any **anti-patterns** (clusters that look meaningful but are noise,
   e.g., everything tagged `gotcha`): mention them so the user can refine
   `tagJaccardMin` / `tokenJaccardMin` in `memo-cross.js` `DEFAULTS`.

### If `$ARGUMENTS` starts with "entities":

**Entity-surfacing reverse lookup** (MeMo-inspired) — find every memory that
mentions a specific command, path, URL, or identifier.

Two modes:

**Mode A — query lookup (when `$ARGUMENTS` is `entities <query>`):**
1. Call `lookupEntity(query)` from `~/.claude/scripts/lib/memo-entities.js`.
2. Display matching entities grouped by match mode (exact > prefix > substring):
   ```
   exact:   `flutter build apk --release` [command, 4 occurrences]
     - sem-liftlenz-002 (liftlenz)
     - sem-photospotter-014 (photospotter)
     - sem-witcraft-deploy (witcraft)
     - sem-cyrano-001 (cyrano)
   ```
3. For each occurrence, fetch the parent entry summary so the user can see
   the context, not just the ID.

**Mode B — rebuild index (when `$ARGUMENTS` is `entities rebuild`):**
1. Aggregate all semantic entries across domains.
2. Call `buildEntityIndex({ domain → entries })`.
3. Call `writeEntityIndex(index)` to persist to
   `~/.claude/memory/entity-index.json`.
4. Report stats: entryCount, entityCount, uniqueKeys.

Also re-run the rebuild automatically at the END of every `/memory consolidate`
so the index stays current with new entries.

### If `$ARGUMENTS` starts with "ask":

**Staged retrieval with ambiguity detection** (MeMo-inspired) — when a question
might match memories about multiple distinct entities, narrow before answering.

Procedure:
1. Extract the question from `$ARGUMENTS` (everything after "ask").
2. Aggregate entries from all domains, tag each with `entry._domain = domainName`.
3. Call `stagedRetrieve(allEntries, question)` from
   `~/.claude/scripts/lib/memo-staged.js`.
4. Branch on `result.status`:

   - **`confident`** — answer directly using `result.topGroup.candidates`. Show
     `result.metrics.confidence` so the user knows the basis.

   - **`ambiguous`** — DO NOT answer. Present the competing entity groups:
     ```
     Your question could mean memories about any of:
       (1) `<entityRaw>` — N entries [<top entry summary>]
       (2) `<entityRaw>` — N entries [<top entry summary>]
     ```
     Then ask `result.suggestion` ("Which one — `A` / `B`?") and wait for the
     user's clarification before answering.

   - **`empty`** — fall back to `/memory search <question>` so the user gets
     the BM25/dense view; staged retrieval over zero candidates is meaningless.

5. Always print `result.metrics` (topScore, runnerUp, confidence, groupCount)
   so the user can see WHY the branch was taken.
