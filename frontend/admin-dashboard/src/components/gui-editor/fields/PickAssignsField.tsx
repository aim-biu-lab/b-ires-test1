/**
 * Pick Assigns Field Component
 * 
 * Allows defining key-value pairs for variables that are assigned
 * when this item is picked (used with pick_conditions).
 */

import { useState } from 'react'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { GuiFieldDefinition } from '../../../lib/gui-schema'

interface PickAssignsFieldProps {
  field: GuiFieldDefinition
  value: Record<string, string> | undefined
  onChange: (value: Record<string, string> | undefined) => void
  disabled?: boolean
  context?: {
    existingVariables?: string[]  // Variables defined elsewhere in the experiment
  }
}

export function PickAssignsField({ 
  field, 
  value, 
  onChange, 
  disabled,
  context 
}: PickAssignsFieldProps) {
  const [newVarName, setNewVarName] = useState('')
  const [newVarValue, setNewVarValue] = useState('')

  const entries = Object.entries(value || {})
  const existingVars = context?.existingVariables || []

  const handleAdd = () => {
    if (!newVarName.trim()) return
    
    const updated = { ...(value || {}), [newVarName.trim()]: newVarValue }
    onChange(updated)
    setNewVarName('')
    setNewVarValue('')
  }

  const handleRemove = (key: string) => {
    if (!value) return
    const updated = { ...value }
    delete updated[key]
    onChange(Object.keys(updated).length > 0 ? updated : undefined)
  }

  const handleValueChange = (key: string, newValue: string) => {
    if (!value) return
    onChange({ ...value, [key]: newValue })
  }

  const handleKeyChange = (oldKey: string, newKey: string) => {
    if (!value || !newKey.trim()) return
    const updated: Record<string, string> = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === oldKey) {
        updated[newKey.trim()] = v
      } else {
        updated[k] = v
      }
    }
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

      {/* Existing entries */}
      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <input
                type="text"
                value={key}
                onChange={(e) => handleKeyChange(key, e.target.value)}
                disabled={disabled}
                placeholder="Variable name"
                className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
              />
              <span className="text-gray-400">=</span>
              <input
                type="text"
                value={val}
                onChange={(e) => handleValueChange(key, e.target.value)}
                disabled={disabled}
                placeholder="Value"
                className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
              />
              <button
                type="button"
                onClick={() => handleRemove(key)}
                disabled={disabled}
                className="p-1.5 text-gray-400 hover:text-red-500 disabled:opacity-50"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new entry */}
      {!disabled && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          {existingVars.length > 0 ? (
            <select
              value={newVarName}
              onChange={(e) => setNewVarName(e.target.value)}
              className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">Select or type variable...</option>
              {existingVars.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={newVarName}
              onChange={(e) => setNewVarName(e.target.value)}
              placeholder="Variable name (e.g., person_name)"
              className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
            />
          )}
          <span className="text-gray-400">=</span>
          <input
            type="text"
            value={newVarValue}
            onChange={(e) => setNewVarValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Value (e.g., Alice)"
            className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newVarName.trim()}
            className="flex items-center gap-1 px-2 py-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlusIcon className="w-4 h-4" />
            Add
          </button>
        </div>
      )}

      {entries.length === 0 && disabled && (
        <p className="text-sm text-gray-400 italic">No variables assigned</p>
      )}
    </div>
  )
}

export default PickAssignsField

