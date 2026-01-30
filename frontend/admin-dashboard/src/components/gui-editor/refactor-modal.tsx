/**
 * Refactor Modal
 * Allows users to define replacement rules for IDs and text content
 * after duplicating a stage/block/phase
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { RefactorRules, countReplacements, extractIdPrefixes, extractTextPatterns, hasCopySuffixes } from '../../lib/refactor-utils'

// Icons
const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
)

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
)

const ArrowRightIcon = () => (
  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
  </svg>
)

const RefactorIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
)

interface TextRule {
  id: string
  from: string
  to: string
}

interface RefactorModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback to close the modal */
  onClose: () => void
  /** Callback when refactor is applied */
  onApply: (rules: RefactorRules) => void
  /** The duplicated item data (for extracting suggestions) */
  itemData: Record<string, unknown>
  /** Label for the item being refactored (e.g., "stage", "block") */
  itemType: string
  /** ID of the item being refactored */
  itemId: string
}

export function RefactorModal({
  isOpen,
  onClose,
  onApply,
  itemData,
  itemType,
  itemId,
}: RefactorModalProps) {
  // ID prefix state
  const [idPrefixFrom, setIdPrefixFrom] = useState('')
  const [idPrefixTo, setIdPrefixTo] = useState('')
  
  // Text rules state
  const [textRules, setTextRules] = useState<TextRule[]>([
    { id: '1', from: '', to: '' }
  ])
  
  // Remove copy suffixes toggle
  const [removeCopySuffixes, setRemoveCopySuffixes] = useState(false)
  
  // Check if item has copy suffixes
  const itemHasCopySuffixes = useMemo(() => hasCopySuffixes(itemData), [itemData])
  
  // Auto-enable remove copy suffixes if the item has them
  useEffect(() => {
    if (itemHasCopySuffixes) {
      setRemoveCopySuffixes(true)
    }
  }, [itemHasCopySuffixes])

  // Extract suggestions from item data
  const suggestedIdPrefixes = useMemo(() => extractIdPrefixes(itemData), [itemData])
  const suggestedTextPatterns = useMemo(() => extractTextPatterns(itemData), [itemData])

  // Build rules object for preview
  const rules: RefactorRules = useMemo(() => ({
    idPrefix: idPrefixFrom && idPrefixTo ? { from: idPrefixFrom, to: idPrefixTo } : undefined,
    textRules: textRules.filter(r => r.from && r.to).map(r => ({ from: r.from, to: r.to })),
    removeCopySuffixes,
  }), [idPrefixFrom, idPrefixTo, textRules, removeCopySuffixes])

  // Count replacements for preview
  const replacementCounts = useMemo(() => countReplacements(itemData, rules), [itemData, rules])
  const totalReplacements = replacementCounts.idReplacements + replacementCounts.textReplacements + replacementCounts.copySuffixRemovals

  // Add text rule
  const handleAddTextRule = useCallback(() => {
    setTextRules(prev => [...prev, { id: String(Date.now()), from: '', to: '' }])
  }, [])

  // Remove text rule
  const handleRemoveTextRule = useCallback((id: string) => {
    setTextRules(prev => prev.filter(r => r.id !== id))
  }, [])

  // Update text rule
  const handleUpdateTextRule = useCallback((id: string, field: 'from' | 'to', value: string) => {
    setTextRules(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }, [])

  // Apply refactor
  const handleApply = useCallback(() => {
    if (totalReplacements > 0) {
      onApply(rules)
    }
    onClose()
  }, [rules, totalReplacements, onApply, onClose])

  // Use suggestion for ID prefix
  const handleUseSuggestedPrefix = useCallback((prefix: string) => {
    setIdPrefixFrom(prefix)
  }, [])

  // Use suggestion for text rule
  const handleUseSuggestedText = useCallback((text: string) => {
    // Find first empty rule or add new one
    const emptyRule = textRules.find(r => !r.from)
    if (emptyRule) {
      handleUpdateTextRule(emptyRule.id, 'from', text)
    } else {
      setTextRules(prev => [...prev, { id: String(Date.now()), from: text, to: '' }])
    }
  }, [textRules, handleUpdateTextRule])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <RefactorIcon />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Refactor Duplicated {itemType.charAt(0).toUpperCase() + itemType.slice(1)}
            </h2>
            <p className="text-sm text-gray-500">
              Replace IDs and text in <code className="bg-gray-100 px-1 rounded">{itemId}</code>
            </p>
          </div>
        </div>

        {/* ID Prefix Section */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            ID Prefix Replacement
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Replace ID prefixes across all nested IDs (e.g., "ben_lesser_" → "helen_fogel_")
          </p>
          
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={idPrefixFrom}
              onChange={(e) => setIdPrefixFrom(e.target.value)}
              placeholder="From prefix..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <ArrowRightIcon />
            <input
              type="text"
              value={idPrefixTo}
              onChange={(e) => setIdPrefixTo(e.target.value)}
              placeholder="To prefix..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* ID Prefix Suggestions */}
          {suggestedIdPrefixes.length > 0 && (
            <div className="mt-2">
              <span className="text-xs text-gray-500">Suggestions: </span>
              <div className="flex flex-wrap gap-1 mt-1">
                {suggestedIdPrefixes.slice(0, 5).map((prefix) => (
                  <button
                    key={prefix}
                    onClick={() => handleUseSuggestedPrefix(prefix)}
                    className="px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                  >
                    {prefix}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Text Replacement Section */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Text Replacements
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Replace text content in labels, titles, descriptions, etc.
          </p>

          <div className="space-y-2">
            {textRules.map((rule, index) => (
              <div key={rule.id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={rule.from}
                  onChange={(e) => handleUpdateTextRule(rule.id, 'from', e.target.value)}
                  placeholder="Find text..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <ArrowRightIcon />
                <input
                  type="text"
                  value={rule.to}
                  onChange={(e) => handleUpdateTextRule(rule.id, 'to', e.target.value)}
                  placeholder="Replace with..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                {textRules.length > 1 && (
                  <button
                    onClick={() => handleRemoveTextRule(rule.id)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove rule"
                  >
                    <TrashIcon />
                  </button>
                )}
                {textRules.length === 1 && index === 0 && (
                  <div className="w-10" /> // Spacer for alignment
                )}
              </div>
            ))}
          </div>

          <button
            onClick={handleAddTextRule}
            className="mt-2 flex items-center gap-1 px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <PlusIcon />
            Add rule
          </button>

          {/* Text Suggestions */}
          {suggestedTextPatterns.length > 0 && (
            <div className="mt-3">
              <span className="text-xs text-gray-500">Common patterns found: </span>
              <div className="flex flex-wrap gap-1 mt-1">
                {suggestedTextPatterns.slice(0, 8).map((text) => (
                  <button
                    key={text}
                    onClick={() => handleUseSuggestedText(text)}
                    className="px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Remove Copy Suffixes Section */}
        {itemHasCopySuffixes && (
          <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={removeCopySuffixes}
                onChange={(e) => setRemoveCopySuffixes(e.target.checked)}
                className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
              />
              <div>
                <span className="text-sm font-medium text-amber-800">
                  Remove copy suffixes
                </span>
                <p className="text-xs text-amber-600 mt-0.5">
                  Removes "_copy", "_copy_1" from IDs and "(Copy)", "(Copy 1)" from labels
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Preview */}
        {totalReplacements > 0 && (
          <div className="mb-6 p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
            <p className="text-sm text-indigo-800">
              <strong>{totalReplacements}</strong> change{totalReplacements !== 1 ? 's' : ''} will be made
            </p>
            <div className="mt-1 text-xs text-indigo-600 space-y-0.5">
              {replacementCounts.idReplacements > 0 && (
                <div>{replacementCounts.idReplacements} ID prefix replacement{replacementCounts.idReplacements !== 1 ? 's' : ''}</div>
              )}
              {replacementCounts.textReplacements > 0 && (
                <div>{replacementCounts.textReplacements} text replacement{replacementCounts.textReplacements !== 1 ? 's' : ''}</div>
              )}
              {replacementCounts.copySuffixRemovals > 0 && (
                <div>{replacementCounts.copySuffixRemovals} copy suffix removal{replacementCounts.copySuffixRemovals !== 1 ? 's' : ''}</div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={totalReplacements === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Apply Refactor
          </button>
        </div>
      </div>
    </div>
  )
}
