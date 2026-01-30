/**
 * Utility functions for refactoring duplicated items
 * Handles ID prefix replacement and text substitutions
 */

export interface RefactorRules {
  /** ID prefix replacement rule (e.g., "ben_lesser_" → "helen_fogel_") */
  idPrefix?: { from: string; to: string }
  /** Text replacement rules for content */
  textRules: Array<{ from: string; to: string }>
  /** Remove copy suffixes from IDs and labels */
  removeCopySuffixes?: boolean
}

/**
 * Patterns for copy suffixes in IDs (e.g., _copy, _copy_1, _copy_2)
 */
const ID_COPY_SUFFIX_PATTERN = /_copy(_\d+)?$/

/**
 * Patterns for copy suffixes in labels/text (e.g., (Copy), (Copy 1), (Copy 2))
 */
const TEXT_COPY_SUFFIX_PATTERN = /\s*\(Copy(\s+\d+)?\)$/

/**
 * Check if rules have any non-empty values
 */
export function hasActiveRules(rules: RefactorRules): boolean {
  const hasIdPrefix = !!(rules.idPrefix?.from && rules.idPrefix?.to)
  const hasTextRules = rules.textRules.some(r => r.from && r.to)
  const hasRemoveCopy = !!rules.removeCopySuffixes
  return hasIdPrefix || hasTextRules || hasRemoveCopy
}

/**
 * Remove copy suffix from an ID string
 */
function removeIdCopySuffix(id: string): string {
  return id.replace(ID_COPY_SUFFIX_PATTERN, '')
}

/**
 * Remove copy suffix from a text/label string
 */
function removeTextCopySuffix(text: string): string {
  return text.replace(TEXT_COPY_SUFFIX_PATTERN, '')
}

/**
 * Apply text replacement rules to a string
 */
function applyTextRules(value: string, rules: RefactorRules, isLabelField: boolean = false): string {
  let result = value
  
  // Apply text replacement rules
  for (const rule of rules.textRules) {
    if (rule.from && rule.to) {
      // Use global replacement
      result = result.split(rule.from).join(rule.to)
    }
  }
  
  // Remove copy suffixes from labels if enabled
  if (rules.removeCopySuffixes && isLabelField) {
    result = removeTextCopySuffix(result)
  }
  
  return result
}

/**
 * Apply ID prefix replacement to an ID string
 */
function applyIdPrefixRule(id: string, rules: RefactorRules): string {
  let result = id
  
  // Apply prefix replacement
  if (rules.idPrefix?.from && rules.idPrefix?.to) {
    // Replace prefix if it matches
    if (result.startsWith(rules.idPrefix.from)) {
      result = rules.idPrefix.to + result.slice(rules.idPrefix.from.length)
    } else {
      // Also try replacing anywhere in the ID (for nested patterns)
      result = result.split(rules.idPrefix.from).join(rules.idPrefix.to)
    }
  }
  
  // Remove copy suffix if enabled
  if (rules.removeCopySuffixes) {
    result = removeIdCopySuffix(result)
  }
  
  return result
}

/**
 * Fields that should be treated as IDs (apply ID prefix rule)
 */
const ID_FIELDS = ['id', 'field', 'variable', 'target_variable', 'source_variable']

/**
 * Fields that should have text rules applied
 */
const TEXT_FIELDS = ['label', 'title', 'description', 'content', 'text', 'placeholder', 'name', 'validation_message', 'error_message', 'help_text', 'subtitle', 'heading', 'body']

/**
 * Fields that are labels (should have copy suffix removed)
 */
const LABEL_FIELDS = ['label', 'title', 'name']

/**
 * Recursively apply refactor rules to an object
 * Returns a new deep-cloned object with replacements applied
 */
export function applyRefactorRules(obj: unknown, rules: RefactorRules): unknown {
  if (!hasActiveRules(rules)) {
    return obj
  }

  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj === 'string') {
    // Apply text rules to all strings
    return applyTextRules(obj, rules)
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(item => applyRefactorRules(item, rules))
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        const isLabelField = LABEL_FIELDS.includes(key)
        
        // Check if this is an ID field
        if (ID_FIELDS.includes(key)) {
          // Apply both ID prefix rule and text rules
          let newValue = applyIdPrefixRule(value, rules)
          newValue = applyTextRules(newValue, rules, false)
          result[key] = newValue
        } else if (TEXT_FIELDS.includes(key)) {
          // Apply text rules for text fields
          result[key] = applyTextRules(value, rules, isLabelField)
        } else {
          // For other string fields, still apply text rules (for flexibility)
          result[key] = applyTextRules(value, rules, false)
        }
      } else {
        // Recursively process nested objects/arrays
        result[key] = applyRefactorRules(value, rules)
      }
    }
    
    return result
  }

  return obj
}

/**
 * Count how many replacements would be made by the rules
 * Returns { idReplacements, textReplacements, copySuffixRemovals }
 */
export function countReplacements(obj: unknown, rules: RefactorRules): { idReplacements: number; textReplacements: number; copySuffixRemovals: number } {
  let idReplacements = 0
  let textReplacements = 0
  let copySuffixRemovals = 0

  function countInString(value: string, isIdField: boolean, isLabelField: boolean): void {
    // Count ID prefix replacements
    if (isIdField && rules.idPrefix?.from && rules.idPrefix?.to) {
      if (value.includes(rules.idPrefix.from)) {
        idReplacements += value.split(rules.idPrefix.from).length - 1
      }
    }
    
    // Count text rule replacements
    for (const rule of rules.textRules) {
      if (rule.from && rule.to && value.includes(rule.from)) {
        textReplacements += value.split(rule.from).length - 1
      }
    }
    
    // Count copy suffix removals
    if (rules.removeCopySuffixes) {
      if (isIdField && ID_COPY_SUFFIX_PATTERN.test(value)) {
        copySuffixRemovals++
      }
      if (isLabelField && TEXT_COPY_SUFFIX_PATTERN.test(value)) {
        copySuffixRemovals++
      }
    }
  }

  function traverse(obj: unknown, parentKey?: string): void {
    if (obj === null || obj === undefined) return

    if (typeof obj === 'string') {
      const isIdField = parentKey ? ID_FIELDS.includes(parentKey) : false
      const isLabelField = parentKey ? LABEL_FIELDS.includes(parentKey) : false
      countInString(obj, isIdField, isLabelField)
      return
    }

    if (Array.isArray(obj)) {
      obj.forEach(item => traverse(item))
      return
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          const isIdField = ID_FIELDS.includes(key)
          const isLabelField = LABEL_FIELDS.includes(key)
          countInString(value, isIdField, isLabelField)
        } else {
          traverse(value, key)
        }
      }
    }
  }

  traverse(obj)
  return { idReplacements, textReplacements, copySuffixRemovals }
}

/**
 * Check if an object contains copy suffixes in IDs or labels
 */
export function hasCopySuffixes(obj: unknown): boolean {
  let found = false
  
  function traverse(obj: unknown, parentKey?: string): void {
    if (found) return
    if (obj === null || obj === undefined) return

    if (typeof obj === 'string') {
      const isIdField = parentKey ? ID_FIELDS.includes(parentKey) : false
      const isLabelField = parentKey ? LABEL_FIELDS.includes(parentKey) : false
      
      if (isIdField && ID_COPY_SUFFIX_PATTERN.test(obj)) {
        found = true
        return
      }
      if (isLabelField && TEXT_COPY_SUFFIX_PATTERN.test(obj)) {
        found = true
        return
      }
      return
    }

    if (Array.isArray(obj)) {
      obj.forEach(item => traverse(item))
      return
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          const isIdField = ID_FIELDS.includes(key)
          const isLabelField = LABEL_FIELDS.includes(key)
          
          if (isIdField && ID_COPY_SUFFIX_PATTERN.test(value)) {
            found = true
            return
          }
          if (isLabelField && TEXT_COPY_SUFFIX_PATTERN.test(value)) {
            found = true
            return
          }
        } else {
          traverse(value, key)
        }
      }
    }
  }

  traverse(obj)
  return found
}

/**
 * Extract potential ID prefixes from an object
 * Looks for common patterns in ID fields
 */
export function extractIdPrefixes(obj: unknown): string[] {
  const prefixes = new Set<string>()
  
  function extractFromId(id: string): void {
    // Look for underscore-separated prefixes
    const parts = id.split('_')
    if (parts.length >= 2) {
      // Add progressively longer prefixes
      let prefix = ''
      for (let i = 0; i < parts.length - 1; i++) {
        prefix += (i > 0 ? '_' : '') + parts[i]
        if (prefix.length >= 2) {
          prefixes.add(prefix + '_')
        }
      }
    }
  }

  function traverse(obj: unknown, parentKey?: string): void {
    if (obj === null || obj === undefined) return

    if (typeof obj === 'string' && parentKey && ID_FIELDS.includes(parentKey)) {
      extractFromId(obj)
      return
    }

    if (Array.isArray(obj)) {
      obj.forEach(item => traverse(item))
      return
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && ID_FIELDS.includes(key)) {
          extractFromId(value)
        } else {
          traverse(value, key)
        }
      }
    }
  }

  traverse(obj)
  
  // Sort by length (longer prefixes first) and return most common
  return Array.from(prefixes).sort((a, b) => b.length - a.length).slice(0, 10)
}

/**
 * Extract potential text patterns from an object
 * Looks for repeated text in text fields
 */
export function extractTextPatterns(obj: unknown): string[] {
  const textValues: string[] = []
  
  function traverse(obj: unknown, parentKey?: string): void {
    if (obj === null || obj === undefined) return

    if (typeof obj === 'string' && parentKey && TEXT_FIELDS.includes(parentKey)) {
      if (obj.length >= 2 && obj.length <= 100) {
        textValues.push(obj)
      }
      return
    }

    if (Array.isArray(obj)) {
      obj.forEach(item => traverse(item))
      return
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        traverse(value, key)
      }
    }
  }

  traverse(obj)
  
  // Find words/phrases that appear multiple times
  const wordCounts = new Map<string, number>()
  
  for (const text of textValues) {
    // Extract words (2+ characters)
    const words = text.match(/\b[A-Za-z]{2,}\b/g) || []
    for (const word of words) {
      if (word.length >= 3) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1)
      }
    }
  }
  
  // Return words that appear multiple times, sorted by frequency
  return Array.from(wordCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 10)
}
