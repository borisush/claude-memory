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

4. **Extract new semantic entries** from the episode:
   - Each fact should be reusable across sessions
   - Assign salience: 1.0 critical, 0.8 high, 0.5 medium, 0.2 low
   - Tag with relevant keywords
   - Add salienceReason: bug-prevention, architecture-decision, user-preference, breakthrough, recurring-pattern, tool-knowledge
   - Link associations to related entries

5. **Merge with existing entries**: If a new fact overlaps with an existing entry, update the existing one (increment accessCount, update content if richer). Don't create duplicates.

6. **Update prospective triggers** if the session revealed something to remember for the future.

7. **Update index.json**: Increment episode count, update domain stats, update totalSemanticEntries.

8. **Regenerate MEMORY.md**: Read all semantic JSON files and regenerate the project's `MEMORY.md` as a human-readable view:
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

**Scored search**: Use `scoredSearch(entries, query)` from `~/.claude/scripts/lib/memory.js` for BM25-inspired ranked results. Search across ALL domains (load each semantic JSON file, combine entries, then search).

Also search **session fingerprints** using `searchSessionFingerprints(query)` from the same library. These are lightweight records of past sessions stored in `~/.claude/memory/sessions/`.

Display results in two sections:

**Memory Matches** (from semantic entries):
```
1. [score: 4.2] (cyrano, salience: 0.95) — NEVER use flutter install...
2. [score: 2.1] (global, salience: 0.5) — Must Read a file before Write/Edit...
```

**Session Matches** (from session fingerprints):
```
- Session 2026-02-15 (cyrano): matched keyword "flutter", files: lib/main.dart
```

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
