# OpenCode Memory System

Persistent memory system for OpenCode AI coding agent. Provides 17 custom tools for memory management with auto-tagging, duplicate/conflict detection, and structured metadata.

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

### Advanced Tools (9)

| Tool | Description |
|------|-------------|
| `memory_stats` | Memory statistics (types, importance, tags, age) |
| `memory_validate` | Validate metadata format |
| `memory_suggest_tags` | Suggest tags based on content keywords |
| `memory_dedup` | Find duplicate sections |
| `memory_conflicts` | Detect conflicting memory entries |
| `memory_export_json` | Export all memory to JSON |
| `memory_import_json` | Import memory from JSON |
| `memory_search_history` | View recent search queries |
| `memory_analytics` | Usage patterns and health insights |
| `memory_notifications` | Health warnings and notifications |

### Auto Features

- **Auto-tagging**: Suggests tags from content when writing (backend, flutter, database, etc.)
- **Auto-detect duplicates**: Warns if new content is >50% similar to existing sections
- **Auto-detect conflicts**: Warns if new content contradicts existing entries
- **Auto-checkpoint**: Saves session state on idle
- **Auto-archive**: Archives old checkpoints (>7 days)
- **Auto-trim**: Trims MEMORY.md when >300 lines
- **Auto-validate**: Checks metadata format on session idle

## Installation

1. Clone this repo into `~/.opencode/`:

```bash
git clone https://github.com/OniAntou/opencode-memory-system.git ~/.opencode
```

2. Install dependencies:

```bash
cd ~/.opencode && npm install
```

3. Restart OpenCode.

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

## Plugin Features

The memory plugin (`plugins/memory-plugin.ts`) provides:

- **Budgeted injection**: Limits memory injected into context (token budget)
- **Context reconstruction**: Rebuilds context during compaction
- **Task tracking**: Auto-saves progress when using bash/edit/write tools
- **Auto-validation**: Logs warnings for invalid metadata

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
          "memory_task_add_progress": "allow"
        }
      }
    }
  }
}
```

## License

MIT
