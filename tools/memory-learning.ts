import { tool } from '@opencode-ai/plugin'
import fs from 'fs/promises'
import path from 'path'
import { readFileSafe, writeFileSafe, generateId } from './memory-utils'

const MEMORY_DIR = process.env.MEMORY_DIR || '.opencode/memory'
const LEARNING_FILE = path.join(MEMORY_DIR, 'learnings.md')
const PATTERNS_FILE = path.join(MEMORY_DIR, 'patterns.md')
const CORRECTIONS_FILE = path.join(MEMORY_DIR, 'corrections.md')

// Types
interface Correction {
  id: string
  timestamp: string
  context: string
  wrong: string
  correct: string
  category: 'code' | 'style' | 'architecture' | 'preference'
  tags: string[]
}

interface Pattern {
  id: string
  name: string
  description: string
  example: string
  count: number
  lastUsed: string
  tags: string[]
}

interface Learning {
  id: string
  timestamp: string
  type: 'correction' | 'insight' | 'preference' | 'pattern'
  content: string
  context?: string
  tags: string[]
}

// Parse corrections from file
function parseCorrections(content: string): Correction[] {
  const corrections: Correction[] = []
  const blocks = content.split(/^## /m).filter(b => b.trim())

  for (const block of blocks) {
    const lines = block.split('\n')
    const heading = lines[0]?.trim()

    if (!heading || heading === 'Corrections') continue

    const idMatch = heading.match(/\[([a-z0-9]+)\]/)
    if (!idMatch) continue

    const correction: Correction = {
      id: idMatch[1],
      timestamp: '',
      context: '',
      wrong: '',
      correct: '',
      category: 'code',
      tags: [],
    }

    for (const line of lines.slice(1)) {
      if (line.startsWith('<!-- ') && line.endsWith(' -->')) {
        const meta = line.slice(4, -3)
        const tsMatch = meta.match(/timestamp:\s*(.+)/)
        if (tsMatch) correction.timestamp = tsMatch[1].trim()
        const catMatch = meta.match(/category:\s*(.+)/)
        if (catMatch) correction.category = catMatch[1].trim() as Correction['category']
        const tagsMatch = meta.match(/tags:\s*(.+)/)
        if (tagsMatch) correction.tags = tagsMatch[1].split(',').map(t => t.trim())
      } else if (line.startsWith('**Context**:')) {
        correction.context = line.replace('**Context**:', '').trim()
      } else if (line.startsWith('**Wrong**:')) {
        correction.wrong = line.replace('**Wrong**:', '').trim()
      } else if (line.startsWith('**Correct**:')) {
        correction.correct = line.replace('**Correct**:', '').trim()
      }
    }

    if (correction.id) {
      corrections.push(correction)
    }
  }

  return corrections
}

// Parse patterns from file
function parsePatterns(content: string): Pattern[] {
  const patterns: Pattern[] = []
  const blocks = content.split(/^## /m).filter(b => b.trim())

  for (const block of blocks) {
    const lines = block.split('\n')
    const heading = lines[0]?.trim()

    if (!heading || heading === 'Patterns') continue

    const idMatch = heading.match(/\[([a-z0-9]+)\]/)
    if (!idMatch) continue

    const pattern: Pattern = {
      id: idMatch[1],
      name: '',
      description: '',
      example: '',
      count: 0,
      lastUsed: '',
      tags: [],
    }

    for (const line of lines.slice(1)) {
      if (line.startsWith('<!-- ') && line.endsWith(' -->')) {
        const meta = line.slice(4, -3)
        const nameMatch = meta.match(/name:\s*(.+)/)
        if (nameMatch) pattern.name = nameMatch[1].trim()
        const countMatch = meta.match(/count:\s*(\d+)/)
        if (countMatch) pattern.count = parseInt(countMatch[1])
        const lastMatch = meta.match(/lastUsed:\s*(.+)/)
        if (lastMatch) pattern.lastUsed = lastMatch[1].trim()
        const tagsMatch = meta.match(/tags:\s*(.+)/)
        if (tagsMatch) pattern.tags = tagsMatch[1].split(',').map(t => t.trim())
      } else if (line.startsWith('**Description**:')) {
        pattern.description = line.replace('**Description**:', '').trim()
      } else if (line.startsWith('**Example**:')) {
        pattern.example = line.replace('**Example**:', '').trim()
      }
    }

    if (pattern.id && pattern.name) {
      patterns.push(pattern)
    }
  }

  return patterns
}

// Build corrections file
function buildCorrectionsFile(corrections: Correction[]): string {
  const lines = ['# Corrections', '', 'Corrections learned from user feedback.', '']

  for (const c of corrections) {
    lines.push(`## [${c.id}]`)
    lines.push(`<!-- timestamp: ${c.timestamp} | category: ${c.category} | tags: ${c.tags.join(', ')} -->`)
    if (c.context) lines.push(`**Context**: ${c.context}`)
    if (c.wrong) lines.push(`**Wrong**: ${c.wrong}`)
    if (c.correct) lines.push(`**Correct**: ${c.correct}`)
    lines.push('')
  }

  return lines.join('\n')
}

// Build patterns file
function buildPatternsFile(patterns: Pattern[]): string {
  const lines = ['# Patterns', '', 'Coding patterns learned from experience.', '']

  for (const p of patterns) {
    lines.push(`## [${p.id}]`)
    lines.push(`<!-- name: ${p.name} | count: ${p.count} | lastUsed: ${p.lastUsed} | tags: ${p.tags.join(', ')} -->`)
    if (p.description) lines.push(`**Description**: ${p.description}`)
    if (p.example) lines.push(`**Example**: ${p.example}`)
    lines.push('')
  }

  return lines.join('\n')
}

// Tools
export const memory_learn = tool({
  description: 'Learn from user corrections and insights',
  args: {
    type: tool.schema.enum(['correction', 'insight', 'preference']).describe('Type of learning'),
    content: tool.schema.string().describe('What was learned'),
    context: tool.schema.string().optional().describe('Context of the learning'),
    wrong: tool.schema.string().optional().describe('What was wrong (for corrections)'),
    correct: tool.schema.string().optional().describe('What is correct (for corrections)'),
    tags: tool.schema.string().optional().describe('Comma-separated tags'),
  },
  async execute(args) {
    const { type, content, context, wrong, correct, tags } = args

    const id = generateId()
    const timestamp = new Date().toISOString()
    const tagList = tags ? tags.split(',').map(t => t.trim()) : []

    if (type === 'correction' && wrong && correct) {
      const correction: Correction = {
        id,
        timestamp,
        context: context || '',
        wrong,
        correct,
        category: 'code',
        tags: tagList,
      }

      const existing = await readFileSafe(CORRECTIONS_FILE)
      const corrections = parseCorrections(existing)
      corrections.push(correction)
      await writeFileSafe(CORRECTIONS_FILE, buildCorrectionsFile(corrections))

      return `Learned correction: ${wrong} → ${correct}`
    } else {
      const learning: Learning = {
        id,
        timestamp,
        type: type as Learning['type'],
        content,
        context,
        tags: tagList,
      }

      const existing = await readFileSafe(LEARNING_FILE)
      const lines = existing.trim() ? existing.split('\n') : ['# Learnings', '']

      lines.push(`## [${id}]`)
      lines.push(`<!-- timestamp: ${timestamp} | type: ${type} | tags: ${tagList.join(', ')} -->`)
      if (context) lines.push(`**Context**: ${context}`)
      lines.push(`**Content**: ${content}`)
      lines.push('')

      await writeFileSafe(LEARNING_FILE, lines.join('\n'))

      return `Learned ${type}: ${content.slice(0, 50)}...`
    }
  },
})

export const memory_patterns = tool({
  description: 'Extract and manage coding patterns',
  args: {
    action: tool.schema.enum(['list', 'add', 'use', 'search']).describe('Action to perform'),
    name: tool.schema.string().optional().describe('Pattern name (for add)'),
    description: tool.schema.string().optional().describe('Pattern description (for add)'),
    example: tool.schema.string().optional().describe('Code example (for add)'),
    tags: tool.schema.string().optional().describe('Comma-separated tags'),
    query: tool.schema.string().optional().describe('Search query (for search)'),
    id: tool.schema.string().optional().describe('Pattern ID (for use)'),
  },
  async execute(args) {
    const { action, name, description, example, tags, query, id } = args

    const existing = await readFileSafe(PATTERNS_FILE)
    const patterns = parsePatterns(existing)

    switch (action) {
      case 'list': {
        const list = patterns.map(p => `- ${p.name} (used ${p.count}x) [${p.tags.join(', ')}]`).join('\n')
        return list || 'No patterns found.'
      }

      case 'add': {
        if (!name || !description) {
          return 'Error: Name and description are required'
        }

        const newPattern: Pattern = {
          id: generateId(),
          name,
          description,
          example: example || '',
          count: 0,
          lastUsed: new Date().toISOString(),
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
        }

        patterns.push(newPattern)
        await writeFileSafe(PATTERNS_FILE, buildPatternsFile(patterns))

        return `Added pattern: ${name} (id: ${newPattern.id})`
      }

      case 'use': {
        if (!id) {
          return 'Error: Pattern ID is required'
        }

        const pattern = patterns.find(p => p.id === id)
        if (!pattern) {
          return `Error: Pattern not found: ${id}`
        }

        pattern.count++
        pattern.lastUsed = new Date().toISOString()
        await writeFileSafe(PATTERNS_FILE, buildPatternsFile(patterns))

        return `Used pattern: ${pattern.name} (now used ${pattern.count}x)`
      }

      case 'search': {
        if (!query) {
          return 'Error: Search query is required'
        }

        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
        const results = patterns.filter(p => {
          const searchText = `${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase()
          return terms.every(term => searchText.includes(term))
        })

        if (results.length === 0) {
          return `No patterns found for: ${query}`
        }

        return results.map(p => `- ${p.name}: ${p.description.slice(0, 80)}...`).join('\n')
      }

      default:
        return `Unknown action: ${action}`
    }
  },
})

export const memory_corrections = tool({
  description: 'View and manage corrections',
  args: {
    action: tool.schema.enum(['list', 'search', 'stats']).describe('Action to perform'),
    query: tool.schema.string().optional().describe('Search query'),
    category: tool.schema.enum(['code', 'style', 'architecture', 'preference']).optional().describe('Filter by category'),
  },
  async execute(args) {
    const { action, query, category } = args

    const existing = await readFileSafe(CORRECTIONS_FILE)
    const corrections = parseCorrections(existing)

    switch (action) {
      case 'list': {
        let filtered = corrections
        if (category) {
          filtered = filtered.filter(c => c.category === category)
        }

        if (filtered.length === 0) {
          return 'No corrections found.'
        }

        return filtered.map(c => `- [${c.category}] ${c.wrong} → ${c.correct}`).join('\n')
      }

      case 'search': {
        if (!query) {
          return 'Error: Search query is required'
        }

        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
        const results = corrections.filter(c => {
          const searchText = `${c.wrong} ${c.correct} ${c.context} ${c.tags.join(' ')}`.toLowerCase()
          return terms.every(term => searchText.includes(term))
        })

        if (results.length === 0) {
          return `No corrections found for: ${query}`
        }

        return results.map(c => `- ${c.wrong} → ${c.correct}`).join('\n')
      }

      case 'stats': {
        const stats = {
          total: corrections.length,
          byCategory: {} as Record<string, number>,
        }

        for (const c of corrections) {
          stats.byCategory[c.category] = (stats.byCategory[c.category] || 0) + 1
        }

        const lines = [`Total corrections: ${stats.total}`]
        for (const [cat, count] of Object.entries(stats.byCategory)) {
          lines.push(`  ${cat}: ${count}`)
        }

        return lines.join('\n')
      }

      default:
        return `Unknown action: ${action}`
    }
  },
})

export const memory_apply_learnings = tool({
  description: 'Apply learnings to improve code or behavior',
  args: {
    context: tool.schema.string().describe('Current context or task'),
    code: tool.schema.string().optional().describe('Code to improve (optional)'),
  },
  async execute(args) {
    const { context, code } = args

    // Load learnings
    const learningsContent = await readFileSafe(LEARNING_FILE)
    const correctionsContent = await readFileSafe(CORRECTIONS_FILE)
    const patternsContent = await readFileSafe(PATTERNS_FILE)

    const corrections = parseCorrections(correctionsContent)
    const patterns = parsePatterns(patternsContent)

    // Find relevant corrections
    const contextLower = context.toLowerCase()
    const relevantCorrections = corrections.filter(c => {
      const searchText = `${c.wrong} ${c.correct} ${c.context} ${c.tags.join(' ')}`.toLowerCase()
      return contextLower.split(/\s+/).some(term => searchText.includes(term))
    })

    // Find relevant patterns
    const relevantPatterns = patterns.filter(p => {
      const searchText = `${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase()
      return contextLower.split(/\s+/).some(term => searchText.includes(term))
    })

    // Apply learnings
    const suggestions: string[] = []

    if (relevantCorrections.length > 0) {
      suggestions.push('Based on past corrections:')
      for (const c of relevantCorrections.slice(0, 3)) {
        suggestions.push(`  - Avoid: ${c.wrong}`)
        suggestions.push(`  - Use: ${c.correct}`)
      }
    }

    if (relevantPatterns.length > 0) {
      suggestions.push('Relevant patterns:')
      for (const p of relevantPatterns.slice(0, 3)) {
        suggestions.push(`  - ${p.name}: ${p.description}`)
        if (p.example) {
          suggestions.push(`    Example: ${p.example.slice(0, 100)}...`)
        }
      }
    }

    if (suggestions.length === 0) {
      suggestions.push('No relevant learnings found for this context.')
      suggestions.push('Consider saving this as a pattern or correction if it\'s a new insight.')
    }

    return suggestions.join('\n')
  },
})

export const memory_learning_stats = tool({
  description: 'Get statistics about learning system',
  args: {},
  async execute() {
    const learningsContent = await readFileSafe(LEARNING_FILE)
    const correctionsContent = await readFileSafe(CORRECTIONS_FILE)
    const patternsContent = await readFileSafe(PATTERNS_FILE)

    const corrections = parseCorrections(correctionsContent)
    const patterns = parsePatterns(patternsContent)

    // Count learnings from file
    const learningLines = learningsContent.split('\n').filter(l => l.startsWith('## ['))
    const learningCount = learningLines.length

    // Stats
    const stats = {
      totalLearnings: learningCount,
      totalCorrections: corrections.length,
      totalPatterns: patterns.length,
      correctionsByCategory: {} as Record<string, number>,
      patternsByUsage: patterns
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(p => `${p.name} (used ${p.count}x)`),
      recentCorrections: corrections
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 3)
        .map(c => `${c.wrong} → ${c.correct}`),
    }

    for (const c of corrections) {
      stats.correctionsByCategory[c.category] = (stats.correctionsByCategory[c.category] || 0) + 1
    }

    const lines = [
      'Learning System Stats:',
      `  Total learnings: ${stats.totalLearnings}`,
      `  Total corrections: ${stats.totalCorrections}`,
      `  Total patterns: ${stats.totalPatterns}`,
      '',
      'Corrections by category:',
      ...Object.entries(stats.correctionsByCategory).map(([cat, count]) => `  ${cat}: ${count}`),
      '',
      'Most used patterns:',
      ...stats.patternsByUsage.map(p => `  ${p}`),
      '',
      'Recent corrections:',
      ...stats.recentCorrections.map(c => `  ${c}`),
    ]

    return lines.join('\n')
  },
})

export const selfImprovementTools = [
  memory_learn,
  memory_patterns,
  memory_corrections,
  memory_apply_learnings,
  memory_learning_stats,
]
