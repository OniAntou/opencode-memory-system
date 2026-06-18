import { tool } from "@opencode-ai/plugin"
import fs from "fs/promises"
import path from "path"
import { 
  readFileSafe, 
  writeFileSafe, 
  parseSections, 
  rebuildMemoryFile,
  parseMetadata,
  metadataToComment,
  extractTagsFromContent,
  MemoryMetadata,
  ParsedSection
} from "./memory-utils"

const MEMORY_DIR = ".opencode/memory"

// Cache for file reads
interface CacheEntry {
  content: string
  timestamp: number
}

const fileCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5000 // 5 seconds

function invalidateCache(filePath: string) {
  fileCache.delete(filePath)
}

async function readMemoryFile(relativePath: string): Promise<string> {
  const fullPath = path.join(MEMORY_DIR, relativePath)
  
  // Check cache
  const cached = fileCache.get(fullPath)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.content
  }
  
  try {
    const content = await fs.readFile(fullPath, "utf-8")
    // Update cache
    fileCache.set(fullPath, { content, timestamp: Date.now() })
    return content
  } catch {
    return ""
  }
}

async function writeMemoryFile(relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(MEMORY_DIR, relativePath)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, content, "utf-8")
  // Invalidate cache
  invalidateCache(fullPath)
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  return dp[m][n]
}

function fuzzyMatch(term: string, target: string): { matched: boolean; score: number } {
  const lowerTerm = term.toLowerCase()
  const lowerTarget = target.toLowerCase()

  if (lowerTarget.includes(lowerTerm)) {
    const index = lowerTarget.indexOf(lowerTerm)
    const score = index === 0 ? 100 : 50
    return { matched: true, score }
  }

  const words = lowerTarget.split(/\s+/)
  for (const word of words) {
    if (word === lowerTerm) return { matched: true, score: 100 }
    if (word.startsWith(lowerTerm)) return { matched: true, score: 80 }
    if (levenshteinDistance(lowerTerm, word) <= 2 && lowerTerm.length >= 3) {
      return { matched: true, score: 30 }
    }
  }

  if (lowerTarget.length >= 3 && lowerTerm.length >= 3) {
    const distance = levenshteinDistance(lowerTerm, lowerTarget.slice(0, lowerTerm.length + 2))
    if (distance <= 3) return { matched: true, score: 20 }
  }

  return { matched: false, score: 0 }
}

interface SearchResult {
  file: string
  line: number
  content: string
  score: number
  metadata: MemoryMetadata | null
}

function calculateMetadataBoost(meta: MemoryMetadata | null): number {
  if (!meta) return 0
  let boost = 0
  if (meta.importance === "high") boost += 20
  else if (meta.importance === "medium") boost += 10

  const ageDays = (Date.now() - new Date(meta.updated).getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays < 7) boost += 15
  else if (ageDays < 30) boost += 5
  else boost -= 5

  return boost
}

async function searchMemoryFiles(
  query: string,
  filters?: { type?: string; tags?: string[]; after?: string; before?: string }
): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)

  async function walkDir(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walkDir(fullPath)
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const content = await fs.readFile(fullPath, "utf-8")
          const sections = parseSections(content)

          for (const section of sections) {
            if (filters?.type && section.metadata?.type !== filters.type) continue
            if (filters?.tags?.length && section.metadata) {
              const hasTag = filters.tags.some(t => section.metadata!.tags.includes(t))
              if (!hasTag) continue
            }
            if (filters?.after && section.metadata) {
              if (new Date(section.metadata.updated) < new Date(filters.after)) continue
            }
            if (filters?.before && section.metadata) {
              if (new Date(section.metadata.updated) > new Date(filters.before)) continue
            }

            const searchText = (section.heading + " " + section.content).toLowerCase()
            let totalScore = 0
            let allMatched = true

            for (const term of terms) {
              const { matched, score } = fuzzyMatch(term, searchText)
              if (matched) {
                totalScore += score
              } else {
                allMatched = false
                break
              }
            }

            if (allMatched && terms.length > 0) {
              totalScore += calculateMetadataBoost(section.metadata)
              results.push({
                file: path.relative(MEMORY_DIR, fullPath),
                line: 0,
                content: section.heading + "\n" + section.content.trim().slice(0, 200),
                score: totalScore,
                metadata: section.metadata,
              })
            }
          }
        }
      }
    } catch {}
  }

  await walkDir(MEMORY_DIR)
  return results.sort((a, b) => b.score - a.score).slice(0, 20)
}

async function getTaskIds(): Promise<string[]> {
  const tasksDir = path.join(MEMORY_DIR, "tasks")
  const taskIds: string[] = []

  try {
    const entries = await fs.readdir(tasksDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && /^T[\d.]+$/.test(entry.name)) {
        taskIds.push(entry.name)
      }
    }
  } catch {}

  return taskIds.sort()
}

export const memory_read = tool({
  description: "Read a memory file. Files: MEMORY.md (project knowledge), checkpoint.md (session state), notes.md (scratch), tasks/{id}/progress.md (task progress)",
  args: {
    file: tool.schema.string().describe("Memory file path relative to .opencode/memory/ (e.g., 'MEMORY.md', 'checkpoint.md', 'tasks/T1/progress.md')"),
  },
  async execute(args) {
    return await readMemoryFile(args.file)
  },
})

export const memory_write = tool({
  description: `Write content to a memory file. For MEMORY.md, supports metadata format:
<!-- type: <type> | tags: <tag1>, <tag2> | importance: low|medium|high | updated: <date> -->
Types: architecture, decision, convention, learning, note, fix, feature
Use 'append' mode to add to existing content, 'overwrite' to replace.
Auto-detect: tags suggested, duplicates and conflicts checked.`,
  args: {
    file: tool.schema.string().describe("Memory file path relative to .opencode/memory/"),
    content: tool.schema.string().describe("Content to write"),
    mode: tool.schema.enum(["append", "overwrite"]).describe("Write mode").default("append"),
    type: tool.schema.string().optional().describe("Memory type (architecture, decision, convention, learning, note, fix, feature)"),
    tags: tool.schema.string().optional().describe("Comma-separated tags"),
    importance: tool.schema.enum(["low", "medium", "high"]).optional().describe("Importance level"),
  },
  async execute(args) {
    const warnings: string[] = []

    if (args.file === "MEMORY.md" && args.type) {
      // Auto-tagging: suggest tags if not provided
      let finalTags = args.tags ? args.tags.split(",").map(t => t.trim()) : []
      if (!args.tags && args.content.length > 20) {
        const suggested = suggestTags(args.content)
        if (suggested.length > 0) {
          finalTags = suggested
          warnings.push(`Auto-tagged: ${suggested.join(", ")}`)
        }
      }

      const meta: MemoryMetadata = {
        type: args.type,
        tags: finalTags,
        importance: args.importance || "medium",
        updated: new Date().toISOString().split("T")[0],
      }
      const metaComment = metadataToComment(meta)
      const fullContent = `${metaComment}\n${args.content}`

      const existing = await readMemoryFile(args.file)
      const newHeading = `## ${args.type.charAt(0).toUpperCase() + args.type.slice(1)}`

      // Auto-detect duplicates
      if (args.content.length > 30) {
        const existingSections = parseSections(existing)
        for (const section of existingSections) {
          if (section.content.trim().length < 10) continue
          const similarity = calculateSimilarity(args.content, section.content)
          if (similarity > 0.5) {
            warnings.push(`Potential duplicate of "${section.heading}" (${Math.round(similarity * 100)}% similar)`)
          }
        }
      }

      // Auto-detect conflicts
      if (args.content.length > 30) {
        const existingSections = parseSections(existing)
        const newSection: ParsedSection = { heading: newHeading, metadata: meta, content: args.content }
        for (const section of existingSections) {
          if (!section.metadata) continue
          const conflict = detectConflict(newSection, section)
          if (conflict) {
            warnings.push(`Conflict with "${section.heading}": ${conflict.reason}`)
          }
        }
      }

      if (args.mode === "overwrite") {
        await writeMemoryFile(args.file, `# Project Memory\n\n${newHeading}\n${fullContent}\n`)
      } else {
        const sections = parseSections(existing)
        const newSection: ParsedSection = {
          heading: newHeading,
          metadata: meta,
          content: args.content,
        }
        sections.push(newSection)
        await writeMemoryFile(args.file, rebuildMemoryFile(sections))
      }

      const result = `Written to ${args.file} with metadata (type: ${args.type}, importance: ${meta.importance})`
      return warnings.length > 0 ? `${result}\n\nWarnings:\n${warnings.map(w => `- ${w}`).join("\n")}` : result
    }

    if (args.mode === "overwrite") {
      await writeMemoryFile(args.file, args.content)
    } else {
      const existing = await readMemoryFile(args.file)
      const separator = existing.trim() ? "\n\n" : ""
      await writeMemoryFile(args.file, existing + separator + args.content)
    }
    return `Written to ${args.file} (${args.mode} mode)`
  },
})

export const memory_search = tool({
  description: "Search across all memory files with optional filters. Returns sections with metadata.",
  args: {
    query: tool.schema.string().describe("Search query (space-separated keywords)"),
    type: tool.schema.string().optional().describe("Filter by type (architecture, decision, convention, learning, note, fix, feature)"),
    tags: tool.schema.string().optional().describe("Filter by comma-separated tags"),
    after: tool.schema.string().optional().describe("Filter by date (YYYY-MM-DD), only show entries updated after this date"),
    before: tool.schema.string().optional().describe("Filter by date (YYYY-MM-DD), only show entries updated before this date"),
  },
  async execute(args) {
    const filters = {
      type: args.type,
      tags: args.tags ? args.tags.split(",").map(t => t.trim()) : undefined,
      after: args.after,
      before: args.before,
    }
    const results = await searchMemoryFiles(args.query, filters)

    // Record search history
    const historyFile = path.join(MEMORY_DIR, "search-history.json")
    try {
      const raw = await readMemoryFile("search-history.json")
      const history = raw.trim() ? JSON.parse(raw) : []
      history.push({ query: args.query.toLowerCase(), timestamp: new Date().toISOString(), resultCount: results.length })
      await fs.writeFile(path.join(MEMORY_DIR, "search-history.json"), JSON.stringify(history.slice(-50), null, 2), "utf-8")
    } catch {}

    if (results.length === 0) return "No results found."
    return results.map(r => {
      const meta = r.metadata ? ` [${r.metadata.type}|${r.metadata.importance}|${r.metadata.tags.join(",")}]` : ""
      return `[${r.file}]${meta}\n${r.content}`
    }).join("\n\n")
  },
})

export const memory_list = tool({
  description: "List all memory files and their sizes",
  args: {},
  async execute() {
    const files: string[] = []
    async function walk(dir: string, prefix = "") {
      try {
        const entries = await fs.readdir(path.join(MEMORY_DIR, dir), { withFileTypes: true })
        for (const entry of entries) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            await walk(entry.name, rel)
          } else if (entry.name.endsWith(".md")) {
            const stat = await fs.stat(path.join(MEMORY_DIR, rel))
            files.push(`${rel} (${stat.size} bytes, modified: ${stat.mtime.toISOString()})`)
          }
        }
      } catch {}
    }
    await walk("")
    return files.length > 0 ? files.join("\n") : "No memory files found."
  },
})

export const memory_consolidate = tool({
  description: "Consolidate MEMORY.md: merge duplicate sections, remove empty sections, reorganize by type",
  args: {},
  async execute() {
    const content = await readMemoryFile("MEMORY.md")
    if (!content.trim()) return "MEMORY.md is empty."

    const sections = parseSections(content)
    const merged = new Map<string, ParsedSection>()

    for (const section of sections) {
      const key = section.heading.toLowerCase()
      if (merged.has(key)) {
        const existing = merged.get(key)!
        existing.content += "\n\n" + section.content
        if (section.metadata && !existing.metadata) {
          existing.metadata = section.metadata
        }
      } else {
        merged.set(key, { ...section })
      }
    }

    const consolidated = Array.from(merged.values()).filter(s => s.content.trim())
    await writeMemoryFile("MEMORY.md", rebuildMemoryFile(consolidated))

    const removedCount = sections.length - consolidated.length
    return `Consolidated: merged ${sections.length} sections into ${consolidated.length}, removed ${removedCount} empty sections.`
  },
})

export const memory_task_list = tool({
  description: "List all task IDs and their status",
  args: {},
  async execute() {
    const taskIds = await getTaskIds()
    if (taskIds.length === 0) return "No tasks found."

    const tasks: string[] = []
    for (const id of taskIds) {
      const progress = await readMemoryFile(path.join("tasks", id, "progress.md"))
      const lines = progress.split("\n").filter(l => l.trim())
      const lastUpdate = lines.filter(l => l.startsWith("###")).pop() || "No updates"
      tasks.push(`${id}: ${lastUpdate.replace("### ", "")}`)
    }
    return tasks.join("\n")
  },
})

export const memory_task_create = tool({
  description: "Create a new task with initial description",
  args: {
    id: tool.schema.string().describe("Task ID (e.g., 'T1', 'T1.1')"),
    description: tool.schema.string().describe("Initial task description"),
  },
  async execute(args) {
    const taskId = args.id.toUpperCase()
    const progressFile = path.join("tasks", taskId, "progress.md")
    const timestamp = new Date().toISOString()

    const content = `# Task Progress - ${taskId}

## Created
${timestamp}

## Description
${args.description}

## Status
in_progress

### ${timestamp}
- **Action**: task_created
- **Details**: Task created with description
`

    await writeMemoryFile(progressFile, content)
    return `Task ${taskId} created successfully.`
  },
})

export const memory_task_add_progress = tool({
  description: "Add progress entry to an existing task",
  args: {
    id: tool.schema.string().describe("Task ID (e.g., 'T1', 'T1.1')"),
    action: tool.schema.string().describe("Action type (e.g., 'code_change', 'test', 'review')"),
    details: tool.schema.string().describe("Progress details"),
    status: tool.schema.enum(["in_progress", "completed", "blocked", "cancelled"]).optional().describe("Update task status"),
  },
  async execute(args) {
    const taskId = args.id.toUpperCase()
    const progressFile = path.join("tasks", taskId, "progress.md")
    const timestamp = new Date().toISOString()

    const existing = await readMemoryFile(progressFile)
    let updated = existing

    if (args.status) {
      updated = updated.replace(/## Status\n\w+/, `## Status\n${args.status}`)
    }

    const entry = `\n### ${timestamp}\n- **Action**: ${args.action}\n- **Details**: ${args.details}\n`
    updated += entry

    await writeMemoryFile(progressFile, updated)
    return `Progress added to task ${taskId}.`
  },
})

// ========== Improvement: Memory Statistics ==========

interface MemoryStats {
  totalSections: number
  byType: Record<string, number>
  byImportance: Record<string, number>
  tags: Record<string, number>
  avgAgeDays: number
  oldestEntry: string
  newestEntry: string
  filesCount: number
  totalSizeBytes: number
}

async function collectMemoryStats(): Promise<MemoryStats> {
  const stats: MemoryStats = {
    totalSections: 0,
    byType: {},
    byImportance: {},
    tags: {},
    avgAgeDays: 0,
    oldestEntry: "",
    newestEntry: "",
    filesCount: 0,
    totalSizeBytes: 0,
  }

  let totalAgeDays = 0
  let oldestDate = Date.now()
  let newestDate = 0

  async function walkDir(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walkDir(fullPath)
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const stat = await fs.stat(fullPath)
          stats.filesCount++
          stats.totalSizeBytes += stat.size

          const content = await fs.readFile(fullPath, "utf-8")
          const sections = parseSections(content)

          for (const section of sections) {
            if (!section.metadata) continue
            stats.totalSections++

            const meta = section.metadata
            stats.byType[meta.type] = (stats.byType[meta.type] || 0) + 1
            stats.byImportance[meta.importance] = (stats.byImportance[meta.importance] || 0) + 1

            for (const tag of meta.tags) {
              stats.tags[tag] = (stats.tags[tag] || 0) + 1
            }

            const updatedTime = new Date(meta.updated).getTime()
            const ageDays = (Date.now() - updatedTime) / (1000 * 60 * 60 * 24)
            totalAgeDays += ageDays

            if (updatedTime < oldestDate) {
              oldestDate = updatedTime
              stats.oldestEntry = `${section.heading} (${meta.updated})`
            }
            if (updatedTime > newestDate) {
              newestDate = updatedTime
              stats.newestEntry = `${section.heading} (${meta.updated})`
            }
          }
        }
      }
    } catch {}
  }

  await walkDir(MEMORY_DIR)
  stats.avgAgeDays = stats.totalSections > 0 ? Math.round(totalAgeDays / stats.totalSections) : 0

  return stats
}

export const memory_stats = tool({
  description: "Display memory statistics: types, importance, tags, age distribution",
  args: {},
  async execute() {
    const stats = await collectMemoryStats()

    const lines: string[] = [
      "=== Memory Statistics ===",
      "",
      `Files: ${stats.filesCount} (${stats.totalSizeBytes} bytes)`,
      `Total entries with metadata: ${stats.totalSections}`,
      `Average age: ${stats.avgAgeDays} days`,
      "",
      "--- By Type ---",
    ]

    for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${type}: ${count}`)
    }

    lines.push("", "--- By Importance ---")
    for (const [imp, count] of Object.entries(stats.byImportance).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${imp}: ${count}`)
    }

    lines.push("", "--- Top Tags ---")
    const sortedTags = Object.entries(stats.tags).sort((a, b) => b[1] - a[1]).slice(0, 15)
    for (const [tag, count] of sortedTags) {
      lines.push(`  ${tag}: ${count}`)
    }

    if (stats.oldestEntry) lines.push("", `Oldest: ${stats.oldestEntry}`)
    if (stats.newestEntry) lines.push(`Newest: ${stats.newestEntry}`)

    return lines.join("\n")
  },
})

// ========== Improvement: Memory Validation ==========

interface ValidationResult {
  file: string
  section: string
  issues: string[]
}

async function validateMemoryFile(filePath: string): Promise<ValidationResult[]> {
  const results: ValidationResult[] = []
  const content = await readMemoryFile(filePath)
  if (!content.trim()) return results

  const sections = parseSections(content)
  const validTypes = ["architecture", "decision", "convention", "learning", "note", "fix", "feature"]
  const validImportance = ["low", "medium", "high"]

  for (const section of sections) {
    const issues: string[] = []

    if (section.metadata) {
      const meta = section.metadata

      if (!validTypes.includes(meta.type)) {
        issues.push(`Invalid type: "${meta.type}". Valid: ${validTypes.join(", ")}`)
      }

      if (!validImportance.includes(meta.importance)) {
        issues.push(`Invalid importance: "${meta.importance}". Valid: ${validImportance.join(", ")}`)
      }

      if (meta.updated && isNaN(new Date(meta.updated).getTime())) {
        issues.push(`Invalid date: "${meta.updated}"`)
      }

      if (meta.tags.length === 0) {
        issues.push("No tags defined")
      }
    } else {
      issues.push("No metadata comment found")
    }

    if (section.content.trim().length === 0) {
      issues.push("Empty section content")
    }

    if (issues.length > 0) {
      results.push({ file: filePath, section: section.heading, issues })
    }
  }

  return results
}

export const memory_validate = tool({
  description: "Validate memory files: check metadata format, types, dates, and content",
  args: {
    file: tool.schema.string().optional().describe("Specific file to validate (e.g., 'MEMORY.md'). If omitted, validates all files."),
  },
  async execute(args) {
    const files = args.file ? [args.file] : ["MEMORY.md", "notes.md"]
    const allResults: ValidationResult[] = []

    for (const file of files) {
      const results = await validateMemoryFile(file)
      allResults.push(...results)
    }

    if (allResults.length === 0) {
      return "All memory files are valid. No issues found."
    }

    const lines: string[] = [`${allResults.length} issue(s) found:`]
    for (const result of allResults) {
      lines.push(`\n[${result.file}] ${result.section}:`)
      for (const issue of result.issues) {
        lines.push(`  - ${issue}`)
      }
    }

    return lines.join("\n")
  },
})

// ========== Improvement: Smart Auto-Tagging ==========

const TAG_KEYWORDS: Record<string, string[]> = {
  flutter: ["flutter", "dart", "widget", "riverpod", "app"],
  backend: ["node", "express", "prisma", "postgresql", "api", "server"],
  typescript: ["typescript", "ts", "type", "interface"],
  architecture: ["architecture", "pattern", "structure", "design"],
  ui: ["ui", "ux", "design", "theme", "style", "css", "layout"],
  testing: ["test", "jest", "vitest", "playwright", "e2e"],
  database: ["database", "db", "sql", "migration", "schema"],
  auth: ["auth", "jwt", "token", "login", "permission"],
  devops: ["docker", "ci", "cd", "deploy", "github actions"],
  memory: ["memory", "checkpoint", "session", "plugin"],
  fix: ["fix", "bug", "error", "issue", "patch"],
  performance: ["performance", "optimize", "speed", "cache", "slow"],
  security: ["security", "vulnerability", "xss", "csrf", "sanitize"],
  mobile: ["mobile", "android", "ios", "react native", "flutter"],
  api: ["api", "endpoint", "rest", "graphql", "route"],
}

function suggestTags(content: string, existingTags: string[] = []): string[] {
  const lower = content.toLowerCase()
  const suggested: Set<string> = new Set()

  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (existingTags.includes(tag)) continue
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        suggested.add(tag)
        break
      }
    }
  }

  return Array.from(suggested)
}

export const memory_suggest_tags = tool({
  description: "Suggest tags for content based on keywords",
  args: {
    content: tool.schema.string().describe("Content to analyze for tag suggestions"),
    existing_tags: tool.schema.string().optional().describe("Existing tags to exclude from suggestions (comma-separated)"),
  },
  async execute(args) {
    const existing = args.existing_tags ? args.existing_tags.split(",").map(t => t.trim()) : []
    const suggested = suggestTags(args.content, existing)

    if (suggested.length === 0) {
      return "No tag suggestions found for this content."
    }

    return `Suggested tags: ${suggested.join(", ")}`
  },
})

// ========== Improvement: Memory Deduplication ==========

function calculateSimilarity(a: string, b: string): number {
  const wordsA = a.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  const wordsB = b.toLowerCase().split(/\s+/).filter(w => w.length > 3)

  if (wordsA.length === 0 || wordsB.length === 0) return 0

  const setB = new Set(wordsB)
  let matches = 0
  for (const word of wordsA) {
    if (setB.has(word)) matches++
  }

  return matches / Math.max(wordsA.length, wordsB.length)
}

interface DuplicatePair {
  section1: string
  section2: string
  similarity: number
}

export const memory_dedup = tool({
  description: "Find duplicate or similar sections in MEMORY.md",
  args: {
    threshold: tool.schema.number().optional().describe("Similarity threshold (0-1, default 0.5). Higher = stricter matching."),
  },
  async execute(args) {
    const threshold = args.threshold ?? 0.5
    const content = await readMemoryFile("MEMORY.md")
    if (!content.trim()) return "MEMORY.md is empty."

    const sections = parseSections(content)
    const duplicates: DuplicatePair[] = []

    for (let i = 0; i < sections.length; i++) {
      for (let j = i + 1; j < sections.length; j++) {
        const similarity = calculateSimilarity(sections[i].content, sections[j].content)
        if (similarity >= threshold) {
          duplicates.push({
            section1: sections[i].heading,
            section2: sections[j].heading,
            similarity: Math.round(similarity * 100),
          })
        }
      }
    }

    if (duplicates.length === 0) {
      return "No duplicate sections found."
    }

    const lines = [`${duplicates.length} potential duplicate(s) found:`]
    for (const dup of duplicates) {
      lines.push(`  ${dup.section1} <-> ${dup.section2} (${dup.similarity}% similar)`)
    }

    return lines.join("\n")
  },
})

// ========== Improvement: Cross-Project Memory Sharing ==========

const SHARED_MEMORY_DIR = ".opencode/memory/shared"

async function ensureSharedDir(): Promise<void> {
  await fs.mkdir(SHARED_MEMORY_DIR, { recursive: true })
}

export const memory_share = tool({
  description: "Export a memory section to shared storage (cross-project)",
  args: {
    heading: tool.schema.string().describe("Section heading to export (e.g., '## Architecture')"),
    project: tool.schema.string().describe("Project name to share with"),
  },
  async execute(args) {
    const content = await readMemoryFile("MEMORY.md")
    const sections = parseSections(content)

    const targetHeading = args.heading.startsWith("## ") ? args.heading : `## ${args.heading}`
    const section = sections.find(s => s.heading === targetHeading)

    if (!section) {
      return `Section "${args.heading}" not found in MEMORY.md.`
    }

    await ensureSharedDir()
    const sharedRelativePath = path.join("shared", `${args.project}.md`)
    const existing = await readMemoryFile(sharedRelativePath)

    const metaComment = section.metadata ? metadataToComment(section.metadata) : ""
    const entry = `\n\n${section.heading}\n${metaComment}\n${section.content.trim()}\n`

    await writeMemoryFile(sharedRelativePath, existing + entry)
    return `Shared "${args.heading}" to project "${args.project}".`
  },
})

export const memory_import_shared = tool({
  description: "Import shared memory from another project",
  args: {
    project: tool.schema.string().describe("Project name to import from"),
  },
  async execute(args) {
    const sharedRelativePath = path.join("shared", `${args.project}.md`)
    const sharedContent = await readMemoryFile(sharedRelativePath)

    if (!sharedContent.trim()) {
      return `No shared memory found for project "${args.project}".`
    }

    const existing = await readMemoryFile("MEMORY.md")
    const separator = existing.trim() ? "\n\n" : ""
    await writeMemoryFile("MEMORY.md", existing + separator + `\n---\n# Imported from: ${args.project}\n` + sharedContent)

    return `Imported shared memory from project "${args.project}".`
  },
})

// ========== Improvement: Memory Conflict Detection ==========

const CONFLICT_KEYWORDS: Record<string, string[]> = {
  "replace": ["replace", "thay thế", "chuyển sang", "dùng lại", "upgrade", "downgrade"],
  "remove": ["remove", "xóa", "bỏ", "loại bỏ", "delete", "drop"],
  "change": ["change", "thay đổi", "sửa", "cập nhật", "modify", "update"],
  "not_use": ["không dùng", "not use", "avoid", "tránh", "không nên"],
}

interface ConflictPair {
  section1: string
  section2: string
  type: "contradicts" | "supersedes" | "outdated"
  reason: string
}

function detectConflict(a: ParsedSection, b: ParsedSection): ConflictPair | null {
  if (!a.metadata || !b.metadata) return null

  const contentA = a.content.toLowerCase()
  const contentB = b.content.toLowerCase()

  // Check for contradiction keywords
  for (const [conflictType, keywords] of Object.entries(CONFLICT_KEYWORDS)) {
    for (const keyword of keywords) {
      const aHasKeyword = contentA.includes(keyword)
      const bHasKeyword = contentB.includes(keyword)

      if (aHasKeyword && bHasKeyword) {
        // Check if they talk about similar topics
        const wordsA = contentA.split(/\s+/).filter(w => w.length > 4)
        const wordsB = contentB.split(/\s+/).filter(w => w.length > 4)
        const setB = new Set(wordsB)
        const overlap = wordsA.filter(w => setB.has(w)).length
        const similarity = overlap / Math.max(wordsA.length, wordsB.length)

        if (similarity > 0.2) {
          return {
            section1: a.heading,
            section2: b.heading,
            type: conflictType === "replace" ? "supersedes" : conflictType === "remove" ? "outdated" : "contradicts",
            reason: `Both sections contain "${keyword}" and share ${Math.round(similarity * 100)}% vocabulary overlap`,
          }
        }
      }
    }
  }

  return null
}

export const memory_conflicts = tool({
  description: "Detect conflicting or contradictory memory entries",
  args: {
    file: tool.schema.string().optional().describe("File to check (default: MEMORY.md)"),
  },
  async execute(args) {
    const content = await readMemoryFile(args.file || "MEMORY.md")
    if (!content.trim()) return "No memory to analyze."

    const sections = parseSections(content)
    const conflicts: ConflictPair[] = []

    for (let i = 0; i < sections.length; i++) {
      for (let j = i + 1; j < sections.length; j++) {
        const conflict = detectConflict(sections[i], sections[j])
        if (conflict) conflicts.push(conflict)
      }
    }

    if (conflicts.length === 0) {
      return "No conflicts detected. All memory entries are consistent."
    }

    const lines = [`${conflicts.length} conflict(s) detected:`]
    for (const conflict of conflicts) {
      lines.push(`\n  ${conflict.section1} <-> ${conflict.section2}`)
      lines.push(`  Type: ${conflict.type}`)
      lines.push(`  Reason: ${conflict.reason}`)
    }

    return lines.join("\n")
  },
})

// ========== Improvement: Memory Export/Import JSON ==========

interface MemoryExport {
  version: number
  timestamp: string
  files: Record<string, string>
}

export const memory_export_json = tool({
  description: "Export all memory files to JSON format",
  args: {
    file: tool.schema.string().optional().describe("Export file path (default: memory-export.json)"),
  },
  async execute(args) {
    const exportData: MemoryExport = {
      version: 1,
      timestamp: new Date().toISOString(),
      files: {},
    }

    const files = ["MEMORY.md", "checkpoint.md", "notes.md"]
    for (const file of files) {
      const content = await readMemoryFile(file)
      if (content.trim()) {
        exportData.files[file] = content
      }
    }

    // Export tasks
    const tasksDir = path.join(MEMORY_DIR, "tasks")
    try {
      const entries = await fs.readdir(tasksDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && /^T[\d.]+$/.test(entry.name)) {
          const taskContent = await readMemoryFile(path.join("tasks", entry.name, "progress.md"))
          if (taskContent.trim()) {
            exportData.files[`tasks/${entry.name}/progress.md`] = taskContent
          }
        }
      }
    } catch {}

    const exportPath = args.file || "memory-export.json"
    const fullPath = path.join(MEMORY_DIR, exportPath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, JSON.stringify(exportData, null, 2), "utf-8")

    return `Exported ${Object.keys(exportData.files).length} files to ${exportPath}`
  },
})

export const memory_import_json = tool({
  description: "Import memory from JSON export file",
  args: {
    file: tool.schema.string().describe("JSON file path to import from"),
  },
  async execute(args) {
    try {
      const fullPath = path.join(MEMORY_DIR, args.file)
      const raw = await fs.readFile(fullPath, "utf-8")
      const importData: MemoryExport = JSON.parse(raw)

      if (!importData.files || typeof importData.files !== "object") {
        return "Invalid export format: missing 'files' object."
      }

      let imported = 0
      for (const [file, content] of Object.entries(importData.files)) {
        if (typeof content === "string" && content.trim()) {
          await writeMemoryFile(file, content)
          imported++
        }
      }

      return `Imported ${imported} files from ${args.file} (exported: ${importData.timestamp})`
    } catch (e) {
      return `Import failed: ${e instanceof Error ? e.message : "Unknown error"}`
    }
  },
})

// ========== Improvement: Memory Search History ==========

const SEARCH_HISTORY_FILE = ".opencode/memory/search-history.json"

interface SearchHistoryEntry {
  query: string
  timestamp: string
  resultCount: number
}

async function loadSearchHistory(): Promise<SearchHistoryEntry[]> {
  try {
    const raw = await fs.readFile(path.join(MEMORY_DIR, "search-history.json"), "utf-8")
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function saveSearchHistory(history: SearchHistoryEntry[]): Promise<void> {
  // Keep only last 50 entries
  const trimmed = history.slice(-50)
  await fs.writeFile(path.join(MEMORY_DIR, "search-history.json"), JSON.stringify(trimmed, null, 2), "utf-8")
}

async function recordSearch(query: string, resultCount: number): Promise<void> {
  const history = await loadSearchHistory()
  history.push({
    query: query.toLowerCase(),
    timestamp: new Date().toISOString(),
    resultCount,
  })
  await saveSearchHistory(history)
}

export const memory_search_history = tool({
  description: "View recent search history",
  args: {
    limit: tool.schema.number().optional().describe("Number of recent searches to show (default: 10)"),
  },
  async execute(args) {
    const history = await loadSearchHistory()
    const limit = args.limit || 10
    const recent = history.slice(-limit).reverse()

    if (recent.length === 0) {
      return "No search history found."
    }

    const lines = [`Last ${recent.length} searches:`]
    for (const entry of recent) {
      const time = new Date(entry.timestamp).toLocaleTimeString()
      lines.push(`  [${time}] "${entry.query}" → ${entry.resultCount} results`)
    }

    return lines.join("\n")
  },
})

// ========== Improvement: Memory Analytics ==========

export const memory_analytics = tool({
  description: "Analyze memory usage patterns and provide insights",
  args: {},
  async execute() {
    const stats = await collectMemoryStats()
    const history = await loadSearchHistory()

    const lines: string[] = ["=== Memory Analytics ===", ""]

    // Usage patterns
    lines.push("--- Type Distribution ---")
    const totalEntries = Object.values(stats.byType).reduce((a, b) => a + b, 0)
    for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
      const pct = Math.round((count / totalEntries) * 100)
      const bar = "█".repeat(Math.round(pct / 5))
      lines.push(`  ${type.padEnd(15)} ${bar} ${pct}% (${count})`)
    }

    // Importance distribution
    lines.push("", "--- Importance Distribution ---")
    for (const [imp, count] of Object.entries(stats.byImportance).sort((a, b) => b[1] - a[1])) {
      const pct = Math.round((count / totalEntries) * 100)
      const bar = "█".repeat(Math.round(pct / 5))
      lines.push(`  ${imp.padEnd(10)} ${bar} ${pct}% (${count})`)
    }

    // Top tags
    lines.push("", "--- Most Used Tags ---")
    const sortedTags = Object.entries(stats.tags).sort((a, b) => b[1] - a[1]).slice(0, 10)
    for (const [tag, count] of sortedTags) {
      lines.push(`  #${tag}: ${count}`)
    }

    // Search patterns
    if (history.length > 0) {
      lines.push("", "--- Search Patterns ---")
      const queryCounts: Record<string, number> = {}
      for (const entry of history) {
        const words = entry.query.split(/\s+/)
        for (const word of words) {
          if (word.length > 3) {
            queryCounts[word] = (queryCounts[word] || 0) + 1
          }
        }
      }
      const topQueries = Object.entries(queryCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
      for (const [query, count] of topQueries) {
        lines.push(`  "${query}": searched ${count} times`)
      }
    }

    // Health insights
    lines.push("", "--- Health Insights ---")
    if (stats.avgAgeDays > 30) {
      lines.push("  ⚠ Memory is getting old. Consider reviewing outdated entries.")
    }
    if (Object.keys(stats.tags).length < 5) {
      lines.push("  ⚠ Few tags used. Add more tags for better organization.")
    }
    if (stats.totalSections > 50) {
      lines.push("  ⚠ Many entries. Consider consolidating similar sections.")
    }
    if (stats.byImportance["high"] > stats.byImportance["low"] * 3) {
      lines.push("  ⚠ Too many high-importance entries. Consider downgrading some.")
    }
    if (lines.length === 14) {
      lines.push("  ✓ Memory looks healthy!")
    }

    return lines.join("\n")
  },
})

// ========== Improvement: Memory Notifications ==========

const MEMORY_SIZE_WARNING_THRESHOLD = 50000 // 50KB
const MEMORY_ENTRIES_WARNING_THRESHOLD = 100

export const memory_notifications = tool({
  description: "Check memory health and show notifications/warnings",
  args: {},
  async execute() {
    const notifications: { level: "info" | "warning" | "critical"; message: string }[] = []

    // Check file sizes
    const files = ["MEMORY.md", "checkpoint.md", "notes.md"]
    for (const file of files) {
      const content = await readMemoryFile(file)
      if (content.length > MEMORY_SIZE_WARNING_THRESHOLD) {
        notifications.push({
          level: "warning",
          message: `${file} is large (${Math.round(content.length / 1024)}KB). Consider trimming.`,
        })
      }
    }

    // Check entry count
    const stats = await collectMemoryStats()
    if (stats.totalSections > MEMORY_ENTRIES_WARNING_THRESHOLD) {
      notifications.push({
        level: "warning",
        message: `${stats.totalSections} entries found. Consider consolidating.`,
      })
    }

    // Check for old entries
    if (stats.avgAgeDays > 60) {
      notifications.push({
        level: "info",
        message: `Average entry age is ${stats.avgAgeDays} days. Review old entries.`,
      })
    }

    // Check for entries without tags
    const content = await readMemoryFile("MEMORY.md")
    const sections = parseSections(content)
    const noTagSections = sections.filter(s => s.metadata && s.metadata.tags.length === 0)
    if (noTagSections.length > 0) {
      notifications.push({
        level: "info",
        message: `${noTagSections.length} entries have no tags.`,
      })
    }

    // Check for conflicts
    const conflicts: ConflictPair[] = []
    for (let i = 0; i < sections.length; i++) {
      for (let j = i + 1; j < sections.length; j++) {
        const conflict = detectConflict(sections[i], sections[j])
        if (conflict) conflicts.push(conflict)
      }
    }
    if (conflicts.length > 0) {
      notifications.push({
        level: "warning",
        message: `${conflicts.length} potential conflict(s) detected.`,
      })
    }

    if (notifications.length === 0) {
      return "✓ No notifications. Memory is healthy!"
    }

    const lines = [`${notifications.length} notification(s):`]
    for (const notif of notifications) {
      const icon = notif.level === "critical" ? "🔴" : notif.level === "warning" ? "🟡" : "🔵"
      lines.push(`  ${icon} ${notif.message}`)
    }

    return lines.join("\n")
  },
})
