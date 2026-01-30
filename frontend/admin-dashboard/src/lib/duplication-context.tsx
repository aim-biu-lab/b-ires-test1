/**
 * Duplication Context
 * Provides context for tracking duplicated items and visual indication of unchanged values
 */

import { createContext, useContext, useMemo, useCallback, ReactNode } from 'react'
import { DuplicationSource, isValueUnchangedFromSource, shouldTrackField } from './duplication-utils'

interface DuplicationContextValue {
  /** Source information for the currently selected item (if it was duplicated) */
  source: DuplicationSource | null
  /** Check if a field value is unchanged from the duplication source */
  isUnchanged: (fieldPath: string, currentValue: unknown) => boolean
  /** Clear the duplication source for an item (call when source is no longer needed) */
  clearSource: () => void
  /** Current path prefix for nested fields (e.g., "questions.0" for array items) */
  pathPrefix: string
}

const DuplicationContext = createContext<DuplicationContextValue | null>(null)

interface DuplicationProviderProps {
  /** The duplication source for the current item, if any */
  source: DuplicationSource | null | undefined
  /** Callback to clear the duplication source */
  onClearSource?: () => void
  /** Path prefix for nested context (used by arrays) */
  pathPrefix?: string
  children: ReactNode
}

export function DuplicationProvider({ 
  source, 
  onClearSource,
  pathPrefix = '',
  children 
}: DuplicationProviderProps) {
  // Debug: log source on render
  console.log('[DuplicationProvider] Render - source:', source ? { sourceId: source.sourceId, keys: Object.keys(source.originalValues) } : null, 'pathPrefix:', pathPrefix)
  
  const isUnchanged = useCallback((fieldPath: string, currentValue: unknown): boolean => {
    // Construct full path by combining prefix and field path
    const fullPath = pathPrefix ? `${pathPrefix}.${fieldPath}` : fieldPath
    if (!shouldTrackField(fullPath)) return false
    return isValueUnchangedFromSource(fullPath, currentValue, source)
  }, [source, pathPrefix])

  const clearSource = useCallback(() => {
    onClearSource?.()
  }, [onClearSource])

  const contextValue = useMemo(() => ({
    source: source ?? null,
    isUnchanged,
    clearSource,
    pathPrefix,
  }), [source, isUnchanged, clearSource, pathPrefix])

  return (
    <DuplicationContext.Provider value={contextValue}>
      {children}
    </DuplicationContext.Provider>
  )
}

/**
 * Hook to access duplication context
 * Returns null if not inside a DuplicationProvider or no source
 */
export function useDuplicationContext(): DuplicationContextValue | null {
  return useContext(DuplicationContext)
}

/**
 * Hook to check if a field value is unchanged from duplication source
 * Safe to use outside of DuplicationProvider (returns false)
 */
export function useIsFieldUnchanged(fieldPath: string, currentValue: unknown): boolean {
  const context = useContext(DuplicationContext)
  if (!context) return false
  return context.isUnchanged(fieldPath, currentValue)
}

/**
 * Component to create a nested duplication context with a path prefix
 * Used by ArrayField to provide correct path context for array items
 */
interface NestedDuplicationProviderProps {
  /** Additional path segment to add (e.g., "questions.0") */
  pathSegment: string
  children: ReactNode
}

export function NestedDuplicationProvider({ pathSegment, children }: NestedDuplicationProviderProps) {
  const parentContext = useContext(DuplicationContext)
  
  // If no parent context or no source, just render children without wrapper
  if (!parentContext || !parentContext.source) {
    return <>{children}</>
  }
  
  // Construct the full path prefix
  const fullPathPrefix = parentContext.pathPrefix 
    ? `${parentContext.pathPrefix}.${pathSegment}` 
    : pathSegment
  
  return (
    <DuplicationProvider
      source={parentContext.source}
      onClearSource={parentContext.clearSource}
      pathPrefix={fullPathPrefix}
    >
      {children}
    </DuplicationProvider>
  )
}
