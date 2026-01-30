/**
 * Number Field Component
 * Numeric input with optional min/max/step
 */

import { GuiFieldDefinition } from '../../../lib/gui-schema'

interface NumberFieldProps {
  field: GuiFieldDefinition
  value: number | undefined
  onChange: (value: number | undefined) => void
  disabled?: boolean
}

export function NumberField({ field, value, onChange, disabled }: NumberFieldProps) {
  const currentValue = value ?? (field.default as number)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (val === '') {
      onChange(undefined)
    } else {
      const num = parseFloat(val)
      if (!isNaN(num)) {
        onChange(num)
      }
    }
  }

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {field.description && (
        <p className="text-xs text-gray-500">{field.description}</p>
      )}
      <input
        type="number"
        value={currentValue ?? ''}
        onChange={handleChange}
        placeholder={field.placeholder}
        min={field.min}
        max={field.max}
        step={field.step ?? 1}
        disabled={disabled}
        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 ${
          disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
        }`}
      />
      {(field.min !== undefined || field.max !== undefined) && (
        <p className="text-xs text-gray-400">
          {field.min !== undefined && `Min: ${field.min}`}
          {field.min !== undefined && field.max !== undefined && ' • '}
          {field.max !== undefined && `Max: ${field.max}`}
        </p>
      )}
    </div>
  )
}

