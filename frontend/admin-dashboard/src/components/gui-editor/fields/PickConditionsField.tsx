/**
 * Pick Conditions Field Component
 * 
 * Allows defining conditions for filtering candidates during pick operations.
 * Users can select from existing variables and choose operators.
 */

import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { GuiFieldDefinition } from '../../../lib/gui-schema'

interface PickCondition {
  variable: string
  operator: string
}

interface PickConditionsFieldProps {
  field: GuiFieldDefinition
  value: PickCondition[] | undefined
  onChange: (value: PickCondition[] | undefined) => void
  disabled?: boolean
  context?: {
    // Variables that have been defined via pick_assigns in the experiment
    pickAssignsVariables?: Array<{
      name: string
      possibleValues: string[]
    }>
  }
}

const OPERATORS = [
  { value: 'not_in', label: 'Not In (≠) - Value must NOT be in accumulated' },
  { value: 'in', label: 'In (=) - Value must BE in accumulated' },
]

export function PickConditionsField({ 
  field, 
  value, 
  onChange, 
  disabled,
  context 
}: PickConditionsFieldProps) {
  const conditions = value || []
  const availableVars = context?.pickAssignsVariables || []

  const handleAdd = () => {
    const newCondition: PickCondition = {
      variable: availableVars[0]?.name || '',
      operator: 'not_in',
    }
    onChange([...conditions, newCondition])
  }

  const handleRemove = (index: number) => {
    const updated = conditions.filter((_, i) => i !== index)
    onChange(updated.length > 0 ? updated : undefined)
  }

  const handleChange = (index: number, field: keyof PickCondition, newValue: string) => {
    const updated = conditions.map((c, i) => 
      i === index ? { ...c, [field]: newValue } : c
    )
    onChange(updated)
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        {field.label}
      </label>
      {field.description && (
        <p className="text-xs text-gray-500">{field.description}</p>
      )}

      {/* Info about how conditions work */}
      <div className="p-2 bg-blue-50 rounded-md text-xs text-blue-700">
        <p>
          Conditions filter which children can be picked based on variables 
          assigned by previously picked items. Use "Not In" to exclude items 
          that would repeat a previous value.
        </p>
      </div>

      {/* Existing conditions */}
      {conditions.length > 0 && (
        <div className="space-y-2">
          {conditions.map((condition, index) => (
            <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Variable</label>
                {availableVars.length > 0 ? (
                  <select
                    value={condition.variable}
                    onChange={(e) => handleChange(index, 'variable', e.target.value)}
                    disabled={disabled}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                  >
                    <option value="">Select variable...</option>
                    {availableVars.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} ({v.possibleValues.length} values)
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={condition.variable}
                    onChange={(e) => handleChange(index, 'variable', e.target.value)}
                    disabled={disabled}
                    placeholder="Variable name"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                  />
                )}
              </div>
              
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Operator</label>
                <select
                  value={condition.operator}
                  onChange={(e) => handleChange(index, 'operator', e.target.value)}
                  disabled={disabled}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => handleRemove(index)}
                disabled={disabled}
                className="p-1.5 text-gray-400 hover:text-red-500 disabled:opacity-50 mt-5"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Show available variables info */}
      {availableVars.length > 0 && (
        <div className="text-xs text-gray-500">
          <span className="font-medium">Available variables: </span>
          {availableVars.map((v, i) => (
            <span key={v.name}>
              <code className="px-1 py-0.5 bg-gray-100 rounded">{v.name}</code>
              {' '}({v.possibleValues.join(', ')})
              {i < availableVars.length - 1 && ', '}
            </span>
          ))}
        </div>
      )}

      {/* Add button */}
      {!disabled && (
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-md"
        >
          <PlusIcon className="w-4 h-4" />
          Add Condition
        </button>
      )}

      {conditions.length === 0 && disabled && (
        <p className="text-sm text-gray-400 italic">No conditions defined</p>
      )}
    </div>
  )
}

export default PickConditionsField

