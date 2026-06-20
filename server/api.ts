import http from 'http'
import path from 'path'
import { URL } from 'url'
import { parseMetadata, parseSections, metadataToComment, type MemoryMetadata, type ParsedSection } from '../tools/memory-utils'
import { readMemoryFile, writeMemoryFile } from '../tools/memory-io'
import { searchMemoryFiles } from '../tools/memory-search'
import { validateMemoryFile, collectMemoryStats } from '../tools/memory-analytics'

const MEMORY_DIR = process.env.MEMORY_DIR || '.opencode/memory'
const PORT = parseInt(process.env.PORT || '3000', 10)
const API_KEY = process.env.API_KEY || ''
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10) // 1 minute
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10)

// Rate limiting
interface RateLimitEntry {
  count: number
  resetTime: number
}

const rateLimitMap = new Map<string, RateLimitEntry>()

// Clean up expired rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(key)
    }
  }
}, 5 * 60 * 1000)

function getRateLimitKey(req: http.IncomingMessage): string {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
  return String(ip)
}

function checkRateLimit(req: http.IncomingMessage): boolean {
  const key = getRateLimitKey(req)
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false
  }

  entry.count++
  return true
}

function getRateLimitHeaders(req: http.IncomingMessage): Record<string, string> {
  const key = getRateLimitKey(req)
  const entry = rateLimitMap.get(key)
  const remaining = entry ? Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count) : RATE_LIMIT_MAX_REQUESTS
  const resetTime = entry ? entry.resetTime : Date.now() + RATE_LIMIT_WINDOW_MS

  return {
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(Math.ceil(resetTime / 1000)),
  }
}



function jsonResponse(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data, null, 2))
}

const MAX_BODY_SIZE = 1024 * 1024 // 1MB
function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = ''
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) {
        req.destroy()
        resolve({})
        return
      }
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        resolve({})
      }
    })
  })
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const pathname = url.pathname
  const method = req.method || 'GET'

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400') // 24 hours

  // Rate limiting headers
  const rateLimitHeaders = getRateLimitHeaders(req)
  for (const [key, value] of Object.entries(rateLimitHeaders)) {
    res.setHeader(key, value)
  }

  if (method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Check rate limit
  if (!checkRateLimit(req)) {
    jsonResponse(res, 429, { error: 'Too many requests. Please try again later.' })
    return
  }

  // API Key authentication
  if (API_KEY) {
    const authHeader = req.headers.authorization
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
      jsonResponse(res, 401, { error: 'Unauthorized. Provide API key in Authorization header.' })
      return
    }
  }

  try {
    // GET /api/memory - Read memory file
    if (method === 'GET' && pathname === '/api/memory') {
      const file = url.searchParams.get('file') || 'MEMORY.md'
      
      // Validate file path
      if (file.includes('..') || file.includes('/') || file.includes('\\')) {
        jsonResponse(res, 400, { error: 'Invalid file path' })
        return
      }
      
      const content = await readMemoryFile(file)
      if (!content.trim()) {
        jsonResponse(res, 404, { error: `File not found: ${file}` })
        return
      }
      jsonResponse(res, 200, { file, content })
      return
    }

    // GET /api/memory/sections - Get parsed sections
    if (method === 'GET' && pathname === '/api/memory/sections') {
      const content = await readMemoryFile('MEMORY.md')
      const sections = parseSections(content)
      jsonResponse(res, 200, { sections })
      return
    }

    // POST /api/memory/write - Write to memory
    if (method === 'POST' && pathname === '/api/memory/write') {
      const body = await parseBody(req)
      const { file = 'MEMORY.md', content, type, tags, importance } = body

      if (!content || typeof content !== 'string') {
        jsonResponse(res, 400, { error: 'Content is required' })
        return
      }

      // Validate file path
      if (String(file).includes('..') || String(file).includes('/') || String(file).includes('\\')) {
        jsonResponse(res, 400, { error: 'Invalid file path' })
        return
      }

      // Validate type if provided
      const validTypes = ['architecture', 'decision', 'convention', 'learning', 'note', 'fix', 'feature']
      if (type && !validTypes.includes(String(type))) {
        jsonResponse(res, 400, { error: `Invalid type. Must be one of: ${validTypes.join(', ')}` })
        return
      }

      // Validate importance if provided
      const validImportance = ['low', 'medium', 'high']
      if (importance && !validImportance.includes(String(importance))) {
        jsonResponse(res, 400, { error: `Invalid importance. Must be one of: ${validImportance.join(', ')}` })
        return
      }

      if (file === 'MEMORY.md' && type) {
        const meta: MemoryMetadata = {
          type: String(type),
          tags: tags ? String(tags).split(',').map((t: string) => t.trim()) : [],
          importance: (importance as MemoryMetadata['importance']) || 'medium',
          updated: new Date().toISOString().split('T')[0],
        }
        const metaComment = metadataToComment(meta)
        const fullContent = `${metaComment}\n${content}`

        const existing = await readMemoryFile(String(file))
        const sections = parseSections(existing)
        const newSection: ParsedSection = {
          heading: `## ${String(type).charAt(0).toUpperCase()}${String(type).slice(1)}`,
          metadata: meta,
          content: String(content),
        }
        sections.push(newSection)
        
        const { rebuildMemoryFile } = await import('../tools/memory-utils')
        await writeMemoryFile(String(file), rebuildMemoryFile(sections))
        jsonResponse(res, 200, { success: true, message: `Written with metadata (type: ${type})` })
      } else {
        const existing = await readMemoryFile(String(file))
        const separator = existing.trim() ? '\n\n' : ''
        await writeMemoryFile(String(file), existing + separator + String(content))
        jsonResponse(res, 200, { success: true, message: `Written to ${file}` })
      }
      return
    }

    // GET /api/memory/search - Search memory
    if (method === 'GET' && pathname === '/api/memory/search') {
      const query = url.searchParams.get('q') || ''
      const type = url.searchParams.get('type')
      const tags = url.searchParams.get('tags')

      if (!query) {
        jsonResponse(res, 400, { error: 'Query parameter q is required' })
        return
      }

      const results = await searchMemoryFiles(query, { type: type || undefined, tags: tags ? tags.split(',').map(t=>t.trim()) : undefined })

      jsonResponse(res, 200, { query, results })
      return
    }

    // GET /api/memory/stats - Get memory statistics
    if (method === 'GET' && pathname === '/api/memory/stats') {
      const stats = await collectMemoryStats()
      jsonResponse(res, 200, stats)
      return
    }

    // POST /api/memory/validate - Validate memory
    if (method === 'POST' && pathname === '/api/memory/validate') {
      const issuesResult = await validateMemoryFile('MEMORY.md')
      const issues = issuesResult.map(r => ({ section: r.section, problems: r.issues }))
      jsonResponse(res, 200, { valid: issues.length === 0, issues })
      return
    }

    // GET /api/health - Health check
    if (method === 'GET' && pathname === '/api/health') {
      jsonResponse(res, 200, { status: 'ok', timestamp: new Date().toISOString() })
      return
    }

    // 404
    jsonResponse(res, 404, { error: 'Not found' })
  } catch (error) {
    jsonResponse(res, 500, { error: error instanceof Error ? error.message : 'Internal server error' })
  }
}

const server = http.createServer(handleRequest)

server.listen(PORT, () => {
  console.log(`Memory API Server running at http://localhost:${PORT}`)
  console.log(`API Key: ${API_KEY ? 'Enabled' : 'Disabled'}`)
  console.log(`CORS Origin: ${CORS_ORIGIN}`)
  console.log(`Rate Limit: ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s`)
  console.log(`Memory dir: ${MEMORY_DIR}`)
})

export { server }
