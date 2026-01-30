/**
 * Toggle Field Component
 * Boolean toggle switch for yes/no values
 */

import { GuiFieldDefinition } from '../../../lib/gui-schema'

interface ToggleFieldProps {
  field: GuiFieldDefinition
  value: boolean | undefined
  onChange: (value: boolean) => void
  disabled?: boolean
}

export function ToggleField({ field, value, onChange, disabled }: ToggleFieldProps) {
  const isChecked = value ?? (field.default as boolean) ?? false

  return (
    <div className="flex items-center justify-between">
      <div className="flex-1 min-w-0 pr-4">
        <label className="block text-sm font-medium text-gray-700">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {field.description && (
          <p className="text-xs text-gray-500 mt-0.5">{field.description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isChecked}
        onClick={() => onChange(!isChecked)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
          isChecked ? 'bg-primary-600' : 'bg-gray-300'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
            isChecked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

