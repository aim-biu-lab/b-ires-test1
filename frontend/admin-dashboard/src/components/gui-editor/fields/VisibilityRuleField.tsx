/**
 * Visibility Rule Field Component
 * 
 * Helps build visibility expressions with:
 * - Simple builder mode with variable picker
 * - Raw expression mode for advanced users
 */

import { useState, useMemo } from 'react'
import { GuiFieldDefinition } from '../../../lib/gui-schema'

interface VariableInfo {
  path: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'array'
  source: 'stage' | 'participant' | 'environment' | 'assignment'
}

interface VisibilityRuleFieldProps {
  field: GuiFieldDefinition
  value: string | undefined
  onChange: (value: string) => void
  disabled?: boolean
  context?: {
    availableVariables: VariableInfo[]
  }
}

interface Condition {
  id: string
  variable: string
  operator: string
  value: string
  connector?: 'AND' | 'OR'
}

const OPERATORS = [
  { value: '==', label: 'equals', types: ['string', 'number', 'boolean'] },
  { value: '!=', label: 'not equals', types: ['string', 'number', 'boolean'] },
  { value: '>', label: 'greater than', types: ['number'] },
  { value: '<', label: 'less than', types: ['number'] },
  { value: '>=', label: 'greater or equal', types: ['number'] },
  { value: '<=', label: 'less or equal', types: ['number'] },
  { value: 'contains', label: 'contains', types: ['array', 'string'] },
  { value: 'in', label: 'is one of', types: ['string', 'number'] },
]


// Parse expression into conditions (basic parsing)
function parseExpression(expr: string): Condition[] {
  if (!expr || expr === 'true' || expr === 'false') return []
  
  const conditions: Condition[] = []
  
  // Split by AND/OR (simple parsing)
  const parts = expr.split(/\s+(AND|OR|\&\&|\|\|)\s+/i)
  
  let currentConnector: 'AND' | 'OR' | undefined = undefined
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    
    if (part.toUpperCase() === 'AND' || part === '&&') {
      currentConnector = 'AND'
      continue
    }
    if (part.toUpperCase() === 'OR' || part === '||') {
      currentConnector = 'OR'
      continue
    }
    
    // Try to parse condition
    const match = part.match(/^(.+?)\s*(==|!=|>=|<=|>|<|contains|in)\s*(.+)$/i)
    if (match) {
      conditions.push({
        id: `cond_${i}`,
        variable: match[1].trim().replace(/^["']|["']$/g, ''),
        operator: match[2].toLowerCase(),
        value: match[3].trim().replace(/^["']|["']$/g, ''),
        connector: conditions.length > 0 ? currentConnector : undefined,
      })
      currentConnector = undefined
    }
  }
  
  return conditions
}

// Build expression from conditions
function buildExpression(conditions: Condition[]): string {
  if (conditions.length === 0) return ''
  
  return conditions.map((cond, idx) => {
    const connector = idx > 0 ? ` ${cond.connector || 'AND'} ` : ''
    const needsQuotes = isNaN(Number(cond.value)) && cond.value !== 'true' && cond.value !== 'false'
    const valueStr = needsQuotes ? `"${cond.value}"` : cond.value
    return `${connector}${cond.variable} ${cond.operator} ${valueStr}`
  }).join('')
}

export function VisibilityRuleField({
  field,
  value,
  onChange,
  disabled,
  context,
}: VisibilityRuleFieldProps) {
  const [mode, setMode] = useState<'builder' | 'raw'>('builder')
  const availableVariables = context?.availableVariables || []
  
  // Parse current expression
  const conditions = useMemo(() => parseExpression(value || ''), [value])
  
  // Group variables by source
  const variablesBySource = useMemo(() => {
    const grouped: Record<string, VariableInfo[]> = {
      stage: [],
      participant: [],
      environment: [],
      assignment: [],
    }
    
    availableVariables.forEach(v => {
      if (grouped[v.source]) {
        grouped[v.source].push(v)
      }
    })
    
    return grouped
  }, [availableVariables])

  // Handle condition change
  const handleConditionChange = (id: string, field: keyof Condition, newValue: string) => {
    const updated = conditions.map(c => 
      c.id === id ? { ...c, [field]: newValue } : c
    )
    onChange(buildExpression(updated))
  }

  // Add new condition
  const handleAddCondition = () => {
    const newCondition: Condition = {
      id: `cond_${Date.now()}`,
      variable: availableVariables[0]?.path || '',
      operator: '==',
      value: '',
      connector: conditions.length > 0 ? 'AND' : undefined,
    }
    onChange(buildExpression([...conditions, newCondition]))
  }

  // Remove condition
  const handleRemoveCondition = (id: string) => {
    const updated = conditions.filter(c => c.id !== id)
    // Fix connectors after removal
    if (updated.length > 0) {
      updated[0] = { ...updated[0], connector: undefined }
    }
    onChange(buildExpression(updated))
  }

  // Clear all
  const handleClear = () => {
    onChange('')
  }

  // Get operators for a variable type
  const getOperatorsForVariable = (variablePath: string) => {
    const variable = availableVariables.find(v => v.path === variablePath)
    const varType = variable?.type || 'string'
    return OPERATORS.filter(op => op.types.includes(varType))
  }

  return (
    <div className="space-y-3">
      {/* Header with mode toggle */}
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-sm font-medium text-slate-700">
            {field.label}
          </label>
          {field.description && (
            <p className="text-xs text-slate-500 mt-0.5">{field.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setMode('builder')}
            disabled={disabled}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              mode === 'builder'
                ? 'bg-white text-slate-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Builder
          </button>
          <button
            type="button"
            onClick={() => setMode('raw')}
            disabled={disabled}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              mode === 'raw'
                ? 'bg-white text-slate-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Raw
          </button>
        </div>
      </div>

      {mode === 'raw' ? (
        /* Raw Expression Mode */
        <div className="space-y-2">
          <textarea
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder='e.g., demographics.age >= 18 AND consent.agreed == true'
            rows={3}
            className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100"
          />
          
          {/* Variable Reference */}
          {availableVariables.length > 0 && (
            <div className="text-xs text-slate-500">
              <span className="font-medium">Available variables:</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {availableVariables.slice(0, 10).map(v => (
                  <button
                    key={v.path}
                    type="button"
                    onClick={() => onChange((value || '') + (value ? ' ' : '') + v.path)}
                    disabled={disabled}
                    className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 font-mono"
                  >
                    {v.path}
                  </button>
                ))}
                {availableVariables.length > 10 && (
                  <span className="px-1.5 py-0.5 text-slate-400">
                    +{availableVariables.length - 10} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Builder Mode */
        <div className="space-y-2">
          {conditions.length === 0 ? (
            <div className="p-4 bg-slate-50 border border-slate-200 border-dashed rounded-lg text-center">
              <p className="text-sm text-slate-500">
                No conditions defined
              </p>
              <p className="text-xs text-slate-400 mt-1">
                This item will always be visible
              </p>
              <button
                type="button"
                onClick={handleAddCondition}
                disabled={disabled || availableVariables.length === 0}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <PlusIcon className="w-4 h-4" />
                Add Condition
              </button>
            </div>
          ) : (
            <>
              {/* Conditions List */}
              <div className="space-y-2">
                {conditions.map((cond, idx) => (
                  <div key={cond.id} className="space-y-1">
                    {/* Connector */}
                    {idx > 0 && (
                      <div className="flex items-center gap-2 pl-2">
                        <select
                          value={cond.connector || 'AND'}
                          onChange={(e) => handleConditionChange(cond.id, 'connector', e.target.value as 'AND' | 'OR')}
                          disabled={disabled}
                          className="text-xs font-medium px-2 py-1 bg-slate-100 border border-slate-200 rounded"
                        >
                          <option value="AND">AND</option>
                          <option value="OR">OR</option>
                        </select>
                        <div className="flex-1 h-px bg-slate-200" />
                      </div>
                    )}
                    
                    {/* Condition Row */}
                    <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                      {/* Variable Select */}
                      <select
                        value={cond.variable}
                        onChange={(e) => handleConditionChange(cond.id, 'variable', e.target.value)}
                        disabled={disabled}
                        className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100"
                      >
                        <option value="">Select variable...</option>
                        {Object.entries(variablesBySource).map(([source, vars]) => 
                          vars.length > 0 && (
                            <optgroup key={source} label={source.charAt(0).toUpperCase() + source.slice(1)}>
                              {vars.map(v => (
                                <option key={v.path} value={v.path}>
                                  {v.label}
                                </option>
                              ))}
                            </optgroup>
                          )
                        )}
                      </select>

                      {/* Operator Select */}
                      <select
                        value={cond.operator}
                        onChange={(e) => handleConditionChange(cond.id, 'operator', e.target.value)}
                        disabled={disabled}
                        className="w-32 px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100"
                      >
                        {getOperatorsForVariable(cond.variable).map(op => (
                          <option key={op.value} value={op.value}>
                            {op.label}
                          </option>
                        ))}
                      </select>

                      {/* Value Input */}
                      <input
                        type="text"
                        value={cond.value}
                        onChange={(e) => handleConditionChange(cond.id, 'value', e.target.value)}
                        disabled={disabled}
                        placeholder="value"
                        className="w-32 px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100"
                      />

                      {/* Remove Button */}
                      <button
                        type="button"
                        onClick={() => handleRemoveCondition(cond.id)}
                        disabled={disabled}
                        className="p-1.5 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
                        title="Remove condition"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleAddCondition}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded transition-colors disabled:opacity-50"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  Add Condition
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={disabled}
                  className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-red-600 transition-colors disabled:opacity-50"
                >
                  Clear All
                </button>
              </div>
            </>
          )}

          {/* Preview */}
          {value && (
            <div className="mt-2 p-2 bg-slate-100 rounded-lg">
              <span className="text-xs font-medium text-slate-500">Expression:</span>
              <code className="block mt-1 text-xs font-mono text-slate-700 break-all">
                {value}
              </code>
            </div>
          )}
        </div>
      )}

      {/* Quick Presets */}
      {mode === 'builder' && availableVariables.length === 0 && (
        <div className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-md">
          <strong>Note:</strong> No variables available yet. Variables become available 
          after you add stages that collect data (questionnaires, user_info, etc.)
        </div>
      )}
    </div>
  )
}

// Icons
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

export default VisibilityRuleField

