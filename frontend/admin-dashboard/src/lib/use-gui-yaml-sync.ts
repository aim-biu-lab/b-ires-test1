/**
 * Hook for bidirectional YAML-GUI synchronization
 * Manages state between YAML text and parsed object
 */

import { useCallback, useRef } from 'react'
import yaml from 'js-yaml'
import type { GuiFieldDefinition } from './gui-schema'

interface ParsedConfig {
  meta?: Record<string, unknown>
  shell_config?: Record<string, unknown>
  stages?: Array<{ id: string; type: string; [key: string]: unknown }>
  public_variables?: Record<string, unknown>
  [key: string]: unknown
}

export type EditSource = 'yaml' | 'gui'

/**
 * Set a nested value in an object using a dot-separated path
 * e.g., setNestedValue(obj, "config.layout", "2x2")
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const result = { ...obj }
  const parts = path.split('.')
  
  let current: Record<string, unknown> = result
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
      current[part] = {}
    } else {
      current[part] = { ...(current[part] as Record<string, unknown>) }
    }
    current = current[part] as Record<string, unknown>
  }
  
  const lastPart = parts[parts.length - 1]
  current[lastPart] = value
  
  return result
}

/**
 * Get a nested value from an object using a dot-separated path
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  
  return current
}

/**
 * Apply default values from field definitions to data object.
 * Returns an object with only the missing defaults that need to be applied,
 * or null if no defaults need to be applied.
 */
export function collectMissingDefaults(
  data: Record<string, unknown>,
  fields: GuiFieldDefinition[]
): Record<string, unknown> | null {
  let hasChanges = false
  let result = { ...data }
  
  for (const field of fields) {
    if (field.default !== undefined) {
      const currentValue = getNestedValue(data, field.key)
      if (currentValue === undefined) {
        result = setNestedValue(result, field.key, field.default)
        hasChanges = true
      }
    }
    
    // Recursively handle nested fields in arrays and objects
    if (field.itemSchema && Array.isArray(getNestedValue(data, field.key))) {
      const items = getNestedValue(data, field.key) as Record<string, unknown>[]
      const updatedItems = items.map(item => {
        const itemDefaults = collectMissingDefaults(item, field.itemSchema!)
        return itemDefaults || item
      })
      // Check if any items were updated
      if (updatedItems.some((item, i) => item !== items[i])) {
        result = setNestedValue(result, field.key, updatedItems)
        hasChanges = true
      }
    }
    
    if (field.properties) {
      const nestedData = (getNestedValue(data, field.key) as Record<string, unknown>) || {}
      const nestedDefaults = collectMissingDefaults(nestedData, field.properties)
      if (nestedDefaults) {
        result = setNestedValue(result, field.key, nestedDefaults)
        hasChanges = true
      }
    }
  }
  
  return hasChanges ? result : null
}

/**
 * Parse YAML content safely
 */
export function parseYamlSafe(content: string): { config: ParsedConfig | null; error: string | null } {
  try {
    const config = yaml.load(content) as ParsedConfig | null
    return { config, error: null }
  } catch (err) {
    return { config: null, error: err instanceof Error ? err.message : 'Invalid YAML' }
  }
}

/**
 * Serialize config to YAML
 */
export function serializeToYaml(config: ParsedConfig): string {
  return yaml.dump(config, { indent: 2, lineWidth: -1, noRefs: true })
}

/**
 * Hook for GUI-YAML synchronization
 */
export function useGuiYamlSync(
  yamlContent: string,
  onChange: (yaml: string) => void,
  isSettingsTab: boolean,
  stageIndex?: number
) {
  // Track last edit source to avoid loops
  const lastEditSourceRef = useRef<EditSource>('yaml')
  const isUpdatingRef = useRef(false)

  // Parse the full config
  const { config: fullConfig, error: parseError } = parseYamlSafe(yamlContent)

  // Get current data for the active tab
  const getCurrentData = useCallback((): Record<string, unknown> => {
    if (!fullConfig) return {}
    
    if (isSettingsTab) {
      // Return settings (meta + shell_config + public_variables)
      const { stages, ...settings } = fullConfig
      return settings
    } else if (stageIndex !== undefined && fullConfig.stages?.[stageIndex]) {
      return fullConfig.stages[stageIndex] as Record<string, unknown>
    }
    
    return {}
  }, [fullConfig, isSettingsTab, stageIndex])

  // Handle GUI field change
  const handleGuiChange = useCallback(
    (path: string, value: unknown) => {
      if (isUpdatingRef.current || parseError) return
      
      isUpdatingRef.current = true
      lastEditSourceRef.current = 'gui'

      try {
        if (!fullConfig) return

        let newConfig: ParsedConfig

        if (isSettingsTab) {
          // Update settings path
          newConfig = setNestedValue(fullConfig, path, value) as ParsedConfig
        } else if (stageIndex !== undefined) {
          // Update stage field
          const stages = [...(fullConfig.stages || [])]
          const currentStage = { ...stages[stageIndex] }
          const updatedStage = setNestedValue(currentStage, path, value)
          stages[stageIndex] = updatedStage as typeof stages[number]
          newConfig = { ...fullConfig, stages }
        } else {
          return
        }

        const newYaml = serializeToYaml(newConfig)
        onChange(newYaml)
      } finally {
        // Reset flag after a short delay to allow state to settle
        setTimeout(() => {
          isUpdatingRef.current = false
        }, 50)
      }
    },
    [fullConfig, isSettingsTab, stageIndex, parseError, onChange]
  )

  // Handle batch GUI changes (for applying multiple defaults at once)
  const handleBatchGuiChange = useCallback(
    (updatedData: Record<string, unknown>) => {
      if (isUpdatingRef.current || parseError) return
      
      isUpdatingRef.current = true
      lastEditSourceRef.current = 'gui'

      try {
        if (!fullConfig) return

        let newConfig: ParsedConfig

        if (isSettingsTab) {
          // Merge updated data into settings
          newConfig = { ...fullConfig }
          for (const [key, value] of Object.entries(updatedData)) {
            if (key !== 'stages') {
              newConfig = setNestedValue(newConfig, key, value) as ParsedConfig
            }
          }
        } else if (stageIndex !== undefined) {
          // Replace entire stage data
          const stages = [...(fullConfig.stages || [])]
          stages[stageIndex] = updatedData as typeof stages[number]
          newConfig = { ...fullConfig, stages }
        } else {
          return
        }

        const newYaml = serializeToYaml(newConfig)
        onChange(newYaml)
      } finally {
        // Reset flag after a short delay to allow state to settle
        setTimeout(() => {
          isUpdatingRef.current = false
        }, 50)
      }
    },
    [fullConfig, isSettingsTab, stageIndex, parseError, onChange]
  )

  return {
    currentData: getCurrentData(),
    handleGuiChange,
    handleBatchGuiChange,
    parseError,
    lastEditSource: lastEditSourceRef.current,
  }
}

