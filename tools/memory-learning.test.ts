import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { 
  memory_learn, 
  memory_patterns, 
  memory_corrections, 
  memory_apply_learnings,
  memory_learning_stats 
} from './memory-learning'

const TEST_MEMORY_DIR = path.join(process.cwd(), '.opencode', 'memory')
const LEARNING_FILE = path.join(TEST_MEMORY_DIR, 'learnings.md')
const PATTERNS_FILE = path.join(TEST_MEMORY_DIR, 'patterns.md')
const CORRECTIONS_FILE = path.join(TEST_MEMORY_DIR, 'corrections.md')

// Helper to read files
async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return ''
  }
}

// Helper to clean up test files
async function cleanupTestFiles() {
  try {
    await fs.rm(LEARNING_FILE, { force: true })
    await fs.rm(PATTERNS_FILE, { force: true })
    await fs.rm(CORRECTIONS_FILE, { force: true })
  } catch {}
}

describe('Memory Learning Tools', () => {
  beforeEach(async () => {
    await cleanupTestFiles()
  })

  afterEach(async () => {
    await cleanupTestFiles()
  })

  describe('memory_learn', () => {
    it('should learn a correction', async () => {
      const result = await memory_learn.execute({
        type: 'correction',
        content: 'Test correction',
        wrong: 'var x = 1',
        correct: 'const x = 1',
        context: 'JavaScript',
        tags: 'javascript,style',
      })

      expect(result).toContain('Learned correction')
      expect(result).toContain('var x = 1')
      expect(result).toContain('const x = 1')

      // Verify file was created
      const content = await readFileSafe(CORRECTIONS_FILE)
      expect(content).toContain('var x = 1')
      expect(content).toContain('const x = 1')
      expect(content).toContain('JavaScript')
    })

    it('should learn an insight', async () => {
      const result = await memory_learn.execute({
        type: 'insight',
        content: 'Always use early returns',
        context: 'Code style',
        tags: 'style,best-practice',
      })

      expect(result).toContain('Learned insight')
      expect(result).toContain('Always use early returns')

      // Verify file was created
      const content = await readFileSafe(LEARNING_FILE)
      expect(content).toContain('Always use early returns')
      expect(content).toContain('Code style')
    })

    it('should learn a preference', async () => {
      const result = await memory_learn.execute({
        type: 'preference',
        content: 'Prefer functional over OOP',
        context: 'Architecture',
        tags: 'architecture,preference',
      })

      expect(result).toContain('Learned preference')
      expect(result).toContain('Prefer functional over OOP')

      // Verify file was created
      const content = await readFileSafe(LEARNING_FILE)
      expect(content).toContain('Prefer functional over OOP')
    })

    it('should append to existing learnings', async () => {
      // First learning
      await memory_learn.execute({
        type: 'insight',
        content: 'First insight',
      })

      // Second learning
      await memory_learn.execute({
        type: 'insight',
        content: 'Second insight',
      })

      const content = await readFileSafe(LEARNING_FILE)
      expect(content).toContain('First insight')
      expect(content).toContain('Second insight')
    })
  })

  describe('memory_patterns', () => {
    it('should list patterns (empty)', async () => {
      const result = await memory_patterns.execute({
        action: 'list',
      })

      expect(result).toContain('No patterns found')
    })

    it('should add a pattern', async () => {
      const result = await memory_patterns.execute({
        action: 'add',
        name: 'Early Return',
        description: 'Use early returns for cleaner code',
        example: 'if (!valid) return;\n// ... rest of code',
        tags: 'style,clean-code',
      })

      expect(result).toContain('Added pattern')
      expect(result).toContain('Early Return')

      // Verify file was created
      const content = await readFileSafe(PATTERNS_FILE)
      expect(content).toContain('Early Return')
      expect(content).toContain('Use early returns')
    })

    it('should list patterns after adding', async () => {
      await memory_patterns.execute({
        action: 'add',
        name: 'Early Return',
        description: 'Use early returns for cleaner code',
        tags: 'style',
      })

      const result = await memory_patterns.execute({
        action: 'list',
      })

      expect(result).toContain('Early Return')
      expect(result).toContain('used 0x')
    })

    it('should search patterns', async () => {
      await memory_patterns.execute({
        action: 'add',
        name: 'React Hooks',
        description: 'Use hooks for state management',
        tags: 'react,hooks',
      })

      const result = await memory_patterns.execute({
        action: 'search',
        query: 'react hooks',
      })

      expect(result).toContain('React Hooks')
    })

    it('should use a pattern', async () => {
      // Add pattern
      await memory_patterns.execute({
        action: 'add',
        name: 'Test Pattern',
        description: 'Test pattern for usage',
        tags: 'test',
      })

      // Get the pattern ID from file
      const content = await readFileSafe(PATTERNS_FILE)
      const idMatch = content.match(/## \[([a-z0-9]+)\]/)
      expect(idMatch).toBeTruthy()

      if (idMatch) {
        const result = await memory_patterns.execute({
          action: 'use',
          id: idMatch[1],
        })

        expect(result).toContain('Used pattern')
        expect(result).toContain('now used 1x')
      }
    })

    it('should return error for missing name/description', async () => {
      const result = await memory_patterns.execute({
        action: 'add',
        name: 'Test',
      })

      expect(result).toContain('Error')
    })

    it('should return error for missing query', async () => {
      const result = await memory_patterns.execute({
        action: 'search',
      })

      expect(result).toContain('Error')
    })
  })

  describe('memory_corrections', () => {
    it('should list corrections (empty)', async () => {
      const result = await memory_corrections.execute({
        action: 'list',
      })

      expect(result).toContain('No corrections found')
    })

    it('should add and list corrections', async () => {
      // Add correction via memory_learn
      await memory_learn.execute({
        type: 'correction',
        content: 'Test',
        wrong: 'bad code',
        correct: 'good code',
        tags: 'test',
      })

      const result = await memory_corrections.execute({
        action: 'list',
      })

      expect(result).toContain('bad code')
      expect(result).toContain('good code')
    })

    it('should search corrections', async () => {
      await memory_learn.execute({
        type: 'correction',
        content: 'Test',
        wrong: 'var x',
        correct: 'const x',
        tags: 'javascript',
      })

      const result = await memory_corrections.execute({
        action: 'search',
        query: 'javascript',
      })

      expect(result).toContain('var x')
      expect(result).toContain('const x')
    })

    it('should show stats', async () => {
      await memory_learn.execute({
        type: 'correction',
        content: 'Test',
        wrong: 'test1',
        correct: 'test2',
        tags: 'test',
      })

      const result = await memory_corrections.execute({
        action: 'stats',
      })

      expect(result).toContain('Total corrections: 1')
      expect(result).toContain('code')
    })

    it('should filter by category', async () => {
      await memory_learn.execute({
        type: 'correction',
        content: 'Test',
        wrong: 'test1',
        correct: 'test2',
        tags: 'test',
      })

      const result = await memory_corrections.execute({
        action: 'list',
      })

      expect(result).toContain('test1')
    })
  })

  describe('memory_apply_learnings', () => {
    it('should apply learnings for context', async () => {
      // Add some corrections
      await memory_learn.execute({
        type: 'correction',
        content: 'Test',
        wrong: 'var x',
        correct: 'const x',
        tags: 'javascript',
      })

      const result = await memory_apply_learnings.execute({
        context: 'JavaScript code',
      })

      expect(result).toContain('Based on past corrections')
      expect(result).toContain('var x')
      expect(result).toContain('const x')
    })

    it('should apply patterns for context', async () => {
      // Add pattern
      await memory_patterns.execute({
        action: 'add',
        name: 'React Hook',
        description: 'Use useState for state',
        tags: 'react,hooks',
      })

      const result = await memory_apply_learnings.execute({
        context: 'React component',
      })

      expect(result).toContain('Relevant patterns')
      expect(result).toContain('React Hook')
    })

    it('should return no learnings message when empty', async () => {
      const result = await memory_apply_learnings.execute({
        context: 'Some random context',
      })

      expect(result).toContain('No relevant learnings found')
    })
  })

  describe('memory_learning_stats', () => {
    it('should show stats for empty system', async () => {
      const result = await memory_learning_stats.execute({})

      expect(result).toContain('Learning System Stats:')
      expect(result).toContain('Total learnings: 0')
      expect(result).toContain('Total corrections: 0')
      expect(result).toContain('Total patterns: 0')
    })

    it('should show stats with data', async () => {
      await memory_learn.execute({
        type: 'correction',
        content: 'Test',
        wrong: 'test1',
        correct: 'test2',
        tags: 'test',
      })

      await memory_patterns.execute({
        action: 'add',
        name: 'Test Pattern',
        description: 'Test',
        tags: 'test',
      })

      const result = await memory_learning_stats.execute({})

      expect(result).toContain('Total corrections: 1')
      expect(result).toContain('Total patterns: 1')
      expect(result).toContain('code')
    })
  })
})
