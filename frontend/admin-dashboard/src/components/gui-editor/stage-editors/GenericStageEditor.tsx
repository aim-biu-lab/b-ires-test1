/**
 * Generic Stage Editor
 * Renders fields based on stage type configuration from GUI schema
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import {
  getStageTypeConfig,
  GuiFieldDefinition,
  GuiSection,
  COMMON_STAGE_FIELDS,
  TIMING_FIELDS,
  QUOTA_FIELDS,
} from '../../../lib/gui-schema'
import { collectMissingDefaults } from '../../../lib/use-gui-yaml-sync'
import { FieldRenderer } from '../fields'

interface GenericStageEditorProps {
  stageType: string
  stageData: Record<string, unknown>
  onChange: (path: string, value: unknown) => void
  onBlur?: (path: string, value: unknown) => void
  onBatchChange?: (updates: Record<string, unknown>) => void
  disabled?: boolean
  experimentId?: string
}

export function GenericStageEditor({
  stageType,
  stageData,
  onChange,
  onBlur,
  onBatchChange,
  disabled,
  experimentId,
}: GenericStageEditorProps) {
  const config = getStageTypeConfig(stageType)
  const appliedDefaultsRef = useRef<string | null>(null)

  // Default sections if no config found
  const sections: GuiSection[] = config?.sections || [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
    { id: 'timing', label: 'Timing', collapsible: true },
    { id: 'quota', label: 'Quota', collapsible: true },
  ]

  // Get fields from config or use common fields
  const allFields = useMemo(() => {
    if (config?.fields) {
      return config.fields
    }
    // Fallback to common fields for unknown types
    return [
      ...COMMON_STAGE_FIELDS,
      ...TIMING_FIELDS.map((f) => ({ ...f, section: 'timing' })),
      ...QUOTA_FIELDS.map((f) => ({ ...f, section: 'quota' })),
    ]
  }, [config])

  // Apply defaults when stage changes or fields change
  useEffect(() => {
    // Create a unique key for this stage to track if we've already applied defaults
    const stageKey = `${stageData?.id || ''}-${stageType}`
    
    // Skip if we've already applied defaults for this stage
    if (appliedDefaultsRef.current === stageKey) {
      return
    }
    
    const dataWithDefaults = collectMissingDefaults(stageData, allFields)
    
    if (dataWithDefaults) {
      // Mark that we're applying defaults for this stage
      appliedDefaultsRef.current = stageKey
      
      if (onBatchChange) {
        // Use batch change if available (more efficient)
        onBatchChange(dataWithDefaults)
      } else {
        // Fall back to applying each default individually
        // We need to extract just the changed paths
        for (const field of allFields) {
          if (field.default !== undefined) {
            const parts = field.key.split('.')
            let current: unknown = stageData
            let hasValue = true
            for (const part of parts) {
              if (current === null || current === undefined || typeof current !== 'object') {
                hasValue = false
                break
              }
              current = (current as Record<string, unknown>)[part]
            }
            if (!hasValue || current === undefined) {
              onChange(field.key, field.default)
            }
          }
        }
      }
    } else {
      // No defaults needed, but mark the stage as processed
      appliedDefaultsRef.current = stageKey
    }
  }, [stageData, stageType, allFields, onChange, onBatchChange])

  // Track expanded sections
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(sections.filter((s) => s.defaultExpanded !== false).map((s) => s.id))
  )

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }

  // Get value from nested path like "config.layout" or "question.type"
  const getValue = (path: string): unknown => {
    const parts = path.split('.')
    let current: unknown = stageData
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  // Check if a field should be visible based on showWhen condition
  const isFieldVisible = (field: GuiFieldDefinition): boolean => {
    if (!field.showWhen) return true

    const conditionValue = getValue(field.showWhen.field)
    const targetValue = field.showWhen.value
    const operator = field.showWhen.operator || '=='

    if (operator === '==') {
      return conditionValue === targetValue
    } else if (operator === '!=') {
      return conditionValue !== targetValue
    } else if (operator === 'in' && Array.isArray(targetValue)) {
      return targetValue.includes(conditionValue)
    } else if (operator === 'notIn' && Array.isArray(targetValue)) {
      return !targetValue.includes(conditionValue)
    }

    return true
  }

  // Group fields by section
  const fieldsBySection = useMemo(() => {
    const grouped: Record<string, GuiFieldDefinition[]> = {}
    sections.forEach((section) => {
      grouped[section.id] = []
    })

    allFields.forEach((field) => {
      const sectionId = field.section || 'basic'
      if (grouped[sectionId]) {
        grouped[sectionId].push(field)
      } else {
        // Put in basic if section doesn't exist
        grouped['basic'] = grouped['basic'] || []
        grouped['basic'].push(field)
      }
    })

    return grouped
  }, [allFields, sections])

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        const sectionFields = fieldsBySection[section.id] || []
        const visibleFields = sectionFields.filter(isFieldVisible)

        if (visibleFields.length === 0) return null

        return (
          <SectionPanel
            key={section.id}
            section={section}
            expanded={expandedSections.has(section.id)}
            onToggle={() => toggleSection(section.id)}
          >
            <div className="space-y-4">
              {visibleFields.map((field) => (
                <FieldRenderer
                  key={field.key}
                  field={field}
                  value={getValue(field.key)}
                  onChange={(value) => onChange(field.key, value)}
                  onBlur={field.key === 'id' && onBlur ? (value) => {
                    console.log('[GenericStageEditor] onBlur for ID field, value:', value)
                    onBlur(field.key, value)
                  } : undefined}
                  disabled={disabled}
                  experimentId={experimentId}
                />
              ))}
            </div>
          </SectionPanel>
        )
      })}

      {/* Show timing and quota sections if they have fields */}
      {!config && (
        <>
          <SectionPanel
            section={{ id: 'timing', label: 'Timing', collapsible: true }}
            expanded={expandedSections.has('timing')}
            onToggle={() => toggleSection('timing')}
          >
            <div className="space-y-4">
              {TIMING_FIELDS.map((field) => (
                <FieldRenderer
                  key={field.key}
                  field={field}
                  value={getValue(field.key)}
                  onChange={(value) => onChange(field.key, value)}
                  disabled={disabled}
                  experimentId={experimentId}
                />
              ))}
            </div>
          </SectionPanel>

          <SectionPanel
            section={{ id: 'quota', label: 'Quota', collapsible: true }}
            expanded={expandedSections.has('quota')}
            onToggle={() => toggleSection('quota')}
          >
            <div className="space-y-4">
              {QUOTA_FIELDS.filter((f) => isFieldVisible(f)).map((field) => (
                <FieldRenderer
                  key={field.key}
                  field={field}
                  value={getValue(field.key)}
                  onChange={(value) => onChange(field.key, value)}
                  disabled={disabled}
                  experimentId={experimentId}
                />
              ))}
            </div>
          </SectionPanel>
        </>
      )}
    </div>
  )
}

// Section Panel Component
interface SectionPanelProps {
  section: GuiSection
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

function SectionPanel({ section, expanded, onToggle, children }: SectionPanelProps) {
  const isCollapsible = section.collapsible !== false

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <button
        type="button"
        onClick={isCollapsible ? onToggle : undefined}
        className={`w-full flex items-center justify-between px-4 py-3 text-left bg-gray-50 border-b border-gray-200 ${
          isCollapsible ? 'cursor-pointer hover:bg-gray-100' : 'cursor-default'
        } ${!expanded && isCollapsible ? 'border-b-0' : ''}`}
      >
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{section.label}</h3>
          {section.description && (
            <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
          )}
        </div>
        {isCollapsible && (
          <ChevronIcon
            className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </button>
      {expanded && <div className="p-4">{children}</div>}
    </div>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

