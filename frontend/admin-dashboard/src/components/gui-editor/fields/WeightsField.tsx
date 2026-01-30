/**
 * Weights Field Component
 * 
 * Context-aware weight editor for weighted distribution.
 * Displays all children of the current hierarchy item with:
 * - Weight input for each child
 * - Calculated percentage preview
 * - Visual distribution bar
 */

import { useMemo } from 'react'
import { GuiFieldDefinition } from '../../../lib/gui-schema'

interface WeightItem {
  id: string
  value: number
}

interface ChildInfo {
  id: string
  label?: string
  title?: string
}

interface WeightsFieldProps {
  field: GuiFieldDefinition
  value: WeightItem[] | undefined
  onChange: (value: WeightItem[]) => void
  disabled?: boolean
  context?: {
    children: ChildInfo[]
    orderingMode?: string
  }
}

// Predefined colors for the distribution bars
const COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-orange-500',
]

export function WeightsField({
  field,
  value,
  onChange,
  disabled,
  context,
}: WeightsFieldProps) {
  const children = context?.children || []
  
  // Ensure all children have weight entries
  const weights = useMemo(() => {
    const existingWeights = value || []
    const weightMap = new Map(existingWeights.map(w => [w.id, w.value]))
    
    return children.map(child => ({
      id: child.id,
      label: child.label || child.title || child.id,
      value: weightMap.get(child.id) ?? 1,
    }))
  }, [value, children])

  // Calculate total and percentages
  const totalWeight = useMemo(() => {
    return weights.reduce((sum, w) => sum + w.value, 0)
  }, [weights])

  const percentages = useMemo(() => {
    if (totalWeight === 0) return weights.map(() => 0)
    return weights.map(w => (w.value / totalWeight) * 100)
  }, [weights, totalWeight])

  // Handle weight change for a specific child
  const handleWeightChange = (childId: string, newValue: number) => {
    const newWeights = weights.map(w => ({
      id: w.id,
      value: w.id === childId ? Math.max(0, newValue) : w.value,
    }))
    onChange(newWeights)
  }

  // Handle distribute equally
  const handleDistributeEqually = () => {
    const equalValue = 1
    const newWeights = weights.map(w => ({
      id: w.id,
      value: equalValue,
    }))
    onChange(newWeights)
  }

  if (children.length === 0) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">
          {field.label}
        </label>
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center">
          <p className="text-sm text-slate-500">
            Add children to configure weights
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Weights are used to control probability distribution
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-sm font-medium text-slate-700">
            {field.label}
          </label>
          {field.description && (
            <p className="text-xs text-slate-500 mt-0.5">{field.description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleDistributeEqually}
          disabled={disabled}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
        >
          Distribute Equally
        </button>
      </div>

      {/* Distribution Bar Preview */}
      <div className="h-6 flex rounded-lg overflow-hidden bg-slate-100">
        {weights.map((w, idx) => (
          <div
            key={w.id}
            className={`${COLORS[idx % COLORS.length]} transition-all duration-200`}
            style={{ width: `${percentages[idx]}%` }}
            title={`${w.label}: ${percentages[idx].toFixed(1)}%`}
          />
        ))}
      </div>

      {/* Weight Inputs */}
      <div className="space-y-2">
        {weights.map((w, idx) => (
          <div
            key={w.id}
            className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg border border-slate-200"
          >
            {/* Color indicator */}
            <div className={`w-3 h-3 rounded-full ${COLORS[idx % COLORS.length]}`} />
            
            {/* Label */}
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-slate-700 truncate block">
                {w.label}
              </span>
              <span className="text-xs text-slate-400">{w.id}</span>
            </div>

            {/* Weight Input */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="1"
                value={w.value}
                onChange={(e) => handleWeightChange(w.id, parseInt(e.target.value) || 0)}
                disabled={disabled}
                className="w-20 px-2 py-1 text-sm text-center border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100"
              />
              
              {/* Percentage */}
              <span className="w-16 text-right text-sm font-medium text-slate-600">
                {percentages[idx].toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs text-slate-500">
        <span>Total Weight: <strong className="text-slate-700">{totalWeight}</strong></span>
        <span>{children.length} variants</span>
      </div>

      {/* Legend for small percentages */}
      {weights.some((_, idx) => percentages[idx] < 5 && percentages[idx] > 0) && (
        <div className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-md">
          <strong>Note:</strong> Some variants have very low probability (&lt;5%). 
          Consider adjusting weights for more balanced distribution.
        </div>
      )}
    </div>
  )
}

export default WeightsField


