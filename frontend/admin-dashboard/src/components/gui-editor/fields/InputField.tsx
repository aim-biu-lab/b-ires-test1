/**
 * Input Field Component
 * Text input for string values
 */

import { useState, useEffect, useRef } from 'react'
import { GuiFieldDefinition } from '../../../lib/gui-schema'
import { useIsFieldUnchanged } from '../../../lib/duplication-context'

interface InputFieldProps {
  field: GuiFieldDefinition
  value: string | undefined
  onChange: (value: string) => void
  onBlur?: (value: string) => void
  disabled?: boolean
}

export function InputField({ field, value, onChange, onBlur, disabled }: InputFieldProps) {
  const currentValue = value ?? (field.default as string) ?? ''
  const isIdField = field.key === 'id'
  
  // Check if value is unchanged from duplication source
  // Only show for non-empty values and exclude layout/positioning fields
  const isLayoutField = field.key.startsWith('layout.')
  const hasNonEmptyValue = value !== undefined && value !== null && value !== ''
  const rawIsUnchanged = useIsFieldUnchanged(field.key, value)
  const isUnchangedFromSource = rawIsUnchanged && hasNonEmptyValue && !isLayoutField
  
  // For ID fields, use local state to allow free typing without triggering updates
  const [localValue, setLocalValue] = useState(currentValue)
  const isFocusedRef = useRef(false)
  
  // Sync local state when prop value changes (but not while focused)
  useEffect(() => {
    if (isIdField && !isFocusedRef.current) {
      setLocalValue(currentValue)
    }
  }, [currentValue, isIdField])
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    if (isIdField) {
      // For ID fields, only update local state during typing
      setLocalValue(newValue)
    } else {
      // For other fields, update immediately
      onChange(newValue)
    }
  }
  
  const handleFocus = () => {
    console.log('[InputField] FOCUS - field:', field.key, 'isIdField:', isIdField)
    isFocusedRef.current = true
  }
  
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    console.log('[InputField] BLUR - field:', field.key, 'value:', e.target.value, 'isIdField:', isIdField, 'onBlur exists:', !!onBlur)
    isFocusedRef.current = false
    const finalValue = e.target.value
    
    if (isIdField) {
      // For ID fields, only update on blur via onBlur callback
      // This allows the parent to validate and potentially modify the value
      console.log('[InputField] Calling onBlur for ID field with value:', finalValue)
      onBlur?.(finalValue)
    } else {
      // For other fields, just call onBlur if provided
      onBlur?.(finalValue)
    }
  }
  
  const displayValue = isIdField ? localValue : currentValue

  // Build className based on state
  const inputClassName = `w-full px-3 py-2 text-sm border rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 ${
    disabled ? 'bg-gray-100 cursor-not-allowed border-gray-300' : 
    isUnchangedFromSource ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-300'
  }`

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <label className="block text-sm font-medium text-gray-700">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {isUnchangedFromSource && (
          <span className="text-xs text-amber-600 flex items-center gap-1" title="This value is unchanged from the duplicated step">
            <UnchangedIcon className="w-3 h-3" />
            unchanged
          </span>
        )}
      </div>
      {field.description && (
        <p className="text-xs text-gray-500">{field.description}</p>
      )}
      <input
        type="text"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={field.placeholder}
        disabled={disabled}
        className={inputClassName}
      />
    </div>
  )
}

function UnchangedIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2"
      />
    </svg>
  )
}

