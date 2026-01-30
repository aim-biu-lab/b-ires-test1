/**
 * Latin Square Field Component
 * 
 * Displays auto-generated ordering permutations for Latin Square design.
 * Shows all possible sequences and their distribution percentages.
 */

import { useMemo } from 'react'
import { GuiFieldDefinition } from '../../../lib/gui-schema'

interface ChildInfo {
  id: string
  label?: string
  title?: string
}

interface LatinSquareFieldProps {
  field: GuiFieldDefinition
  disabled?: boolean
  context?: {
    children: ChildInfo[]
    orderingMode?: string
  }
}

// Generate Latin Square permutations
function generateLatinSquare(n: number): number[][] {
  if (n <= 0) return []
  if (n === 1) return [[0]]
  
  const result: number[][] = []
  
  // Generate standard Latin Square by rotating
  for (let i = 0; i < n; i++) {
    const row: number[] = []
    for (let j = 0; j < n; j++) {
      row.push((i + j) % n)
    }
    result.push(row)
  }
  
  return result
}

// Colors for sequence visualization
const COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' },
  { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-300' },
  { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-300' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-300' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300' },
  { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-300' },
]

export function LatinSquareField({
  field,
  disabled: _disabled,
  context,
}: LatinSquareFieldProps) {
  const children = context?.children || []
  
  // Generate Latin Square sequences
  const sequences = useMemo(() => {
    if (children.length === 0) return []
    
    const latinSquare = generateLatinSquare(children.length)
    
    return latinSquare.map((row, idx) => ({
      id: `sequence_${idx + 1}`,
      order: row.map(i => children[i]),
      percentage: (100 / children.length).toFixed(1),
    }))
  }, [children])

  if (children.length === 0) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">
          {field.label}
        </label>
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center">
          <p className="text-sm text-slate-500">
            Add children to see Latin Square sequences
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Latin Square balances the order in which participants see items
          </p>
        </div>
      </div>
    )
  }

  if (children.length > 8) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">
          {field.label}
        </label>
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-700">
            <strong>Large Latin Square</strong>
          </p>
          <p className="text-xs text-amber-600 mt-1">
            With {children.length} children, there are {children.length} different sequences.
            Each participant will be assigned one of these orderings with equal probability ({(100 / children.length).toFixed(1)}% each).
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {children.map((child, idx) => (
              <span
                key={child.id}
                className={`inline-flex items-center px-2 py-0.5 text-xs rounded ${COLORS[idx % COLORS.length].bg} ${COLORS[idx % COLORS.length].text}`}
              >
                {child.label || child.id}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <label className="block text-sm font-medium text-slate-700">
          {field.label}
        </label>
        <p className="text-xs text-slate-500 mt-0.5">
          Participants will be evenly distributed across these orderings
        </p>
      </div>

      {/* Children Legend */}
      <div className="flex flex-wrap gap-1.5 pb-2 border-b border-slate-200">
        {children.map((child, idx) => (
          <span
            key={child.id}
            className={`inline-flex items-center px-2 py-0.5 text-xs rounded border ${COLORS[idx % COLORS.length].bg} ${COLORS[idx % COLORS.length].text} ${COLORS[idx % COLORS.length].border}`}
          >
            <span className="font-bold mr-1">{String.fromCharCode(65 + idx)}:</span>
            {child.label || child.id}
          </span>
        ))}
      </div>

      {/* Sequences */}
      <div className="space-y-2">
        {sequences.map((seq, seqIdx) => (
          <div
            key={seq.id}
            className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200"
          >
            {/* Sequence Number */}
            <div className="w-8 h-8 flex items-center justify-center bg-slate-200 rounded-full text-xs font-bold text-slate-600">
              {seqIdx + 1}
            </div>

            {/* Sequence Order */}
            <div className="flex-1 flex items-center gap-1 overflow-x-auto">
              {seq.order.map((child, idx) => {
                const childIndex = children.findIndex(c => c.id === child.id)
                const color = COLORS[childIndex % COLORS.length]
                const letter = String.fromCharCode(65 + childIndex)
                
                return (
                  <div key={`${seq.id}-${idx}`} className="flex items-center">
                    <span
                      className={`inline-flex items-center justify-center w-7 h-7 text-xs font-bold rounded ${color.bg} ${color.text}`}
                      title={child.label || child.id}
                    >
                      {letter}
                    </span>
                    {idx < seq.order.length - 1 && (
                      <ArrowIcon className="w-4 h-4 text-slate-400 mx-0.5" />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Percentage */}
            <span className="text-sm font-medium text-slate-600 w-14 text-right">
              {seq.percentage}%
            </span>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs text-slate-500">
        <span>
          <strong className="text-slate-700">{sequences.length}</strong> unique orderings
        </span>
        <span>
          Each with <strong className="text-slate-700">{(100 / sequences.length).toFixed(1)}%</strong> of participants
        </span>
      </div>

      {/* Info Note */}
      <div className="text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-md flex items-start gap-2">
        <InfoIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <strong>Latin Square Design:</strong> Each item appears in each position 
          exactly once across all sequences, controlling for order effects.
        </div>
      </div>
    </div>
  )
}

// Arrow Icon
function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

// Info Icon
function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

export default LatinSquareField

