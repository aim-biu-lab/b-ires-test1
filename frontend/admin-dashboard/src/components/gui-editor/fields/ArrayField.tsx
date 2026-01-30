/**
 * Array Field Component
 * Dynamic list of items with add/remove/reorder/duplicate
 */

import { useState, useCallback } from 'react'
import { GuiFieldDefinition } from '../../../lib/gui-schema'
import { FieldRenderer } from './FieldRenderer'
import { DuplicationProvider } from '../../../lib/duplication-context'
import { generateSmartId, DuplicationSource } from '../../../lib/duplication-utils'
import { setNestedValue, getNestedValue } from '../../../lib/use-gui-yaml-sync'

interface ArrayFieldProps {
  field: GuiFieldDefinition
  value: unknown[] | undefined
  onChange: (value: unknown[]) => void
  disabled?: boolean
}

export function ArrayField({ field, value, onChange, disabled }: ArrayFieldProps) {
  const items = value || []
  const itemSchema = field.itemSchema || []
  const itemLabel = field.itemLabel || 'Item'
  const minItems = field.minItems ?? 0
  const maxItems = field.maxItems

  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set([0]))
  
  // Track duplication sources for items (key is item ID, value is source info)
  const [itemDuplicationSources, setItemDuplicationSources] = useState<Record<string, DuplicationSource>>({})

  const toggleExpanded = (index: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  // Generate next letter ID (a, b, c, ... z, aa, ab, etc.)
  const generateNextLetterId = useCallback((existingItems: unknown[]): string => {
    const existingIds = new Set<string>()
    existingItems.forEach((item) => {
      if (typeof item === 'object' && item !== null) {
        const id = (item as Record<string, unknown>).id
        if (typeof id === 'string') {
          existingIds.add(id.toLowerCase())
        }
      }
    })

    // Try single letters first (a-z)
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(97 + i) // 97 is 'a'
      if (!existingIds.has(letter)) {
        return letter
      }
    }

    // Then try double letters (aa, ab, ... zz)
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const letters = String.fromCharCode(97 + i) + String.fromCharCode(97 + j)
        if (!existingIds.has(letters)) {
          return letters
        }
      }
    }

    // Fallback
    return `item_${existingItems.length + 1}`
  }, [])

  const handleAddItem = useCallback(() => {
    // Create empty item with defaults from schema
    const newItem: Record<string, unknown> = {}
    
    // Check if this schema has an 'id' field that should be auto-generated
    const hasIdField = itemSchema.some((fieldDef) => fieldDef.key === 'id')
    
    itemSchema.forEach((fieldDef) => {
      if (fieldDef.key === 'id' && hasIdField) {
        // Auto-generate the next letter ID
        newItem[fieldDef.key] = generateNextLetterId(items)
      } else if (fieldDef.default !== undefined) {
        newItem[fieldDef.key] = fieldDef.default
      }
    })
    const newItems = [...items, newItem]
    onChange(newItems)
    setExpandedItems((prev) => new Set([...prev, newItems.length - 1]))
  }, [items, itemSchema, onChange, generateNextLetterId])

  const handleRemoveItem = useCallback(
    (index: number) => {
      if (items.length <= minItems) return
      const newItems = items.filter((_, i) => i !== index)
      onChange(newItems)
    },
    [items, minItems, onChange]
  )

  const handleMoveItem = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const newIndex = direction === 'up' ? index - 1 : index + 1
      if (newIndex < 0 || newIndex >= items.length) return

      const newItems = [...items]
      const temp = newItems[index]
      newItems[index] = newItems[newIndex]
      newItems[newIndex] = temp
      onChange(newItems)
    },
    [items, onChange]
  )

  const handleDuplicateItem = useCallback(
    (index: number) => {
      const originalItem = items[index] as Record<string, unknown>
      if (!originalItem) return

      // Deep clone the item
      const clonedItem = JSON.parse(JSON.stringify(originalItem))

      // Collect all existing IDs
      const existingIds: string[] = items.map((item) => {
        if (typeof item === 'object' && item !== null) {
          return (item as Record<string, unknown>).id as string
        }
        return ''
      }).filter(Boolean)

      // Generate new ID with numeric increment (not copy suffix)
      const originalId = originalItem.id as string
      if (originalId) {
        const newId = generateSmartId(originalId, existingIds, false)
        clonedItem.id = newId

        // Track duplication source for "unchanged" indicator
        const duplicationSource: DuplicationSource = {
          sourceId: originalId,
          originalValues: JSON.parse(JSON.stringify(originalItem)),
          timestamp: Date.now(),
        }
        setItemDuplicationSources(prev => ({
          ...prev,
          [newId]: duplicationSource,
        }))
      }

      // Insert after the original item
      const newItems = [...items]
      newItems.splice(index + 1, 0, clonedItem)
      onChange(newItems)

      // Expand the duplicated item
      setExpandedItems(prev => new Set([...prev, index + 1]))
    },
    [items, onChange]
  )

  // Clear duplication source when item ID changes
  const handleClearDuplicationSource = useCallback((itemId: string) => {
    setItemDuplicationSources(prev => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
  }, [])

  const handleItemFieldChange = useCallback(
    (itemIndex: number, fieldKey: string, fieldValue: unknown) => {
      const newItems = [...items]
      const item = newItems[itemIndex] as Record<string, unknown>
      // Use setNestedValue to handle nested paths like "style_config.margin_top"
      const updatedItem = setNestedValue(item, fieldKey, fieldValue)
      newItems[itemIndex] = updatedItem
      onChange(newItems)
    },
    [items, onChange]
  )

  // Handle blur for ID fields (which don't call onChange during typing)
  const handleItemFieldBlur = useCallback(
    (itemIndex: number, fieldKey: string, fieldValue: unknown) => {
      // For ID fields, blur is the save point
      const newItems = [...items]
      const item = newItems[itemIndex] as Record<string, unknown>
      // Use setNestedValue to handle nested paths like "style_config.margin_top"
      const updatedItem = setNestedValue(item, fieldKey, fieldValue)
      newItems[itemIndex] = updatedItem
      onChange(newItems)
    },
    [items, onChange]
  )

  const getItemTitle = (item: unknown, index: number): string => {
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>
      // Try common title fields
      const titleField = obj.label || obj.text || obj.content || obj.id || obj.field || obj.value
      if (typeof titleField === 'string' && titleField.length > 0) {
        return titleField.length > 40 ? titleField.substring(0, 40) + '...' : titleField
      }
    }
    return `${itemLabel} ${index + 1}`
  }

  const canAdd = !disabled && (maxItems === undefined || items.length < maxItems)
  const canRemove = !disabled && items.length > minItems

  // Check if a field should be visible based on showWhen condition
  const isFieldVisible = (fieldDef: GuiFieldDefinition, itemObj: Record<string, unknown>): boolean => {
    if (!fieldDef.showWhen) return true

    const conditionValue = itemObj[fieldDef.showWhen.field]
    const targetValue = fieldDef.showWhen.value
    const operator = fieldDef.showWhen.operator || '=='

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

  // Render item fields with gridRow grouping support
  const renderItemFields = (
    schema: GuiFieldDefinition[],
    itemObj: Record<string, unknown>,
    itemIndex: number
  ) => {
    // Filter visible fields first
    const visibleFields = schema.filter((fieldDef) => isFieldVisible(fieldDef, itemObj))

    // Group fields by gridRow
    const groups: { row: number | undefined; fields: GuiFieldDefinition[] }[] = []
    let currentGroup: { row: number | undefined; fields: GuiFieldDefinition[] } | null = null

    visibleFields.forEach((fieldDef) => {
      const row = fieldDef.gridRow

      if (row !== undefined) {
        // Field has a gridRow - check if we need to start a new group
        if (currentGroup && currentGroup.row === row) {
          currentGroup.fields.push(fieldDef)
        } else {
          // Start new grouped row
          currentGroup = { row, fields: [fieldDef] }
          groups.push(currentGroup)
        }
      } else {
        // Field has no gridRow - render standalone
        currentGroup = null
        groups.push({ row: undefined, fields: [fieldDef] })
      }
    })

    return groups.map((group, groupIndex) => {
      if (group.fields.length === 1) {
        // Single field - render normally
        const fieldDef = group.fields[0]
        return (
          <FieldRenderer
            key={fieldDef.key}
            field={fieldDef}
            value={getNestedValue(itemObj, fieldDef.key)}
            onChange={(v) => handleItemFieldChange(itemIndex, fieldDef.key, v)}
            onBlur={(v) => handleItemFieldBlur(itemIndex, fieldDef.key, v)}
            disabled={disabled}
          />
        )
      }

      // Multiple fields in a row - render in grid
      return (
        <div
          key={`row-${groupIndex}`}
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${group.fields.length}, minmax(0, 1fr))` }}
        >
          {group.fields.map((fieldDef) => (
            <FieldRenderer
              key={fieldDef.key}
              field={fieldDef}
              value={getNestedValue(itemObj, fieldDef.key)}
              onChange={(v) => handleItemFieldChange(itemIndex, fieldDef.key, v)}
              onBlur={(v) => handleItemFieldBlur(itemIndex, fieldDef.key, v)}
              disabled={disabled}
            />
          ))}
        </div>
      )
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <span className="text-xs text-gray-500">
          {items.length} {items.length === 1 ? itemLabel.toLowerCase() : `${itemLabel.toLowerCase()}s`}
          {maxItems !== undefined && ` (max ${maxItems})`}
        </span>
      </div>
      {field.description && <p className="text-xs text-gray-500">{field.description}</p>}

      {/* Items List */}
      <div className="space-y-2">
        {items.map((item, index) => {
          const isExpanded = expandedItems.has(index)
          const itemObj = (item || {}) as Record<string, unknown>

          return (
            <div
              key={index}
              className="border border-gray-200 rounded-lg overflow-hidden bg-white"
            >
              {/* Item Header */}
              <div
                className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 cursor-pointer hover:bg-gray-100"
                onClick={() => toggleExpanded(index)}
              >
                <div className="flex items-center gap-2">
                  <ChevronIcon
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                  />
                  <span className="text-sm font-medium text-gray-700">
                    {getItemTitle(item, index)}
                  </span>
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => handleMoveItem(index, 'up')}
                    disabled={disabled || index === 0}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move up"
                  >
                    <ChevronUpIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveItem(index, 'down')}
                    disabled={disabled || index === items.length - 1}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move down"
                  >
                    <ChevronDownIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicateItem(index)}
                    disabled={disabled || (maxItems !== undefined && items.length >= maxItems)}
                    className="p-1 text-gray-400 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Duplicate"
                  >
                    <DuplicateIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(index)}
                    disabled={!canRemove}
                    className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Remove"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Item Fields */}
              {isExpanded && (() => {
                const itemId = itemObj.id as string | undefined
                const itemSource = itemId ? itemDuplicationSources[itemId] : undefined
                
                return (
                  <DuplicationProvider
                    source={itemSource}
                    onClearSource={itemId ? () => handleClearDuplicationSource(itemId) : undefined}
                  >
                    <div className="p-3 space-y-3">
                      {itemSource && (
                        <div className="flex items-center justify-between mb-2 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs">
                          <span className="text-amber-700 flex items-center gap-1">
                            <DuplicateIcon className="w-3 h-3" />
                            Duplicated from {itemSource.sourceId}
                          </span>
                          <button
                            onClick={() => itemId && handleClearDuplicationSource(itemId)}
                            className="text-amber-500 hover:text-amber-700"
                            title="Dismiss"
                          >
                            <DismissIcon className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {renderItemFields(itemSchema, itemObj, index)}
                    </div>
                  </DuplicationProvider>
                )
              })()}
            </div>
          )
        })}
      </div>

      {/* Add Button */}
      <button
        type="button"
        onClick={handleAddItem}
        disabled={!canAdd}
        className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium border-2 border-dashed rounded-lg transition-colors ${
          canAdd
            ? 'border-gray-300 text-gray-600 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50'
            : 'border-gray-200 text-gray-400 cursor-not-allowed'
        }`}
      >
        <PlusIcon className="w-4 h-4" />
        Add {itemLabel}
      </button>
    </div>
  )
}

// Icons
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  )
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  )
}

function DuplicateIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  )
}

function DismissIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}


