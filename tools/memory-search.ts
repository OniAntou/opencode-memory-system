import { tool } from "@opencode-ai/plugin"
import fs from "fs/promises"
import path from "path"
import { MemoryMetadata, ParsedSection, parseSections } from "./memory-utils"
import { MEMORY_DIR, onCacheInvalidated } from "./memory-io"

function levenshteinDistance(a: string, b: string): number {
  const m = a.length; const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1]
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function fuzzyMatch(term: string, target: string): { matched: boolean; score: number } {
  const lowerTerm = term.toLowerCase(); const lowerTarget = target.toLowerCase()
  if (lowerTarget.includes(lowerTerm)) {
    return { matched: true, score: lowerTarget.indexOf(lowerTerm) === 0 ? 100 : 50 }
  }
  const words = lowerTarget.split(/\s+/)
  for (const word of words) {
    if (word === lowerTerm) return { matched: true, score: 100 }
    if (word.startsWith(lowerTerm)) return { matched: true, score: 80 }
    if (levenshteinDistance(lowerTerm, word) <= 2 && lowerTerm.length >= 3) return { matched: true, score: 30 }
  }
  if (lowerTarget.length >= 3 && lowerTerm.length >= 3) {
    if (levenshteinDistance(lowerTerm, lowerTarget.slice(0, lowerTerm.length + 2)) <= 3) return { matched: true, score: 20 }
  }
  return { matched: false, score: 0 }
}

export interface SearchResult {
  file: string; line: number; content: string; score: number; metadata: MemoryMetadata | null
  scoring_breakdown?: ScoringBreakdown
}

export interface ScoringBreakdown {
  tfidf_score: number; proximity_score: number; heading_bonus: number; exact_phrase_bonus: number
  tag_bonus: number; metadata_boost: number; total: number
}

function computeIDF(term: string, documentCount: Map<string, number>, totalDocs: number): number {
  const docFreq = documentCount.get(term) || 0
  if (docFreq === 0) return 0
  return Math.log((totalDocs + 1) / (docFreq + 1)) + 1
}

function calculateTF(text: string, term: string): number {
  const words = text.toLowerCase().split(/\s+/)
  const termCount = words.filter(w => w === term).length
  return words.length > 0 ? termCount / words.length : 0
}

function calculateProximity(text: string, terms: string[]): number {
  if (terms.length < 2) return 0
  const lowerText = text.toLowerCase()
  const positions: number[][] = terms.map(t => {
    const pos: number[] = []; let idx = lowerText.indexOf(t)
    while (idx !== -1) { pos.push(idx); idx = lowerText.indexOf(t, idx + 1) }
    return pos
  })
  let minDistance = Infinity
  if (positions.every(p => p.length > 0)) {
    for (let i = 0; i < positions[0].length; i++) {
      for (let j = 1; j < positions.length; j++) {
        for (const pos2 of positions[j]) {
          const dist = Math.abs(positions[0][i] - pos2)
          if (dist < minDistance) minDistance = dist
        }
      }
    }
  }
  if (minDistance === Infinity) return 0
  if (minDistance < 20) return 30
  if (minDistance < 50) return 20
  if (minDistance < 100) return 10
  return 5
}

function calculateHeadingBonus(heading: string, query: string): number {
  const lowerHeading = heading.toLowerCase(); const lowerQuery = query.toLowerCase()
  if (lowerHeading.includes(lowerQuery)) return 40
  if (lowerQuery.includes(lowerHeading)) return 30
  const commonWords = lowerHeading.split(/\s+/).filter(w => lowerQuery.split(/\s+/).includes(w) && w.length > 2)
  return commonWords.length * 10
}

function calculateExactPhraseBonus(text: string, query: string): number {
  const lowerText = text.toLowerCase(); const lowerQuery = query.toLowerCase().trim()
  if (lowerText.includes(lowerQuery)) return lowerText.indexOf(lowerQuery) < 50 ? 50 : 30
  return 0
}

function calculateTagBonus(tags: string[], terms: string[]): number {
  let bonus = 0
  for (const term of terms) {
    for (const tag of tags) {
      if (tag.toLowerCase().includes(term)) bonus += 15
    }
  }
  return Math.min(bonus, 45)
}

function calculateMetadataBoost(meta: MemoryMetadata | null): number {
  if (!meta) return 0
  let boost = meta.importance === "high" ? 20 : meta.importance === "medium" ? 10 : 0
  const ageDays = (Date.now() - new Date(meta.updated).getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays < 7) boost += 15
  else if (ageDays < 30) boost += 5
  else boost -= 5
  return boost
}

// Global Search Cache
const searchCache = {
  documentCount: new Map<string, number>(),
  parsedSections: new Map<string, ParsedSection[]>(),
  totalDocs: 0,
  isBuilt: false,
  lastMtime: 0
}

onCacheInvalidated((filePath) => {
  // Simple invalidation: rebuild next time
  searchCache.isBuilt = false;
  searchCache.documentCount.clear();
  searchCache.parsedSections.clear();
  searchCache.totalDocs = 0;
  searchCache.lastMtime = 0;
});

async function buildSearchCache() {
  let latestMtime = 0;
  try {
    const stat = await fs.stat(path.join(MEMORY_DIR, 'MEMORY.md'));
    latestMtime = stat.mtimeMs;
  } catch {}

  if (searchCache.isBuilt && searchCache.lastMtime >= latestMtime && latestMtime > 0) return;
  
  searchCache.documentCount.clear();
  searchCache.parsedSections.clear();
  searchCache.totalDocs = 0;
  searchCache.lastMtime = latestMtime;
  
  async function walk(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          searchCache.totalDocs++
          const content = await fs.readFile(fullPath, "utf-8")
          const sections = parseSections(content)
          searchCache.parsedSections.set(fullPath, sections)
          
          for (const section of sections) {
            const words = (section.heading + " " + section.content).toLowerCase().split(/\s+/)
            const uniqueTerms = new Set(words)
            for (const term of uniqueTerms) {
              if (term.length > 2) {
                searchCache.documentCount.set(term, (searchCache.documentCount.get(term) || 0) + 1)
              }
            }
          }
        }
      }
    } catch {}
  }
  await walk(MEMORY_DIR)
  searchCache.isBuilt = true;
}

export async function searchMemoryFiles(
  query: string,
  filters?: { type?: string; tags?: string[]; after?: string; before?: string },
  relevanceDetails?: boolean
): Promise<SearchResult[]> {
  await buildSearchCache();
  const results: SearchResult[] = []
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)

  for (const [fullPath, sections] of searchCache.parsedSections.entries()) {
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
      let allMatched = true

      for (const term of terms) {
        if (!fuzzyMatch(term, searchText).matched) {
          allMatched = false
          break
        }
      }

      if (allMatched && terms.length > 0) {
        let tfidfScore = 0
        for (const term of terms) {
          const tf = calculateTF(searchText, term)
          const idf = computeIDF(term, searchCache.documentCount, searchCache.totalDocs)
          tfidfScore += tf * idf * 100
        }

        const proximityScore = calculateProximity(searchText, terms)
        const headingBonus = calculateHeadingBonus(section.heading, query)
        const exactPhraseBonus = calculateExactPhraseBonus(searchText, query)
        const tagBonus = section.metadata ? calculateTagBonus(section.metadata.tags, terms) : 0
        const metadataBoost = calculateMetadataBoost(section.metadata)

        const total = tfidfScore + proximityScore + headingBonus + exactPhraseBonus + tagBonus + metadataBoost

        const breakdown: ScoringBreakdown = {
          tfidf_score: Math.round(tfidfScore * 100) / 100,
          proximity_score: proximityScore,
          heading_bonus: headingBonus,
          exact_phrase_bonus: exactPhraseBonus,
          tag_bonus: tagBonus,
          metadata_boost: metadataBoost,
          total: Math.round(total * 100) / 100,
        }

        results.push({
          file: path.relative(MEMORY_DIR, fullPath),
          line: 0,
          content: section.heading + "\n" + section.content.trim().slice(0, 200),
          score: total,
          metadata: section.metadata,
          ...(relevanceDetails ? { scoring_breakdown: breakdown } : {}),
        })
      }
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 20)
}

export const memory_search = tool({
  description: "Search across all memory files with optional filters. Returns sections with metadata and relevance scores.",
  args: {
    query: tool.schema.string().describe("Search query (space-separated keywords)"),
    type: tool.schema.string().optional().describe("Filter by type (architecture, decision, convention, learning, note, fix, feature)"),
    tags: tool.schema.string().optional().describe("Filter by comma-separated tags"),
    after: tool.schema.string().optional().describe("Filter by date (YYYY-MM-DD), only show entries updated after this date"),
    before: tool.schema.string().optional().describe("Filter by date (YYYY-MM-DD), only show entries updated before this date"),
    relevance_details: tool.schema.boolean().optional().describe("Show detailed scoring breakdown"),
  },
  async execute(args) {
    const filters = {
      type: args.type,
      tags: args.tags ? args.tags.split(",").map(t => t.trim()) : undefined,
      after: args.after,
      before: args.before,
    }
    const results = await searchMemoryFiles(args.query, filters, args.relevance_details)

    if (results.length === 0) return "No results found."
    return results.map((r, i) => {
      const meta = r.metadata ? ` [${r.metadata.type}|${r.metadata.importance}|${r.metadata.tags.join(",")}]` : ""
      let output = `${i + 1}. [${r.file}]${meta} (score: ${r.score})\n${r.content}`
      if (r.scoring_breakdown) {
        const b = r.scoring_breakdown
        output += `\n\n  Scoring Breakdown:\n  - TF-IDF: ${b.tfidf_score}\n  - Proximity: ${b.proximity_score}\n  - Heading: ${b.heading_bonus}\n  - Exact Phrase: ${b.exact_phrase_bonus}\n  - Tag: ${b.tag_bonus}\n  - Metadata: ${b.metadata_boost}\n  - Total: ${b.total}`
      }
      return output
    }).join("\n\n")
  },
})
