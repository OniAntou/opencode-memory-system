import type { Plugin } from "@opencode-ai/plugin"
import fs from "fs/promises"
import path from "path"
import { parseMetadata, parseSections, metadataToComment, type MemoryMetadata, type ParsedSection } from '../tools/memory-utils'
import { readMemoryFile, writeMemoryFile } from '../tools/memory-io'
import { suggestTags } from '../tools/memory-analysis-utils'
import { validateMemoryFile } from '../tools/memory-analytics'

const MAX_MEMORY_LINES = 300
const ARCHIVE_DAYS = 7
const NOTES_MAX_AGE_DAYS = 3

const TOKEN_BUDGET = {
  checkpoint: 800,
  memory: 1500,
  notes: 400,
  tasks: 300,
}

const PRIORITY_SECTIONS = ["## Architecture", "## Decisions", "## Conventions", "## Learnings"]

// Auto-tagging keywords
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

function splitIntoSections(content: string): string[] {
  const sections: string[] = []
  let current = ""

  for (const line of content.split("\n")) {
    if (line.startsWith("## ") && current.trim()) {
      sections.push(current.trim())
      current = line + "\n"
    } else {
      current += line + "\n"
    }
  }
  if (current.trim()) sections.push(current.trim())

  return sections
}

function truncateByChars(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content
  return content.slice(0, maxChars - 3) + "..."
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function getTimestamp(): string {
  return new Date().toISOString()
}


function calculateMetadataScore(meta: MemoryMetadata | null): number {
  if (!meta) return 50

  let score = 50

  if (meta.importance === "high") score += 20
  else if (meta.importance === "medium") score += 10

  const ageDays = (Date.now() - new Date(meta.updated).getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays < 7) score += 15
  else if (ageDays < 30) score += 5
  else score -= 5

  if (["architecture", "decision"].includes(meta.type)) score += 10
  else if (["learning", "convention"].includes(meta.type)) score += 5

  return score
}

function rankMemorySection(section: string, type: "checkpoint" | "memory" | "notes" | "tasks"): number {
  let score = 50

  if (type === "checkpoint") score = 90
  else if (type === "tasks") score = 80
  else if (type === "memory") {
    if (PRIORITY_SECTIONS.some(p => section.startsWith(p))) score = 85
    else if (section.startsWith("## Learnings")) score = 75
    else score = 60
  }
  else if (type === "notes") score = 40

  if (section.includes("Important") || section.includes("CRITICAL")) score += 10
  if (section.includes("TODO") || section.includes("FIXME")) score += 5

  return score
}



async function saveTaskProgress(taskId: string, action: string, details: string): Promise<void> {
  const relPath = path.join("tasks", taskId, "progress.md")
  const existing = await readMemoryFile(relPath)
  const timestamp = getTimestamp()

  const entry = `\n### ${timestamp}\n- **Action**: ${action}\n- **Details**: ${details}\n`

  const header = existing.includes("# Task Progress")
    ? ""
    : `# Task Progress - ${taskId}\n\n## Created\n${timestamp}\n\n## Status\nin_progress\n`

  await writeMemoryFile(relPath, header + existing + entry)
}

async function getActiveTasks(): Promise<{ id: string; content: string; modified: Date }[]> {
  const tasks: { id: string; content: string; modified: Date }[] = []
  const tasksDir = path.join(process.cwd(), ".opencode/memory", "tasks")

  try {
    const entries = await fs.readdir(tasksDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && /^T[\d.]+$/.test(entry.name)) {
        const relPath = path.join("tasks", entry.name, "progress.md")
        const progressFile = path.join(tasksDir, entry.name, "progress.md")
        const stat = await fs.stat(progressFile).catch(() => null)
        if (stat) {
          const content = await readMemoryFile(relPath)
          tasks.push({ id: entry.name, content, modified: stat.mtime })
        }
      }
    }
  } catch {}

  return tasks.sort((a, b) => b.modified.getTime() - a.modified.getTime())
}

async function getActiveTask(): Promise<string> {
  const checkpoint = await readMemoryFile("checkpoint.md")
  const match = checkpoint.match(/## Active Task\n(.+?)(?:\n|$)/)
  return match ? match[1].trim() : "None"
}

async function saveCheckpoint(sessionID?: string): Promise<void> {
  const activeTask = await getActiveTask()
  const timestamp = getTimestamp()

  const content = `# Session Checkpoint

## Last Updated
${timestamp}

## Active Task
${activeTask}

## Session ID
${sessionID || "unknown"}

## Context
Auto-saved checkpoint. Use /dream to extract persistent knowledge.
`

  await writeMemoryFile("checkpoint.md", content)
}

async function archiveOldSessions(): Promise<void> {
  const archiveDir = "archive"
  const now = Date.now()
  const cutoffDays = ARCHIVE_DAYS * 24 * 60 * 60 * 1000

  try {
    const checkpoint = await readMemoryFile("checkpoint.md")
    const lastUpdatedMatch = checkpoint.match(/## Last Updated\n(.+?)(?:\n|$)/)
    if (!lastUpdatedMatch) return

    const lastUpdated = new Date(lastUpdatedMatch[1].trim()).getTime()
    if (now - lastUpdated > cutoffDays) {
      const date = new Date(lastUpdated)
      const monthDir = path.join(archiveDir, `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`)
      // writeMemoryFile automatically creates directories if they don't exist

      const archiveFile = path.join(monthDir, `checkpoint-${date.toISOString().split("T")[0]}.md`)
      await writeMemoryFile(archiveFile, checkpoint)
    }
  } catch {}
}

async function checkMemorySize(): Promise<{ totalLines: number; totalChars: number }> {
  const files = ["MEMORY.md", "checkpoint.md", "notes.md"]
  let totalLines = 0
  let totalChars = 0

  for (const file of files) {
    const content = await readMemoryFile(file)
    totalLines += content.split("\n").length
    totalChars += content.length
  }

  return { totalLines, totalChars }
}

async function trimMemoryIfNeeded(): Promise<{ trimmed: boolean; linesRemoved: number }> {
  const content = await readMemoryFile("MEMORY.md")
  if (!content.trim()) return { trimmed: false, linesRemoved: 0 }

  const lines = content.split("\n")
  if (lines.length <= MAX_MEMORY_LINES) return { trimmed: false, linesRemoved: 0 }

  const sections = parseSections(content)

  const preserved: ParsedSection[] = []
  let removedLines = 0

  for (const section of sections) {
    const isPriority = PRIORITY_SECTIONS.some(p => section.heading.startsWith(p))
    if (isPriority || preserved.length < 5) {
      preserved.push(section)
    } else {
      removedLines += section.content.split("\n").length + 2
    }
  }

  const trimmed = preserved.map(s => {
    const metaComment = s.metadata ? metadataToComment(s.metadata) : ""
    return `${s.heading}\n${metaComment}\n${s.content.trim()}`
  }).join("\n\n")

  await writeMemoryFile("MEMORY.md", "# Project Memory\n\n" + trimmed + "\n")

  return { trimmed: true, linesRemoved: removedLines }
}

async function clearOldNotes(): Promise<{ cleared: boolean }> {
  const content = await readMemoryFile("notes.md")
  if (!content.trim()) return { cleared: false }

  const dateMatch = content.match(/<!-- Last updated: (.+?) -->/)
  if (!dateMatch) {
    const now = new Date()
    const updated = `<!-- Last updated: ${now.toISOString()} -->\n${content}`
    await writeMemoryFile("notes.md", updated)
    return { cleared: false }
  }

  const lastUpdated = new Date(dateMatch[1]).getTime()
  const now = Date.now()
  const ageDays = (now - lastUpdated) / (1000 * 60 * 60 * 24)

  if (ageDays > NOTES_MAX_AGE_DAYS) {
    await writeMemoryFile("notes.md", `<!-- Last updated: ${new Date().toISOString()} -->\n<!-- Notes cleared: older than ${NOTES_MAX_AGE_DAYS} days -->\n`)
    return { cleared: true }
  }

  return { cleared: false }
}

interface RankedSection {
  content: string
  score: number
  type: "checkpoint" | "memory" | "notes" | "tasks"
}

async function loadMemoryContentBudgeted(): Promise<string> {
  const checkpointContent = await readMemoryFile("checkpoint.md")
  const memoryContent = await readMemoryFile("MEMORY.md")
  const notesContent = await readMemoryFile("notes.md")
  const activeTasks = await getActiveTasks()

  const allSections: RankedSection[] = []

  if (checkpointContent.trim()) {
    allSections.push({ content: checkpointContent, score: 90, type: "checkpoint" })
  }

  for (const section of splitIntoSections(memoryContent)) {
    const sections = parseSections(section)
    let baseScore = rankMemorySection(section, "memory")

    for (const parsed of sections) {
      const metaScore = calculateMetadataScore(parsed.metadata)
      baseScore = Math.max(baseScore, metaScore)
    }

    allSections.push({ content: section, score: baseScore, type: "memory" })
  }

  for (const task of activeTasks.slice(0, 3)) {
    const truncated = truncateByChars(task.content, 300)
    allSections.push({ content: `[Task ${task.id}]\n${truncated}`, score: 80, type: "tasks" })
  }

  if (notesContent.trim()) {
    allSections.push({ content: notesContent, score: 40, type: "notes" })
  }

  allSections.sort((a, b) => b.score - a.score)

  const result: string[] = []
  let totalTokens = 0
  const maxTokens = TOKEN_BUDGET.checkpoint + TOKEN_BUDGET.memory + TOKEN_BUDGET.notes + TOKEN_BUDGET.tasks

  for (const section of allSections) {
    const tokens = estimateTokens(section.content)
    if (totalTokens + tokens <= maxTokens) {
      result.push(section.content)
      totalTokens += tokens
    }
  }

  return result.join("\n\n")
}

async function reconstructContext(retainedMessages: string[]): Promise<string> {
  const checkpointContent = await readMemoryFile("checkpoint.md")
  const memoryContent = await readMemoryFile("MEMORY.md")
  const activeTasks = await getActiveTasks()

  const parts: string[] = []

  if (checkpointContent.trim()) {
    parts.push(`## Session State (Reconstructed)\n${truncateByChars(checkpointContent, 600)}`)
  }

  if (memoryContent.trim()) {
    const sections = parseSections(memoryContent)
    const prioritySections = sections
      .filter(s => PRIORITY_SECTIONS.some(p => s.heading.startsWith(p)))
      .map(s => {
        const meta = s.metadata ? ` [${s.metadata.type}|${s.metadata.importance}]` : ""
        return `${s.heading}${meta}\n${s.content.trim()}`
      })
      .join("\n\n")
    if (prioritySections) {
      parts.push(`## Key Knowledge\n${truncateByChars(prioritySections, 800)}`)
    }
  }

  if (activeTasks.length > 0) {
    const taskSummary = activeTasks
      .slice(0, 3)
      .map(t => `- ${t.id}: ${truncateByChars(t.content.split("\n").slice(0, 3).join(" "), 100)}`)
      .join("\n")
    parts.push(`## Active Tasks\n${taskSummary}`)
  }

  if (retainedMessages.length > 0) {
    const recent = retainedMessages.slice(-5).join("\n")
    parts.push(`## Recent Context\n${truncateByChars(recent, 400)}`)
  }

  return parts.join("\n\n")
}

export const MemoryPlugin: Plugin = async ({ project, client, directory, worktree }) => {
  await client.app.log({
    body: {
      service: "memory-plugin",
      level: "info",
      message: "MemoryPlugin v2 initialized with structured metadata, budgeted injection, and context reconstruction",
    },
  })

  let currentTaskId: string | null = null

  return {
    "experimental.chat.system.transform": async (input, output) => {
      const content = await loadMemoryContentBudgeted()
      if (content.trim()) {
        output.system.push(content)
      }

      if (currentTaskId) {
        const taskProgress = await readMemoryFile(path.join("tasks", currentTaskId, "progress.md"))
        if (taskProgress.trim()) {
          output.system.push(`## Current Task: ${currentTaskId}\n${truncateByChars(taskProgress, 500)}`)
        }
      }
    },

    "experimental.session.compacting": async (input, output) => {
      await saveCheckpoint(input.sessionID)

      const retained = (input as any).messages
        ?.filter((m: any) => m.role === "user" || m.role === "assistant")
        .slice(-10)
        .map((m: any) => m.content?.toString() || "") || []

      const reconstructed = await reconstructContext(retained)
      if (reconstructed.trim()) {
        output.context.push(reconstructed)
      }
    },

    "tool.execute.after": async (input, output) => {
      const toolName = input.tool

      // Record search history
      if (toolName === "memory_search") {
        const args = input.args as Record<string, unknown>
        const query = String(args.query || "")
        const resultCount = typeof (output as any).result === "string" ? ((output as any).result.match(/\n/g)?.length || 0) : 0
        const historyFile = path.join(process.cwd(), ".opencode/memory", "search-history.json")
        try {
          const raw = await readMemoryFile("search-history.json")
          const history = raw.trim() ? JSON.parse(raw) : []
          history.push({ query: query.toLowerCase(), timestamp: new Date().toISOString(), resultCount })
          await writeMemoryFile("search-history.json", JSON.stringify(history.slice(-50), null, 2))
        } catch {}
      }

      // Auto-learn from edit operations (user correcting code)
      if (["edit", "replace_file_content", "multi_replace_file_content"].includes(toolName)) {
        const args = input.args as Record<string, unknown>
        const filePath = String(args.filePath || args.file || args.TargetFile || "")
        
        let wrong = String(args.oldString || args.TargetContent || "")
        let correct = String(args.newString || args.ReplacementContent || "")
        
        if (!wrong && !correct && Array.isArray(args.ReplacementChunks) && args.ReplacementChunks.length > 0) {
          wrong = String(args.ReplacementChunks[0].TargetContent || "")
          correct = String(args.ReplacementChunks[0].ReplacementContent || "")
        }

        if (wrong && correct && wrong !== correct) {
          const correctionsFile = "corrections.md"
          const existing = await readMemoryFile(correctionsFile)
          
          // Deduplication check
          const signature = correct.slice(0, 100).trim()
          let isDuplicate = false;
          if (signature.length > 20 && existing.includes(signature)) {
            isDuplicate = true;
          }

          if (!isDuplicate) {
            const correctionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
            const timestamp = new Date().toISOString()
            const tags = suggestTags(correct)
            const contextInfo = currentTaskId ? `Task: ${currentTaskId} | File: ${filePath}` : `File: ${filePath}`

            const lines = existing.trim() ? existing.split("\n") : ["# Corrections", ""]
            lines.push(`## [${correctionId}]`)
            lines.push(`<!-- timestamp: ${timestamp} | category: code | count: 1 | tags: ${tags.join(", ")} -->`)
            lines.push(`**Context**: ${contextInfo}`)
            lines.push(`**Wrong**: ${wrong.slice(0, 200)}`)
            lines.push(`**Correct**: ${correct.slice(0, 200)}`)
            lines.push("")

            await writeMemoryFile(correctionsFile, lines.join("\n"))

            await client.app.log({
              body: {
                service: "memory-plugin",
                level: "info",
                message: `Auto-learned correction from ${toolName} in ${filePath}`,
              },
            })
          }
        }
      }

      // Auto-learn from write operations (new patterns)
      if (["write", "write_to_file"].includes(toolName)) {
        const args = input.args as Record<string, unknown>
        const filePath = String(args.filePath || args.file || args.TargetFile || "")
        const content = String(args.content || args.CodeContent || "")

        if (content.length > 100) {
          const skipExts = ['.json', '.lock', '.log', '.test.ts', '.spec.ts', '.d.ts', '.map', '.config.ts', '.config.js']
          const skipDirs = ['node_modules', 'dist', '.git', 'coverage']
          
          let shouldSkip = false;
          if (skipExts.some(ext => filePath.endsWith(ext))) shouldSkip = true;
          if (skipDirs.some(dir => filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`) || filePath.startsWith(`${dir}/`) || filePath.startsWith(`${dir}\\`))) shouldSkip = true;
          
          if (!shouldSkip) {
            const patternsFile = "patterns.md"
            const existing = await readMemoryFile(patternsFile)
            
            // Deduplication
            const signature = content.slice(0, 150).trim()
            let isDuplicate = false;
            if (signature.length > 30 && existing.includes(signature)) {
               isDuplicate = true;
            }

            if (!isDuplicate) {
              const tags = suggestTags(content)
              if (tags.length > 0) {
                const patternId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
                const lines = existing.trim() ? existing.split("\n") : ["# Patterns", ""]

                lines.push(`## [${patternId}]`)
                lines.push(`<!-- name: Pattern from ${path.basename(filePath)} | count: 1 | lastUsed: ${new Date().toISOString()} | tags: ${tags.join(", ")} -->`)
                lines.push(`**Description**: Auto-detected pattern from ${filePath}`)
                if (currentTaskId) lines.push(`**Task**: ${currentTaskId}`)
                lines.push(`**Example**: ${content.slice(0, 200)}...`)
                lines.push("")

                await writeMemoryFile(patternsFile, lines.join("\n"))
              }
            }
          }
        }
      }

      if (["bash", "run_command", "edit", "replace_file_content", "multi_replace_file_content", "write", "write_to_file"].includes(toolName)) {
        if (currentTaskId) {
          const args = input.args as Record<string, unknown>
          let details = ""

          if (["bash", "run_command"].includes(toolName)) {
            details = `Command: ${String(args.command || args.CommandLine).slice(0, 100)}`
          } else if (["edit", "replace_file_content", "multi_replace_file_content"].includes(toolName)) {
            details = `Edited: ${String(args.filePath || args.file || args.TargetFile)}`
          } else if (["write", "write_to_file"].includes(toolName)) {
            details = `Wrote: ${String(args.filePath || args.file || args.TargetFile)}`
          }

          await saveTaskProgress(currentTaskId, toolName, details)
        }
      }
    },

    "command.execute.before": async (input) => {
      if (input.command === "task") {
        const args = (input as any).arguments?.split(' ') || []
        if (args && args[0]) {
          currentTaskId = args[0].toUpperCase()
          await client.app.log({
            body: {
              service: "memory-plugin",
              level: "info",
              message: `Active task set to: ${currentTaskId}`,
            },
          })
        }
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await saveCheckpoint(event.properties.sessionID)
        await archiveOldSessions()

        const size = await checkMemorySize()
        if (size.totalLines > MAX_MEMORY_LINES) {
          const result = await trimMemoryIfNeeded()
          if (result.trimmed) {
            await client.app.log({
              body: {
                service: "memory-plugin",
                level: "info",
                message: `Auto-trimmed MEMORY.md: removed ${result.linesRemoved} lines.`,
              },
            })
          }
        }

        const notesResult = await clearOldNotes()
        if (notesResult.cleared) {
          await client.app.log({
            body: {
              service: "memory-plugin",
              level: "info",
              message: "Auto-cleared old notes.md.",
            },
          })
        }

        // Auto-validate memory files
        const validationResults = await validateMemoryFile("MEMORY.md")
        if (validationResults.length > 0) {
          const issues = validationResults.flatMap(r => r.issues).length
          await client.app.log({
            body: {
              service: "memory-plugin",
              level: "warn",
              message: `Memory validation: ${issues} issue(s) found in ${validationResults.length} section(s).`,
            },
          })
        }

        // Auto-check memory size and warn if large
        const memoryContent = await readMemoryFile("MEMORY.md")
        if (memoryContent.length > 50000) {
          await client.app.log({
            body: {
              service: "memory-plugin",
              level: "warn",
              message: `MEMORY.md is large (${Math.round(memoryContent.length / 1024)}KB). Consider consolidating.`,
            },
          })
        }
      }

      if (event.type === "session.created") {
        currentTaskId = null
      }
    },
  }
}
