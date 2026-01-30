/**
 * Hierarchy Item Editor Component
 * 
 * GUI editor for phases, stages, and blocks in the 4-level hierarchy.
 * Renders appropriate fields based on item type with context-aware
 * rules editors for ordering, weights, and visibility.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import {
  GuiFieldDefinition,
  GuiSection,
  PHASE_FIELDS,
  BLOCK_FIELDS,
  RULES_FIELDS,
  UI_SETTINGS_FIELDS,
  HIERARCHY_SECTIONS,
} from '../../../lib/gui-schema'
import { collectMissingDefaults } from '../../../lib/use-gui-yaml-sync'
import { FieldRenderer } from '../fields'

// Types for hierarchy items
export interface HierarchyChild {
  id: string
  label?: string
  title?: string
  type?: string
}

export interface HierarchyContext {
  children: HierarchyChild[]
  availableVariables: VariableInfo[]
  parentPath: string[]
  itemType: 'phase' | 'stage' | 'block'
}

export interface VariableInfo {
  path: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'array'
  source: 'stage' | 'participant' | 'environment' | 'assignment'
}

interface HierarchyItemEditorProps {
  itemType: 'phase' | 'stage' | 'block'
  itemData: Record<string, unknown>
  onChange: (path: string, value: unknown) => void
  onBlur?: (path: string, value: unknown) => void
  onBatchChange?: (updates: Record<string, unknown>) => void
  disabled?: boolean
  context?: HierarchyContext
}

// Stage-level fields (when a stage has a type, it's like a task)
const STAGE_BASIC_FIELDS: GuiFieldDefinition[] = [
  {
    key: 'id',
    label: 'Stage ID',
    description: 'Unique identifier for this stage (snake_case)',
    type: 'text',
    required: true,
    placeholder: 'my_stage',
    section: 'basic',
  },
  {
    key: 'type',
    label: 'Stage Type',
    description: 'Type determines the stage behavior (leave empty for container stages)',
    type: 'select',
    options: [
      { value: '', label: '— Container (no type) —' },
      { value: 'questionnaire', label: 'Questionnaire' },
      { value: 'user_info', label: 'User Info' },
      { value: 'participant_identity', label: 'Participant Identity' },
      { value: 'consent_form', label: 'Consent Form' },
      { value: 'content_display', label: 'Content Display' },
      { value: 'video_player', label: 'Video Player' },
      { value: 'iframe_sandbox', label: 'Iframe Sandbox' },
      { value: 'multiple_choice', label: 'Multiple Choice' },
      { value: 'external_task', label: 'External Task' },
      { value: 'likert_scale', label: 'Likert Scale' },
      { value: 'attention_check', label: 'Attention Check' },
    ],
    section: 'basic',
  },
  {
    key: 'label',
    label: 'Display Label',
    description: 'Label shown in sidebar and progress indicators',
    type: 'text',
    placeholder: 'Stage Label',
    section: 'basic',
  },
  {
    key: 'title',
    label: 'Title',
    description: 'Title shown to participants',
    type: 'text',
    placeholder: 'Stage Title',
    section: 'basic',
  },
  {
    key: 'description',
    label: 'Description',
    description: 'Brief description or instructions',
    type: 'textarea',
    rows: 2,
    placeholder: 'Instructions for this stage',
    section: 'basic',
  },
]

export function HierarchyItemEditor({
  itemType,
  itemData,
  onChange,
  onBlur,
  onBatchChange,
  disabled,
  context,
}: HierarchyItemEditorProps) {
  console.log('[HierarchyItemEditor] Rendered - onBlur prop exists:', !!onBlur)
  const appliedDefaultsRef = useRef<string | null>(null)

  // Get fields based on item type
  const allFields = useMemo(() => {
    let baseFields: GuiFieldDefinition[]
    
    switch (itemType) {
      case 'phase':
        baseFields = PHASE_FIELDS
        break
      case 'stage':
        // For stages, use stage-specific basic fields
        baseFields = [
          ...STAGE_BASIC_FIELDS,
          ...RULES_FIELDS.map(f => ({ ...f, section: 'rules' })),
          ...UI_SETTINGS_FIELDS.map(f => ({ ...f, section: 'ui' })),
        ]
        break
      case 'block':
        baseFields = BLOCK_FIELDS
        break
      default:
        baseFields = PHASE_FIELDS
    }
    
    return baseFields
  }, [itemType])

  // Get sections
  const sections = useMemo((): GuiSection[] => {
    return HIERARCHY_SECTIONS
  }, [])

  // Apply defaults when item changes
  useEffect(() => {
    const itemKey = `${itemData?.id || ''}-${itemType}`
    
    if (appliedDefaultsRef.current === itemKey) {
      return
    }
    
    const dataWithDefaults = collectMissingDefaults(itemData, allFields)
    
    if (dataWithDefaults) {
      appliedDefaultsRef.current = itemKey
      
      if (onBatchChange) {
        onBatchChange(dataWithDefaults)
      } else {
        for (const field of allFields) {
          if (field.default !== undefined) {
            const parts = field.key.split('.')
            let current: unknown = itemData
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
      appliedDefaultsRef.current = itemKey
    }
  }, [itemData, itemType, allFields, onChange, onBatchChange])

  // Track expanded sections
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(sections.filter(s => s.defaultExpanded !== false).map(s => s.id))
  )

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }

  // Get value from nested path
  const getValue = (path: string): unknown => {
    const parts = path.split('.')
    let current: unknown = itemData
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
    sections.forEach(section => {
      grouped[section.id] = []
    })

    allFields.forEach(field => {
      const sectionId = field.section || 'basic'
      if (grouped[sectionId]) {
        grouped[sectionId].push(field)
      } else {
        grouped['basic'] = grouped['basic'] || []
        grouped['basic'].push(field)
      }
    })

    return grouped
  }, [allFields, sections])

  // Get ordering mode for context
  const orderingMode = getValue('rules.ordering') as string | undefined

  return (
    <div className="space-y-4">
      {/* Item Type Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
        <ItemTypeIcon type={itemType} />
        <div>
          <h3 className="text-sm font-semibold text-slate-800 capitalize">
            {itemType} Properties
          </h3>
          <p className="text-xs text-slate-500">
            Configure settings for this {itemType}
          </p>
        </div>
      </div>

      {sections.map(section => {
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
              {visibleFields.map(field => (
                <FieldRenderer
                  key={field.key}
                  field={field}
                  value={getValue(field.key)}
                  onChange={(value) => onChange(field.key, value)}
                  onBlur={field.key === 'id' && onBlur ? (value) => {
                    console.log('[HierarchyItemEditor] onBlur wrapper called - field:', field.key, 'value:', value)
                    onBlur(field.key, value)
                  } : undefined}
                  disabled={disabled}
                  context={{
                    children: context?.children || [],
                    orderingMode,
                    availableVariables: context?.availableVariables || [],
                  }}
                />
              ))}
            </div>
          </SectionPanel>
        )
      })}

      {/* Children Summary */}
      {context?.children && context.children.length > 0 && (
        <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
            Children ({context.children.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {context.children.map(child => (
              <span
                key={child.id}
                className="inline-flex items-center px-2 py-0.5 text-xs bg-white border border-slate-200 rounded text-slate-700"
              >
                {child.label || child.id}
              </span>
            ))}
          </div>
        </div>
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
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
      <button
        type="button"
        onClick={isCollapsible ? onToggle : undefined}
        className={`w-full flex items-center justify-between px-4 py-3 text-left bg-slate-50 border-b border-slate-200 ${
          isCollapsible ? 'cursor-pointer hover:bg-slate-100' : 'cursor-default'
        } ${!expanded && isCollapsible ? 'border-b-0' : ''}`}
      >
        <div className="flex items-center gap-2">
          <SectionIcon sectionId={section.id} />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{section.label}</h3>
            {section.description && (
              <p className="text-xs text-slate-500 mt-0.5">{section.description}</p>
            )}
          </div>
        </div>
        {isCollapsible && (
          <ChevronIcon
            className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </button>
      {expanded && <div className="p-4">{children}</div>}
    </div>
  )
}

// Item Type Icon
function ItemTypeIcon({ type }: { type: 'phase' | 'stage' | 'block' }) {
  const iconClass = 'w-5 h-5'
  const bgClass = 'w-8 h-8 rounded-lg flex items-center justify-center'

  switch (type) {
    case 'phase':
      return (
        <div className={`${bgClass} bg-violet-100`}>
          <svg className={`${iconClass} text-violet-600`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
      )
    case 'stage':
      return (
        <div className={`${bgClass} bg-blue-100`}>
          <svg className={`${iconClass} text-blue-600`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </div>
      )
    case 'block':
      return (
        <div className={`${bgClass} bg-emerald-100`}>
          <svg className={`${iconClass} text-emerald-600`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
      )
  }
}

// Section Icon
function SectionIcon({ sectionId }: { sectionId: string }) {
  const className = 'w-4 h-4 text-slate-400'

  switch (sectionId) {
    case 'basic':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    case 'rules':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      )
    case 'ui':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      )
    default:
      return null
  }
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

export default HierarchyItemEditor


