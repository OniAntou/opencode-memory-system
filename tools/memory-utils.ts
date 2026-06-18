import fs from 'fs/promises'
import path from 'path'

const MEMORY_DIR = process.env.MEMORY_DIR || '.opencode/memory'

// Types
export interface MemoryMetadata {
  type: string
  tags: string[]
  importance: 'low' | 'medium' | 'high'
  updated: string
}

export interface ParsedSection {
  heading: string
  metadata: MemoryMetadata | null
  content: string
}

// File helpers
export async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return ''
  }
}

export async function writeFileSafe(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// Parse metadata from comment
export function parseMetadata(comment: string): MemoryMetadata | null {
  const match = comment.match(/<!--\s*type:\s*(.+?)\s*\|/)
  if (!match) return null

  const type = match[1].trim()
  const tagsMatch = comment.match(/tags:\s*(.+?)\s*\|/)
  const importanceMatch = comment.match(/importance:\s*(low|medium|high)\s*\|/)
  const updatedMatch = comment.match(/updated:\s*(.+?)\s*-->/)

  return {
    type,
    tags: tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [],
    importance: importanceMatch ? (importanceMatch[1] as MemoryMetadata['importance']) : 'medium',
    updated: updatedMatch ? updatedMatch[1].trim() : new Date().toISOString().split('T')[0],
  }
}

// Convert metadata to comment
export function metadataToComment(meta: MemoryMetadata): string {
  return `<!-- type: ${meta.type} | tags: ${meta.tags.join(', ')} | importance: ${meta.importance} | updated: ${meta.updated} -->`
}

// Parse sections from markdown
export function parseSections(content: string): ParsedSection[] {
  const sections: ParsedSection[] = []
  const lines = content.split('\n')
  let current: ParsedSection | null = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current)
      current = { heading: line, metadata: null, content: '' }
    } else if (current) {
      const metaMatch = line.match(/<!--\s*type:\s*.+?\s*-->/)
      if (metaMatch && !current.metadata) {
        current.metadata = parseMetadata(line)
      } else {
        current.content += line + '\n'
      }
    }
  }
  if (current) sections.push(current)

  return sections
}

// Rebuild memory file from sections
export function rebuildMemoryFile(sections: ParsedSection[]): string {
  const parts: string[] = ['# Project Memory']

  for (const section of sections) {
    parts.push('')
    parts.push(section.heading)
    if (section.metadata) {
      parts.push(metadataToComment(section.metadata))
    }
    parts.push(section.content.trim())
  }

  return parts.join('\n') + '\n'
}

// Extract tags from content
export function extractTagsFromContent(content: string): string[] {
  const TAG_KEYWORDS: Record<string, string[]> = {
    flutter: ['flutter', 'dart', 'widget', 'riverpod', 'app'],
    backend: ['node', 'express', 'prisma', 'postgresql', 'api', 'server'],
    typescript: ['typescript', 'ts', 'type', 'interface'],
    architecture: ['architecture', 'pattern', 'structure', 'design'],
    ui: ['ui', 'ux', 'design', 'theme', 'style', 'css', 'layout'],
    testing: ['test', 'jest', 'vitest', 'playwright', 'e2e'],
    database: ['database', 'db', 'sql', 'migration', 'schema'],
    auth: ['auth', 'jwt', 'token', 'login', 'permission'],
    devops: ['docker', 'ci', 'cd', 'deploy', 'github actions'],
    memory: ['memory', 'checkpoint', 'session', 'plugin'],
    fix: ['fix', 'bug', 'error', 'issue', 'patch'],
    performance: ['performance', 'optimize', 'speed', 'cache', 'slow'],
    security: ['security', 'vulnerability', 'xss', 'csrf', 'sanitize'],
    mobile: ['mobile', 'android', 'ios', 'react native', 'flutter'],
    api: ['api', 'endpoint', 'rest', 'graphql', 'route'],
  }

  const tags: string[] = []
  const contentLower = content.toLowerCase()

  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some(keyword => contentLower.includes(keyword))) {
      tags.push(tag)
    }
  }

  return tags.slice(0, 5) // Limit to 5 tags
}
