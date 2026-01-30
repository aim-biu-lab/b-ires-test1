/**
 * Textarea Field Component
 * Multi-line text input
 */

import { GuiFieldDefinition } from '../../../lib/gui-schema'
import { useIsFieldUnchanged } from '../../../lib/duplication-context'

interface TextareaFieldProps {
  field: GuiFieldDefinition
  value: string | undefined
  onChange: (value: string) => void
  disabled?: boolean
}

export function TextareaField({ field, value, onChange, disabled }: TextareaFieldProps) {
  const currentValue = value ?? (field.default as string) ?? ''
  const rows = field.rows ?? 4
  
  // Check if value is unchanged from duplication source
  // Only show for non-empty values and exclude layout/positioning fields
  const isLayoutField = field.key.startsWith('layout.')
  const hasNonEmptyValue = value !== undefined && value !== null && value !== ''
  const rawIsUnchanged = useIsFieldUnchanged(field.key, value)
  const isUnchangedFromSource = rawIsUnchanged && hasNonEmptyValue && !isLayoutField

  // Build className based on state
  const textareaClassName = `w-full px-3 py-2 text-sm border rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 resize-y ${
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
      <textarea
        value={currentValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        rows={rows}
        disabled={disabled}
        className={textareaClassName}
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

