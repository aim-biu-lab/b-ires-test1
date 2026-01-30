/**
 * Utility functions for smart duplication of stages/items
 * Handles intelligent ID and label generation with numeric pattern detection
 */

/**
 * Extracts and increments numeric patterns in a string
 * Examples:
 *   - "question_q2" → "question_q3"
 *   - "Question 2" → "Question 3"
 *   - "step_1_intro" → "step_2_intro"
 *   - "block_a_1" → "block_a_2"
 * 
 * If no numeric pattern found, returns null
 */
export function incrementNumericPattern(str: string): string | null {
  // Pattern 1: Number at the end (e.g., "Question 2", "step_1", "block_3")
  const endNumberMatch = str.match(/^(.+?)(\d+)$/)
  if (endNumberMatch) {
    const [, prefix, numStr] = endNumberMatch
    const num = parseInt(numStr, 10)
    return `${prefix}${num + 1}`
  }

  // Pattern 2: Number before underscore suffix (e.g., "step_1_intro" → "step_2_intro")
  const middleNumberMatch = str.match(/^(.+?)(\d+)(_[a-zA-Z]+)$/)
  if (middleNumberMatch) {
    const [, prefix, numStr, suffix] = middleNumberMatch
    const num = parseInt(numStr, 10)
    return `${prefix}${num + 1}${suffix}`
  }

  // Pattern 3: Number with letter prefix (e.g., "question_q2" → "question_q3")
  const letterPrefixNumberMatch = str.match(/^(.+_[a-zA-Z])(\d+)$/)
  if (letterPrefixNumberMatch) {
    const [, prefix, numStr] = letterPrefixNumberMatch
    const num = parseInt(numStr, 10)
    return `${prefix}${num + 1}`
  }

  return null
}

/**
 * Generates a smart new ID based on the original ID
 * @param originalId - The original ID to base the new one on
 * @param existingIds - Array of existing IDs to avoid conflicts
 * @param preferCopySuffix - If true, always use _copy suffix instead of incrementing numbers.
 *                           Use this for hierarchy duplication where refactoring will be used.
 */
export function generateSmartId(
  originalId: string, 
  existingIds: string[],
  preferCopySuffix: boolean = false
): string {
  // If preferCopySuffix is true, skip numeric increment and go straight to _copy
  if (!preferCopySuffix) {
    // First, try to increment numeric pattern
    let candidate = incrementNumericPattern(originalId)
    
    if (candidate && !existingIds.includes(candidate)) {
      return candidate
    }
    
    // If numeric increment exists but is taken, try incrementing further
    if (candidate) {
      let attempts = 0
      while (existingIds.includes(candidate) && attempts < 100) {
        const nextCandidate = incrementNumericPattern(candidate)
        if (nextCandidate) {
          candidate = nextCandidate
        } else {
          break
        }
        attempts++
      }
      if (!existingIds.includes(candidate)) {
        return candidate
      }
    }
  }
  
  // Fallback (or preferred): use _copy suffix
  let newId = `${originalId}_copy`
  if (!existingIds.includes(newId)) {
    return newId
  }
  
  let counter = 1
  while (existingIds.includes(`${originalId}_copy_${counter}`)) {
    counter++
  }
  return `${originalId}_copy_${counter}`
}

/**
 * Generates a smart new label based on the original label
 * @param originalLabel - The original label to base the new one on
 * @param existingLabels - Array of existing labels to avoid conflicts
 * @param preferCopySuffix - If true, always use (Copy) suffix instead of incrementing numbers.
 *                           Use this for hierarchy duplication where refactoring will be used.
 */
export function generateSmartLabel(
  originalLabel: string | undefined,
  existingLabels: string[],
  preferCopySuffix: boolean = false
): string | undefined {
  if (!originalLabel) return undefined
  
  // If preferCopySuffix is true, skip numeric increment and go straight to (Copy)
  if (!preferCopySuffix) {
    // First, try to increment numeric pattern
    let candidate = incrementNumericPattern(originalLabel)
    
    if (candidate && !existingLabels.includes(candidate)) {
      return candidate
    }
    
    // If numeric increment exists but is taken, try incrementing further
    if (candidate) {
      let attempts = 0
      while (existingLabels.includes(candidate) && attempts < 100) {
        const nextCandidate = incrementNumericPattern(candidate)
        if (nextCandidate) {
          candidate = nextCandidate
        } else {
          break
        }
        attempts++
      }
      if (!existingLabels.includes(candidate)) {
        return candidate
      }
    }
  }
  
  // Fallback (or preferred): use (Copy) suffix
  const baseCopyLabel = `${originalLabel} (Copy)`
  if (!existingLabels.includes(baseCopyLabel)) {
    return baseCopyLabel
  }
  
  let counter = 1
  while (existingLabels.includes(`${originalLabel} (Copy ${counter})`)) {
    counter++
  }
  return `${originalLabel} (Copy ${counter})`
}

/**
 * Deep comparison of two values
 * Returns true if values are deeply equal
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false
  
  if (typeof a === 'object') {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      return a.every((item, index) => deepEqual(item, b[index]))
    }
    
    if (Array.isArray(a) || Array.isArray(b)) return false
    
    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>
    const aKeys = Object.keys(aObj)
    const bKeys = Object.keys(bObj)
    
    if (aKeys.length !== bKeys.length) return false
    
    return aKeys.every(key => deepEqual(aObj[key], bObj[key]))
  }
  
  return false
}

/**
 * Represents the source data from which a stage was duplicated
 * Used to track unchanged values for visual indication
 */
export interface DuplicationSource {
  /** ID of the source stage that was duplicated */
  sourceId: string
  /** Original values from the source stage (deep clone) */
  originalValues: Record<string, unknown>
  /** Timestamp when duplication occurred */
  timestamp: number
}

/**
 * Checks if a field value is unchanged from the duplication source
 */
export function isValueUnchangedFromSource(
  fieldPath: string,
  currentValue: unknown,
  source: DuplicationSource | null | undefined
): boolean {
  if (!source) return false
  
  // Navigate to the value in original data
  const parts = fieldPath.split('.')
  let originalValue: unknown = source.originalValues
  
  for (const part of parts) {
    if (originalValue === null || originalValue === undefined) {
      return false
    }
    
    // Handle arrays with numeric indices
    if (Array.isArray(originalValue)) {
      const index = parseInt(part, 10)
      if (isNaN(index) || index < 0 || index >= originalValue.length) {
        return false
      }
      originalValue = originalValue[index]
    } else if (typeof originalValue === 'object') {
      originalValue = (originalValue as Record<string, unknown>)[part]
    } else {
      return false
    }
  }
  
  return deepEqual(currentValue, originalValue)
}

/**
 * Fields to exclude from "unchanged" tracking
 * These are expected to change during duplication
 */
export const EXCLUDED_FIELDS_FROM_TRACKING = ['id', 'label']

/**
 * Checks if a field should be tracked for unchanged indication
 */
export function shouldTrackField(fieldPath: string): boolean {
  const fieldName = fieldPath.split('.').pop() || fieldPath
  return !EXCLUDED_FIELDS_FROM_TRACKING.includes(fieldName)
}
