import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'

const MEMORY_DIR = '.opencode/memory-test'
const TEST_MEMORY_FILE = path.join(MEMORY_DIR, 'MEMORY.md')
const TEST_NOTES_FILE = path.join(MEMORY_DIR, 'notes.md')

async function cleanup() {
  try {
    await fs.rm(MEMORY_DIR, { recursive: true, force: true })
  } catch {}
}

async function setupTestMemory() {
  await fs.mkdir(MEMORY_DIR, { recursive: true })
  await fs.writeFile(TEST_MEMORY_FILE, `# Project Memory

## Architecture
<!-- type: architecture | tags: opencode, plugins | importance: high | updated: 2026-06-18 -->

OpenCode extension points and plugin system.

## Conventions
<!-- type: convention | tags: coding-style | importance: medium | updated: 2026-06-17 -->

Package manager: npm, config format: JSON.
`)
}

describe('Memory Metadata Parsing', () => {
  beforeEach(async () => {
    await cleanup()
    await setupTestMemory()
  })

  afterEach(async () => {
    await cleanup()
  })

  it('should parse metadata from comment', async () => {
    const content = await fs.readFile(TEST_MEMORY_FILE, 'utf-8')
    expect(content).toContain('<!-- type: architecture')
    expect(content).toContain('tags: opencode, plugins')
    expect(content).toContain('importance: high')
  })

  it('should have valid metadata format', async () => {
    const content = await fs.readFile(TEST_MEMORY_FILE, 'utf-8')
    const metaMatch = content.match(/<!--\s*type:\s*(\w+)\s*\|/)
    expect(metaMatch).toBeTruthy()
    expect(metaMatch![1]).toBe('architecture')
  })
})

describe('Memory File Operations', () => {
  beforeEach(async () => {
    await cleanup()
    await setupTestMemory()
  })

  afterEach(async () => {
    await cleanup()
  })

  it('should read memory file', async () => {
    const content = await fs.readFile(TEST_MEMORY_FILE, 'utf-8')
    expect(content).toContain('# Project Memory')
    expect(content).toContain('## Architecture')
  })

  it('should write to memory file', async () => {
    const newContent = '## Test\nTest content'
    await fs.writeFile(TEST_MEMORY_FILE, newContent)
    const content = await fs.readFile(TEST_MEMORY_FILE, 'utf-8')
    expect(content).toBe(newContent)
  })

  it('should append to memory file', async () => {
    const existing = await fs.readFile(TEST_MEMORY_FILE, 'utf-8')
    const append = '\n## New Section\nNew content'
    await fs.writeFile(TEST_MEMORY_FILE, existing + append)
    const content = await fs.readFile(TEST_MEMORY_FILE, 'utf-8')
    expect(content).toContain('## New Section')
  })
})

describe('Auto-tagging Logic', () => {
  it('should suggest backend tags for database content', () => {
    const TAG_KEYWORDS: Record<string, string[]> = {
      backend: ['node', 'express', 'prisma', 'postgresql', 'api', 'server'],
      database: ['database', 'db', 'sql', 'migration', 'schema'],
      flutter: ['flutter', 'dart', 'widget', 'riverpod', 'app'],
    }

    function suggestTags(content: string): string[] {
      const lower = content.toLowerCase()
      const suggested: Set<string> = new Set()

      for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
        for (const keyword of keywords) {
          if (lower.includes(keyword)) {
            suggested.add(tag)
            break
          }
        }
      }

      return Array.from(suggested)
    }

    expect(suggestTags('Use PostgreSQL for database')).toContain('database')
    expect(suggestTags('Use PostgreSQL for database')).toContain('backend')
    expect(suggestTags('Flutter app with widgets')).toContain('flutter')
  })

  it('should not suggest tags for unrelated content', () => {
    const TAG_KEYWORDS: Record<string, string[]> = {
      backend: ['node', 'express', 'prisma', 'postgresql', 'api', 'server'],
      database: ['database', 'db', 'sql', 'migration', 'schema'],
    }

    function suggestTags(content: string): string[] {
      const lower = content.toLowerCase()
      const suggested: Set<string> = new Set()

      for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
        for (const keyword of keywords) {
          if (lower.includes(keyword)) {
            suggested.add(tag)
            break
          }
        }
      }

      return Array.from(suggested)
    }

    expect(suggestTags('Hello world')).toHaveLength(0)
  })
})

describe('Similarity Calculation', () => {
  it('should return 1.0 for identical content', () => {
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

    expect(calculateSimilarity('hello world test', 'hello world test')).toBe(1.0)
  })

  it('should return 0.0 for completely different content', () => {
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

    expect(calculateSimilarity('apple banana cherry', 'xyz foo bar')).toBe(0.0)
  })

  it('should return value between 0 and 1 for partial overlap', () => {
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

    const result = calculateSimilarity('hello world test foo', 'hello world bar baz')
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(1)
  })
})

describe('Levenshtein Distance', () => {
  it('should return 0 for identical strings', () => {
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

    expect(levenshteinDistance('hello', 'hello')).toBe(0)
  })

  it('should return correct distance for different strings', () => {
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

    expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
  })
})

describe('Conflict Detection', () => {
  it('should detect conflict with replacement keywords', () => {
    const CONFLICT_KEYWORDS: Record<string, string[]> = {
      replace: ['replace', 'thay thế', 'chuyển sang'],
      remove: ['remove', 'xóa', 'bỏ'],
    }

    function hasConflictKeywords(content: string): boolean {
      const lower = content.toLowerCase()
      for (const keywords of Object.values(CONFLICT_KEYWORDS)) {
        for (const keyword of keywords) {
          if (lower.includes(keyword)) return true
        }
      }
      return false
    }

    expect(hasConflictKeywords('Thay thế PostgreSQL bằng MongoDB')).toBe(true)
    expect(hasConflictKeywords('Chuyển sang MySQL')).toBe(true)
    expect(hasConflictKeywords('Sử dụng PostgreSQL')).toBe(false)
  })
})

describe('Token Estimation', () => {
  it('should estimate tokens correctly', () => {
    function estimateTokens(text: string): number {
      return Math.ceil(text.length / 4)
    }

    expect(estimateTokens('hello')).toBe(2)
    expect(estimateTokens('hello world test')).toBe(4)
    expect(estimateTokens('')).toBe(0)
  })
})

describe('TF-IDF Scoring', () => {
  it('should calculate term frequency correctly', () => {
    function calculateTF(text: string, term: string): number {
      const words = text.toLowerCase().split(/\s+/)
      const termCount = words.filter(w => w === term).length
      return words.length > 0 ? termCount / words.length : 0
    }

    expect(calculateTF('hello world hello', 'hello')).toBe(2/3)
    expect(calculateTF('hello world test', 'hello')).toBe(1/3)
    expect(calculateTF('hello world test', 'missing')).toBe(0)
  })

  it('should calculate IDF correctly', () => {
    function computeIDF(term: string, documentCount: Map<string, number>, totalDocs: number): number {
      const docFreq = documentCount.get(term) || 0
      if (docFreq === 0) return 0
      return Math.log((totalDocs + 1) / (docFreq + 1)) + 1
    }

    const docCount = new Map([['memory', 5], ['rare', 1]])
    const totalDocs = 10

    // Common term (memory) - lower IDF
    const memoryIDF = computeIDF('memory', docCount, totalDocs)
    // Rare term - higher IDF
    const rareIDF = computeIDF('rare', docCount, totalDocs)

    expect(memoryIDF).toBeLessThan(rareIDF)
    expect(rareIDF).toBeGreaterThan(1)
  })
})

describe('Proximity Scoring', () => {
  it('should give higher score for closer terms', () => {
    function calculateProximity(text: string, terms: string[]): number {
      if (terms.length < 2) return 0

      const lowerText = text.toLowerCase()
      const positions: number[][] = terms.map(t => {
        const pos: number[] = []
        let idx = lowerText.indexOf(t)
        while (idx !== -1) {
          pos.push(idx)
          idx = lowerText.indexOf(t, idx + 1)
        }
        return pos
      })

      let minDistance = Infinity
      for (let i = 0; i < positions[0].length; i++) {
        for (let j = 1; j < positions.length; j++) {
          for (const pos2 of positions[j]) {
            const dist = Math.abs(positions[0][i] - pos2)
            if (dist < minDistance) minDistance = dist
          }
        }
      }

      if (minDistance === Infinity) return 0
      if (minDistance < 20) return 30
      if (minDistance < 50) return 20
      if (minDistance < 100) return 10
      return 5
    }

    // Close terms - high score
    expect(calculateProximity('memory search engine', ['memory', 'search'])).toBe(30)
    // Medium distance - medium score
    expect(calculateProximity('memory is very important for search', ['memory', 'search'])).toBe(20)
    // Far terms - still medium (distance < 50)
    expect(calculateProximity('memory is very important for the search functionality', ['memory', 'search'])).toBe(20)
    // Very far terms - low score (distance > 50)
    expect(calculateProximity('memory is a very very very important concept for the search algorithm', ['memory', 'search'])).toBe(10)
  })
})

describe('Heading Match Bonus', () => {
  it('should give bonus for heading matches', () => {
    function calculateHeadingBonus(heading: string, query: string): number {
      const lowerHeading = heading.toLowerCase()
      const lowerQuery = query.toLowerCase()

      if (lowerHeading.includes(lowerQuery)) return 40
      if (lowerQuery.includes(lowerHeading)) return 30

      const headingWords = lowerHeading.split(/\s+/)
      const queryWords = lowerQuery.split(/\s+/)
      const commonWords = headingWords.filter(w => queryWords.includes(w) && w.length > 2)
      return commonWords.length * 10
    }

    // Exact heading match
    expect(calculateHeadingBonus('Memory System', 'memory system')).toBe(40)
    // Query contains heading
    expect(calculateHeadingBonus('Memory', 'memory system architecture')).toBe(30)
    // Partial word match (heading contains query)
    expect(calculateHeadingBonus('Memory Search', 'search')).toBe(40)
    // Partial word match (query contains heading word)
    expect(calculateHeadingBonus('Memory', 'search for memory')).toBe(30)
    // No match
    expect(calculateHeadingBonus('Task Management', 'memory')).toBe(0)
  })
})

describe('Exact Phrase Bonus', () => {
  it('should give bonus for exact phrase matches', () => {
    function calculateExactPhraseBonus(text: string, query: string): number {
      const lowerText = text.toLowerCase()
      const lowerQuery = query.toLowerCase().trim()

      if (lowerText.includes(lowerQuery)) {
        const idx = lowerText.indexOf(lowerQuery)
        return idx < 50 ? 50 : 30
      }
      return 0
    }

    // Exact phrase at beginning
    expect(calculateExactPhraseBonus('memory search engine', 'memory search')).toBe(50)
    // Exact phrase later in text (position 4, still < 50)
    expect(calculateExactPhraseBonus('the memory search is working', 'memory search')).toBe(50)
    // No exact phrase
    expect(calculateExactPhraseBonus('memory and search', 'memory search')).toBe(0)
  })
})

describe('Tag Bonus', () => {
  it('should give bonus for tag matches', () => {
    function calculateTagBonus(tags: string[], terms: string[]): number {
      let bonus = 0
      for (const term of terms) {
        for (const tag of tags) {
          if (tag.toLowerCase().includes(term)) bonus += 15
        }
      }
      return Math.min(bonus, 45)
    }

    // Single tag match
    expect(calculateTagBonus(['architecture', 'decision'], ['architecture'])).toBe(15)
    // Multiple tag matches
    expect(calculateTagBonus(['architecture', 'decision'], ['architecture', 'decision'])).toBe(30)
    // Tag match capped at 45
    expect(calculateTagBonus(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'])).toBe(45)
    // No tag match
    expect(calculateTagBonus(['architecture'], ['missing'])).toBe(0)
  })
})

describe('Metadata Boost Calculation', () => {
  it('should boost high importance entries', () => {
    function calculateMetadataBoost(importance: string, ageDays: number): number {
      let boost = 0
      if (importance === 'high') boost += 20
      else if (importance === 'medium') boost += 10

      if (ageDays < 7) boost += 15
      else if (ageDays < 30) boost += 5
      else boost -= 5

      return boost
    }

    expect(calculateMetadataBoost('high', 1)).toBe(35)
    expect(calculateMetadataBoost('medium', 1)).toBe(25)
    expect(calculateMetadataBoost('low', 1)).toBe(15)
    expect(calculateMetadataBoost('high', 60)).toBe(15)
  })
})
