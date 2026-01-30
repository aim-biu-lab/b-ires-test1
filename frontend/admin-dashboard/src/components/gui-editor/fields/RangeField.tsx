/**
 * Range Field Component
 * Two-value range input (min, max)
 */

import { GuiFieldDefinition } from '../../../lib/gui-schema'

interface RangeFieldProps {
  field: GuiFieldDefinition
  value: [number, number] | undefined
  onChange: (value: [number, number]) => void
  disabled?: boolean
}

export function RangeField({ field, value, onChange, disabled }: RangeFieldProps) {
  const defaultRange = (field.default as [number, number]) ?? [1, 5]
  const currentValue = value ?? defaultRange

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const min = parseInt(e.target.value, 10)
    if (!isNaN(min)) {
      onChange([min, currentValue[1]])
    }
  }

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const max = parseInt(e.target.value, 10)
    if (!isNaN(max)) {
      onChange([currentValue[0], max])
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
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Min</label>
          <input
            type="number"
            value={currentValue[0]}
            onChange={handleMinChange}
            disabled={disabled}
            className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 ${
              disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
            }`}
          />
        </div>
        <span className="text-gray-400 mt-5">to</span>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Max</label>
          <input
            type="number"
            value={currentValue[1]}
            onChange={handleMaxChange}
            disabled={disabled}
            className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 ${
              disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
            }`}
          />
        </div>
      </div>
      <p className="text-xs text-gray-400">
        Range: {currentValue[0]} - {currentValue[1]} ({currentValue[1] - currentValue[0] + 1} values)
      </p>
    </div>
  )
}

