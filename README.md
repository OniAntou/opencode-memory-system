# OpenCode Memory Lite

A lightweight, Markdown-based persistent memory system for AI agents. Zero database required. Provides 24 custom tools for memory management with auto-tagging, duplicate/conflict detection, structured metadata, and self-improvement capabilities.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenCode Agent                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Memory Sys  │  │ Learning Sys│  │ HTTP API Server     │ │
│  │ (17 tools)  │  │ (5 tools)   │  │ (REST endpoints)    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│         │                │                    │              │
│         ▼                ▼                    ▼              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Markdown Files                         │   │
│  │  MEMORY.md | checkpoint.md | notes.md | tasks/     │   │
│  │  corrections.md | patterns.md | learnings.md       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Features

### Core Tools (8)

| Tool | Description |
|------|-------------|
| `memory_read` | Read memory files (MEMORY.md, checkpoint.md, notes.md, tasks) |
| `memory_write` | Write content with auto-tagging and auto-detect |
| `memory_search` | Full-text search with type/tags/date filters |
| `memory_list` | List all memory files and sizes |
| `memory_consolidate` | Merge duplicate sections, remove empty sections |
| `memory_task_list` | List all task IDs and status |
| `memory_task_create` | Create new task with description |
| `memory_task_add_progress` | Add progress entry to task |

### Advanced Tools (11)

| Tool | Description |
|------|-------------|
| `memory_stats` | Memory statistics (types, importance, tags, age) |
| `memory_validate` | Validate metadata format |
| `memory_suggest_tags` | Suggest tags based on content keywords |
| `memory_dedup` | Find duplicate sections |
| `memory_share` | Share memory content across projects |
| `memory_import_shared` | Import shared memory from other projects |
| `memory_conflicts` | Detect conflicting memory entries |
| `memory_export_json` | Export all memory to JSON |
| `memory_import_json` | Import memory from JSON |
| `memory_analytics` | Usage patterns and health insights |
| `memory_notifications` | Health warnings and notifications |

### Self-Improvement Tools (5)

| Tool | Description |
|------|-------------|
| `memory_learn` | Learn from user corrections and insights |
| `memory_patterns` | Extract and manage coding patterns |
| `memory_corrections` | View and manage corrections |
| `memory_apply_learnings` | Apply learnings to improve code |
| `memory_learning_stats` | Get learning system statistics |

### Auto Features

- **Auto-tagging**: Suggests tags from content when writing (backend, flutter, database, etc.)
- **Auto-detect duplicates**: Warns if new content is >50% similar to existing sections
- **Auto-detect conflicts**: Warns if new content contradicts existing entries
- **Auto-checkpoint**: Saves session state on idle
- **Auto-archive**: Archives old checkpoints (>7 days)
- **Auto-trim**: Trims MEMORY.md when >300 lines
- **Auto-validate**: Checks metadata format on session idle
- **Auto-learn from edits**: Automatically saves corrections when user edits code
- **Auto-extract patterns**: Detects coding patterns from new files

## Installation

### Option 1: Clone repository

1. Clone this repo into `~/.opencode/`:

```bash
git clone https://github.com/OniAntou/opencode-memory-lite.git ~/.opencode
```

2. Install dependencies:

```bash
cd ~/.opencode && npm install
```

3. Restart OpenCode.

### Option 2: Install via npm

```bash
npm install opencode-memory-lite
```

Then copy the files to your `~/.opencode/` directory:

```bash
cp -r node_modules/opencode-memory-lite/tools ~/.opencode/
cp -r node_modules/opencode-memory-lite/plugins ~/.opencode/
cp -r node_modules/opencode-memory-lite/agents ~/.opencode/
cp -r node_modules/opencode-memory-lite/commands ~/.opencode/
cp -r node_modules/opencode-memory-lite/skills ~/.opencode/
```

## File Structure

```
~/.opencode/
  tools/
    memory.ts           # 17 custom tools
  plugins/
    memory-plugin.ts    # Auto-checkpoint, budgeted injection
  memory/
    MEMORY.md           # Main memory with structured metadata
    checkpoint.md       # Session state
    notes.md            # Scratch notes
    tasks/              # Task progress files
    shared/             # Cross-project shared memory
  agents/
    memory-agent.md     # Agent configuration
  commands/
    dream.md            # Extract knowledge from session
    cleanup.md          # Cleanup memory
    memory-search.md    # Search memory
    save-progress.md    # Save task progress
  skills/
    memory/
      SKILL.md          # Memory skill documentation
```

## Memory Format

Memory entries use structured metadata:

```markdown
## Section Heading
<!-- type: architecture | tags: flutter, backend | importance: high | updated: 2026-06-18 -->

Content goes here...
```

### Metadata Fields

| Field | Values | Description |
|-------|--------|-------------|
| type | architecture, decision, convention, learning, note, fix, feature | Entry type |
| tags | comma-separated | Keywords for categorization |
| importance | low, medium, high | Priority level |
| date | YYYY-MM-DD | Last updated date |

## Usage Examples

### Write with auto-tagging

```
memory_write file="MEMORY.md" type="architecture" content="Use PostgreSQL for user database"
```

Result: Auto-tags with `backend, database`

### Search with filters

```
memory_search query="flutter" type="feature" tags="mobile"
```

### Search with relevance scoring

```
memory_search query="flutter architecture" relevance_details=true
```

Result includes scoring breakdown:
```
1. [MEMORY.md] [architecture|high|flutter,mobile] (score: 85.2)
Flutter Architecture

  Scoring Breakdown:
  - TF-IDF: 42.5
  - Proximity: 30
  - Heading: 40
  - Exact Phrase: 0
  - Tag: 15
  - Metadata: 20
  - Total: 147.5
```

**Scoring Factors:**
- **TF-IDF** - Term Frequency × Inverse Document Frequency (rare terms score higher)
- **Proximity** - Bonus when search terms appear close together
- **Heading Match** - Bonus when query matches section heading
- **Exact Phrase** - Bonus for exact phrase matches
- **Tag Match** - Bonus when query matches metadata tags
- **Metadata Boost** - Importance (+20 high, +10 medium) and recency (+15 recent, -5 old)

### Check conflicts

```
memory_conflicts
```

### Get statistics

```
memory_stats
```

### Export/Import JSON

```
memory_export_json file="backup.json"
memory_import_json file="backup.json"
```

### Learning from corrections

```javascript
// Auto-learn when you edit code
// (happens automatically via plugin)

// Manual learning
memory_learn type="correction" wrong="var x = 1" correct="const x = 1" context="JavaScript"
memory_learn type="insight" content="Always use early returns" context="Code style"
memory_learn type="preference" content="Prefer functional over OOP" context="Architecture"
```

### Pattern management

```javascript
// List all patterns
memory_patterns action="list"

// Add a new pattern
memory_patterns action="add" name="Early Return" description="Use early returns for cleaner code" tags="style,clean-code"

// Search patterns
memory_patterns action="search" query="react hooks"

// Use a pattern (increments count)
memory_patterns action="use" id="abc123"
```

### Apply learnings

```javascript
// Apply learned corrections and patterns to current context
memory_apply_learnings context="React component with API calls"
```

### HTTP API

```bash
# Start server
npm start

# Health check
curl http://localhost:3000/api/health

# Read memory
curl http://localhost:3000/api/memory?file=MEMORY.md

# Search
curl "http://localhost:3000/api/memory/search?q=flutter&type=feature"

# Write
curl -X POST http://localhost:3000/api/memory/write \
  -H "Content-Type: application/json" \
  -d '{"content": "New entry", "type": "note"}'

# Statistics
curl http://localhost:3000/api/memory/stats
```

## Plugin Features

The memory plugin (`plugins/memory-plugin.ts`) provides:

- **Budgeted injection**: Limits memory injected into context (token budget)
- **Context reconstruction**: Rebuilds context during compaction
- **Task tracking**: Auto-saves progress when using bash/edit/write tools
- **Auto-validation**: Logs warnings for invalid metadata
- **Auto-learn from edits**: Automatically saves corrections when user edits code
- **Auto-extract patterns**: Detects coding patterns from new files

## Self-Improvement Features

The memory system includes self-improvement capabilities inspired by Hermes Agent:

### Learning from Corrections

When you edit code, the system automatically saves the correction:

```
# Automatic - happens when you use edit tool
# Saves: wrong → correct
```

### Manual Learning

You can also manually teach the system:

```
memory_learn type="correction" wrong="Using var" correct="Use const/let" context="JavaScript"
memory_learn type="insight" content="Always use early returns" context="Code style"
memory_learn type="preference" content="Prefer functional over OOP" context="Architecture"
```

### Pattern Management

The system extracts and manages coding patterns:

```
memory_patterns action="list"
memory_patterns action="add" name="Early Return" description="Use early returns for cleaner code"
memory_patterns action="search" query="react hooks"
memory_patterns action="use" id="abc123"
```

### Apply Learnings

Apply learned corrections and patterns to new code:

```
memory_apply_learnings context="React component with API calls"
```

### View Statistics

```
memory_learning_stats
```

## Configuration

Permissions in `opencode.json`:

```json
{
  "agent": {
    "build": {
      "permission": {
        "tool": {
          "memory_read": "allow",
          "memory_write": "allow",
          "memory_search": "allow",
          "memory_list": "allow",
          "memory_task_list": "allow",
          "memory_task_create": "allow",
          "memory_task_add_progress": "allow",
          "memory_learn": "allow",
          "memory_patterns": "allow",
          "memory_corrections": "allow",
          "memory_apply_learnings": "allow",
          "memory_learning_stats": "allow"
        }
      }
    }
  }
}
```

## HTTP API Server

The memory system includes a built-in HTTP API server for accessing memory from external tools.

### Start Server

```bash
npm start
# or
node dist/server/api.js
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |
| MEMORY_DIR | .opencode/memory | Memory directory |
| API_KEY | (empty) | API key for authentication |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Health check |
| GET | /api/memory?file=MEMORY.md | Read memory file |
| GET | /api/memory/sections | Get parsed sections |
| POST | /api/memory/write | Write to memory |
| GET | /api/memory/search?q=query | Search memory |
| GET | /api/memory/stats | Get statistics |
| POST | /api/memory/validate | Validate metadata |

### Authentication

If API_KEY is set, include in request header:

```
Authorization: Bearer YOUR_API_KEY
```

### Examples

```bash
# Health check
curl http://localhost:3000/api/health

# Read memory
curl http://localhost:3000/api/memory?file=MEMORY.md

# Search
curl "http://localhost:3000/api/memory/search?q=flutter&type=feature"

# Write
curl -X POST http://localhost:3000/api/memory/write \
  -H "Content-Type: application/json" \
  -d '{"content": "New entry", "type": "note"}'

# Statistics
curl http://localhost:3000/api/memory/stats
```

## Why OpenCode Memory Lite?

OpenCode Memory Lite is designed to be **simple, lightweight, and portable**. Here's how it compares to other memory systems:

| Feature | OpenCode Memory | Engram | Mem0 | Zep |
|---------|-----------------|--------|------|-----|
| Language | TypeScript | Go | Python | Go / Python |
| Storage | Markdown files | SQLite + FTS5 | Vector DB | PostgreSQL |
| Dependencies | 1 package | Go binary | Many | Many |
| Setup | Clone + npm install | Brew install | pip / Docker | Docker |
| Size | ~100KB | ~10MB | ~100MB | ~200MB |
| Tools | 24 | 20+ | Many | Many |
| Human-readable | Yes | No | No | No |
| Portable | Yes | No | No | No |
| Relevance scoring | Yes (TF-IDF) | Yes (BM25) | Yes (Vector) | Yes (Hybrid) |

### Strengths

- **Zero dependencies** - Only needs `@opencode-ai/plugin`
- **Human-readable** - Markdown files, open and read
- **Portable** - Copy folder and done
- **Simple** - No database, vector, or Docker required
- **Auto-detect** - Tags, duplicates, conflicts automatically
- **Relevance scoring** - TF-IDF, proximity, heading match, exact phrase, tag match
- **Self-improvement** - Auto-learns from corrections, extracts patterns

### Limitations

- **Search** - Grep-based with TF-IDF scoring, not as fast as SQLite FTS5
- **Scale** - Cannot handle thousands of entries
- **Vector search** - No semantic search (but TF-IDF + proximity scoring helps)

### When to use what?

- **OpenCode Memory Lite** - Personal projects, simple needs, lightweight
- **Engram** - Need SQLite FTS5, MCP server, cloud sync
- **Mem0** - Need vector search, semantic matching, scale
- **Zep** - Enterprise scale, PostgreSQL, advanced features

## License

MIT
