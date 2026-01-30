/**
 * Select Field Component
 * Dropdown select for enum values
 */

import { GuiFieldDefinition } from '../../../lib/gui-schema'

interface SelectFieldProps {
  field: GuiFieldDefinition
  value: string | undefined
  onChange: (value: string) => void
  disabled?: boolean
}

export function SelectField({ field, value, onChange, disabled }: SelectFieldProps) {
  const currentValue = value ?? (field.default as string) ?? ''
  const options = field.options || []

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {field.description && (
        <p className="text-xs text-gray-500">{field.description}</p>
      )}
      <select
        value={currentValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 ${
          disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
        }`}
      >
        {!field.required && !currentValue && (
          <option value="">Select...</option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

