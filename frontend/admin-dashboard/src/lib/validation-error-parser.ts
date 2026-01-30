/**
 * Parses validation error messages and maps them to YAML locations
 * 
 * Error format: "Stage[4].fields[6]: Missing 'label'"
 * This means: stages array, index 4, fields array, index 6
 */

export interface ParsedValidationError {
  original: string
  path: string
  message: string
  stageIndex: number | null
  fieldPath: string[] // e.g., ["fields", "6"] or ["questions", "2", "options", "1"]
}

/**
 * Parse a validation error message into structured data
 */
export function parseValidationError(error: string): ParsedValidationError {
  // Match pattern: Stage[N].path: message
  const stageMatch = error.match(/^Stage\[(\d+)\]\.?(.*):\s*(.+)$/i)
  
  if (stageMatch) {
    const stageIndex = parseInt(stageMatch[1], 10)
    const pathPart = stageMatch[2] || ''
    const message = stageMatch[3]
    
    // Parse the field path (e.g., "fields[6]" -> ["fields", "6"])
    const fieldPath = parseFieldPath(pathPart)
    
    return {
      original: error,
      path: `Stage[${stageIndex}]${pathPart ? '.' + pathPart : ''}`,
      message,
      stageIndex,
      fieldPath,
    }
  }
  
  // Match pattern for settings errors: meta.field or shell_config.field
  const settingsMatch = error.match(/^(meta|shell_config)\.?(.*):\s*(.+)$/i)
  if (settingsMatch) {
    const rootKey = settingsMatch[1]
    const pathPart = settingsMatch[2] || ''
    const message = settingsMatch[3]
    
    const fieldPath = [rootKey, ...parseFieldPath(pathPart)]
    
    return {
      original: error,
      path: `${rootKey}${pathPart ? '.' + pathPart : ''}`,
      message,
      stageIndex: null, // Refers to settings, not a stage
      fieldPath,
    }
  }
  
  // Fallback - couldn't parse
  return {
    original: error,
    path: '',
    message: error,
    stageIndex: null,
    fieldPath: [],
  }
}

/**
 * Parse a field path like "fields[6].options[2]" into ["fields", "6", "options", "2"]
 */
function parseFieldPath(path: string): string[] {
  if (!path) return []
  
  const result: string[] = []
  // Match either property names or array indices
  const regex = /([a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])/g
  let match
  
  while ((match = regex.exec(path)) !== null) {
    let part = match[1]
    // Remove brackets from array index
    if (part.startsWith('[') && part.endsWith(']')) {
      part = part.slice(1, -1)
    }
    result.push(part)
  }
  
  return result
}

/**
 * Find the line number in YAML content for a given field path
 * 
 * @param yamlContent The YAML string to search
 * @param fieldPath Array like ["fields", "6", "label"]
 * @returns Line number (1-indexed) or null if not found
 */
export function findLineInYaml(yamlContent: string, fieldPath: string[]): number | null {
  if (fieldPath.length === 0) return 1
  
  const lines = yamlContent.split('\n')
  
  // Track current position in the path
  let pathIndex = 0
  let currentArrayIndex = -1
  let targetArrayIndex = -1
  let lastMatchLine = 0
  
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]
    const trimmed = line.trim()
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue
    
    const currentTarget = fieldPath[pathIndex]
    
    // Check if this is an array index we're looking for
    if (!isNaN(parseInt(currentTarget, 10))) {
      targetArrayIndex = parseInt(currentTarget, 10)
      
      // Check if this is a list item (starts with -)
      if (trimmed.startsWith('-')) {
        currentArrayIndex++
        
        if (currentArrayIndex === targetArrayIndex) {
          lastMatchLine = lineNum + 1 // 1-indexed
          pathIndex++
          currentArrayIndex = -1
          targetArrayIndex = -1
          
          // If we've matched all path parts, return this line
          if (pathIndex >= fieldPath.length) {
            return lastMatchLine
          }
        }
      }
    } else {
      // Looking for a property name
      // Match "propertyName:" at the start (accounting for list item prefix)
      const propMatch = trimmed.match(/^-?\s*([a-zA-Z_][a-zA-Z0-9_]*):\s*/)
      
      if (propMatch && propMatch[1] === currentTarget) {
        lastMatchLine = lineNum + 1 // 1-indexed
        pathIndex++
        currentArrayIndex = -1
        
        // If we've matched all path parts, return this line
        if (pathIndex >= fieldPath.length) {
          return lastMatchLine
        }
      }
    }
  }
  
  // Return the last matched line, or first line if nothing matched
  return lastMatchLine > 0 ? lastMatchLine : 1
}

/**
 * Get all validation errors grouped by stage
 */
export function groupErrorsByStage(errors: string[]): Map<number | null, ParsedValidationError[]> {
  const grouped = new Map<number | null, ParsedValidationError[]>()
  
  for (const error of errors) {
    const parsed = parseValidationError(error)
    const existing = grouped.get(parsed.stageIndex) || []
    existing.push(parsed)
    grouped.set(parsed.stageIndex, existing)
  }
  
  return grouped
}



