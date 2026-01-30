/**
 * Hierarchy Tree Editor Component
 * 
 * Provides a tree-folder interface for editing the 4-level experiment hierarchy:
 * Phase > Stage > Block > Task
 * 
 * Features:
 * - Collapsible folder structure
 * - Visual icons for ordering modes
 * - Drag-and-drop reordering
 * - Context menu for rules editor, distribution view, etc.
 */

import React, { useState, useCallback } from 'react'
import {
  ChevronRightIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  DocumentTextIcon,
  ArrowsUpDownIcon,
  ScaleIcon,
  ChartPieIcon,
  Squares2X2Icon,
  EllipsisVerticalIcon,
  PlusIcon,
  TrashIcon,
  DocumentDuplicateIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  EyeIcon,
} from '@heroicons/react/24/outline'
import { generateSmartId, generateSmartLabel } from '../../lib/duplication-utils'

// Ordering mode icons and labels
const ORDERING_MODE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>, label: string, color: string, bgColor: string }> = {
  sequential: { icon: ArrowDownIcon, label: 'Sequential', color: 'text-slate-600', bgColor: 'bg-slate-100' },
  randomized: { icon: ArrowsUpDownIcon, label: 'Randomized', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  balanced: { icon: ScaleIcon, label: 'Balanced', color: 'text-emerald-600', bgColor: 'bg-emerald-100' },
  weighted: { icon: ChartPieIcon, label: 'Weighted', color: 'text-violet-600', bgColor: 'bg-violet-100' },
  latin_square: { icon: Squares2X2Icon, label: 'Latin Square', color: 'text-amber-600', bgColor: 'bg-amber-100' },
}

// Types
interface HierarchyItem {
  id: string
  type: 'phase' | 'stage' | 'block' | 'task'
  label?: string
  title?: string
  stageType?: string  // For stages/blocks/tasks
  rules?: {
    ordering?: string
    visibility?: string
    balance_on?: string
    weights?: { id: string; value: number }[]
    quota?: number
  }
  ui_settings?: {
    visible_to_participant?: boolean
    show_in_sidebar?: boolean
    label?: string
    collapsed_by_default?: boolean
  }
  children?: HierarchyItem[]
}

interface HierarchyTreeEditorProps {
  phases: HierarchyItem[]
  onPhasesChange: (phases: HierarchyItem[]) => void
  onItemSelect: (item: HierarchyItem, path: string[]) => void
  selectedItemId?: string
  expandedIds?: Set<string>
  onToggleExpand?: (id: string) => void
  onSettingsSelect?: () => void
  isSettingsSelected?: boolean
  /** Callback when an item is duplicated, provides the new item ID, original data, and duplicated data */
  onItemDuplicated?: (newItemId: string, originalItemData: Record<string, unknown>, duplicatedItemData: Record<string, unknown>) => void
}

// Individual tree node component
interface TreeNodeProps {
  item: HierarchyItem
  depth: number
  path: string[]
  isExpanded: boolean
  isSelected: boolean
  onToggle: () => void
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent, item: HierarchyItem) => void
  onAddChild?: (type: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}

const TreeNode: React.FC<TreeNodeProps> = ({
  item,
  depth,
  path: _path,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onContextMenu,
  onAddChild,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}) => {
  const [showMenu, setShowMenu] = useState(false)
  
  const isContainer = item.type !== 'task'
  
  // Get ordering mode config
  const orderingMode = item.rules?.ordering || 'sequential'
  const orderingConfig = ORDERING_MODE_CONFIG[orderingMode] || ORDERING_MODE_CONFIG.sequential
  const OrderingIcon = orderingConfig.icon
  
  // Get display label
  const displayLabel = item.ui_settings?.label || item.label || item.title || item.id
  
  // Type-specific styling - improved colors for better visibility
  const getTypeStyles = () => {
    switch (item.type) {
      case 'phase':
        return 'font-semibold text-indigo-800'
      case 'stage':
        return 'font-medium text-slate-800'
      case 'block':
        return 'font-medium text-slate-700'
      case 'task':
        return 'text-slate-600'
      default:
        return 'text-slate-700'
    }
  }
  
  // Get type icon with improved colors based on type
  const TypeIcon = () => {
    if (item.type === 'phase') {
      return isExpanded ? (
        <FolderOpenIcon className="w-5 h-5 text-indigo-500" />
      ) : (
        <FolderIcon className="w-5 h-5 text-indigo-500" />
      )
    }
    if (item.type === 'stage') {
      return isExpanded ? (
        <FolderOpenIcon className="w-4 h-4 text-amber-500" />
      ) : (
        <FolderIcon className="w-4 h-4 text-amber-500" />
      )
    }
    if (item.type === 'block') {
      return isExpanded ? (
        <FolderOpenIcon className="w-4 h-4 text-teal-500" />
      ) : (
        <FolderIcon className="w-4 h-4 text-teal-500" />
      )
    }
    return <DocumentTextIcon className="w-4 h-4 text-sky-500" />
  }
  
  // Get background styling based on type
  const getBackgroundStyles = () => {
    if (isSelected) {
      return 'bg-indigo-100 ring-2 ring-indigo-400'
    }
    switch (item.type) {
      case 'phase':
        return 'bg-indigo-50/50 hover:bg-indigo-100/70'
      case 'stage':
        return 'bg-amber-50/30 hover:bg-amber-100/50'
      case 'block':
        return 'bg-teal-50/30 hover:bg-teal-100/40'
      case 'task':
        return 'hover:bg-slate-100'
      default:
        return 'hover:bg-slate-100'
    }
  }
  
  return (
    <div className="relative">
      <div
        className={`
          flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer
          transition-colors duration-150
          ${getBackgroundStyles()}
        `}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={onSelect}
        onContextMenu={(e) => onContextMenu(e, item)}
      >
        {/* Expand/collapse toggle */}
        {isContainer ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            className="p-0.5 hover:bg-slate-200 rounded transition-colors"
          >
            {isExpanded ? (
              <ChevronDownIcon className="w-4 h-4 text-slate-600" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-slate-500" />
            )}
          </button>
        ) : (
          <span className="w-5" /> // Spacer for alignment
        )}
        
        {/* Type icon */}
        <TypeIcon />
        
        {/* Label */}
        <span className={`flex-1 truncate ${getTypeStyles()}`}>
          {displayLabel}
        </span>
        
        {/* Stage type badge for tasks/blocks */}
        {item.stageType && (
          <span className="px-1.5 py-0.5 text-xs font-medium bg-slate-200 text-slate-600 rounded">
            {item.stageType}
          </span>
        )}
        
        {/* Ordering mode indicator */}
        {isContainer && item.rules?.ordering && item.rules.ordering !== 'sequential' && (
          <span title={orderingConfig.label}>
            <OrderingIcon className={`w-4 h-4 ${orderingConfig.color}`} />
          </span>
        )}
        
        {/* Visibility indicator */}
        {item.rules?.visibility && (
          <span title={`Visibility: ${item.rules.visibility}`}>
            <EyeIcon className="w-4 h-4 text-yellow-500" />
          </span>
        )}
        
        {/* Actions menu button */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="p-1 hover:bg-slate-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <EllipsisVerticalIcon className="w-4 h-4 text-slate-500" />
          </button>
          
          {/* Context menu */}
          {showMenu && (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-48 bg-white rounded-lg shadow-xl border border-slate-200 py-1"
              onMouseLeave={() => setShowMenu(false)}
            >
              {isContainer && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowMenu(false)
                      // Add child based on current type
                      const childType = item.type === 'phase' ? 'stage' : item.type === 'stage' ? 'block' : 'task'
                      onAddChild?.(childType)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    <PlusIcon className="w-4 h-4" />
                    Add Child
                  </button>
                  <div className="border-t border-slate-200 my-1" />
                </>
              )}
              
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  onDuplicate()
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-slate-700 hover:bg-slate-100"
              >
                <DocumentDuplicateIcon className="w-4 h-4" />
                Duplicate
              </button>
              
              {canMoveUp && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowMenu(false)
                    onMoveUp()
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-slate-700 hover:bg-slate-100"
                >
                  <ArrowUpIcon className="w-4 h-4" />
                  Move Up
                </button>
              )}
              
              {canMoveDown && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowMenu(false)
                    onMoveDown()
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-slate-700 hover:bg-slate-100"
                >
                  <ArrowDownIcon className="w-4 h-4" />
                  Move Down
                </button>
              )}
              
              <div className="border-t border-slate-200 my-1" />
              
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  onDelete()
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-red-600 hover:bg-red-50"
              >
                <TrashIcon className="w-4 h-4" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Main tree editor component
export const HierarchyTreeEditor: React.FC<HierarchyTreeEditorProps> = ({
  phases,
  onPhasesChange,
  onItemSelect,
  selectedItemId,
  expandedIds: externalExpandedIds,
  onToggleExpand,
  onSettingsSelect,
  isSettingsSelected,
  onItemDuplicated,
}) => {
  const [internalExpandedIds, setInternalExpandedIds] = useState<Set<string>>(new Set())
  const [_contextMenu, setContextMenu] = useState<{ x: number; y: number; item: HierarchyItem } | null>(null)
  const hasInitializedRef = React.useRef(false)
  
  // Use external or internal expanded state
  const expandedIds = externalExpandedIds || internalExpandedIds
  const toggleExpand = onToggleExpand || ((id: string) => {
    setInternalExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  })
  
  // Ensure an item is expanded (without toggling)
  const ensureExpanded = (id: string) => {
    if (onToggleExpand) {
      // If using external state, we need to check if it's already expanded
      // If not, toggle it once to expand
      if (!externalExpandedIds?.has(id)) {
        onToggleExpand(id)
      }
    } else {
      // For internal state, just add if not already present
      setInternalExpandedIds(prev => {
        if (prev.has(id)) {
          return prev
        }
        const next = new Set(prev)
        next.add(id)
        return next
      })
    }
  }
  
  // Expand/collapse all
  const expandAll = useCallback(() => {
    const allIds = new Set<string>()
    const collectIds = (items: HierarchyItem[]) => {
      items.forEach(item => {
        if (item.children && item.children.length > 0) {
          allIds.add(item.id)
          collectIds(item.children)
        }
      })
    }
    collectIds(phases)
    setInternalExpandedIds(allIds)
  }, [phases])
  
  const collapseAll = useCallback(() => {
    setInternalExpandedIds(new Set())
  }, [])
  
  // Auto-expand all items on initial load
  React.useEffect(() => {
    if (!hasInitializedRef.current && phases.length > 0) {
      hasInitializedRef.current = true
      expandAll()
    }
  }, [phases, expandAll])
  
  // Handle context menu
  const handleContextMenu = (event: React.MouseEvent, item: HierarchyItem) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, item })
  }
  
  // Handle item operations
  const handleAddChild = (parentPath: string[], childType: string) => {
    const newPhases = JSON.parse(JSON.stringify(phases))
    const newChild: HierarchyItem = {
      id: `new_${childType}_${Date.now()}`,
      type: childType as 'phase' | 'stage' | 'block' | 'task',
      label: `New ${childType.charAt(0).toUpperCase() + childType.slice(1)}`,
      children: childType !== 'task' ? [] : undefined,
    }
    
    // Navigate to parent and add child
    let current: HierarchyItem[] = newPhases
    for (let i = 0; i < parentPath.length; i++) {
      const found = current.find(item => item.id === parentPath[i])
      if (found && found.children) {
        if (i === parentPath.length - 1) {
          found.children.push(newChild)
        } else {
          current = found.children
        }
      }
    }
    
    // Ensure parent is expanded so the new child is visible
    const parentId = parentPath[parentPath.length - 1]
    ensureExpanded(parentId)
    
    onPhasesChange(newPhases)
  }
  
  const handleDelete = (path: string[]) => {
    const newPhases = JSON.parse(JSON.stringify(phases))
    const targetId = path[path.length - 1]
    
    if (path.length === 1) {
      // Deleting a phase
      const index = newPhases.findIndex((p: HierarchyItem) => p.id === targetId)
      if (index !== -1) {
        newPhases.splice(index, 1)
      }
    } else {
      // Navigate to parent and delete
      let current: HierarchyItem[] = newPhases
      for (let i = 0; i < path.length - 1; i++) {
        const found = current.find(item => item.id === path[i])
        if (found && found.children) {
          if (i === path.length - 2) {
            const index = found.children.findIndex(c => c.id === targetId)
            if (index !== -1) {
              found.children.splice(index, 1)
            }
          } else {
            current = found.children
          }
        }
      }
    }
    
    onPhasesChange(newPhases)
  }
  
  // Collect all existing IDs and labels in the hierarchy
  const collectExistingIdsAndLabels = useCallback((items: HierarchyItem[]): { ids: string[], labels: string[] } => {
    const ids: string[] = []
    const labels: string[] = []
    
    const collect = (itemList: HierarchyItem[]) => {
      for (const item of itemList) {
        ids.push(item.id)
        if (item.label) labels.push(item.label)
        if (item.children) {
          collect(item.children)
        }
      }
    }
    
    collect(items)
    return { ids, labels }
  }, [])
  
  const handleDuplicate = (path: string[]) => {
    const newPhases = JSON.parse(JSON.stringify(phases))
    const targetId = path[path.length - 1]
    
    // Collect all existing IDs and labels to ensure uniqueness with smart generation
    const { ids: existingIds, labels: existingLabels } = collectExistingIdsAndLabels(newPhases)
    
    // Track IDs and labels generated during this duplication to avoid conflicts
    const generatedIds = new Set<string>()
    const generatedLabels = new Set<string>()
    
    // Track the root duplicated item's new ID, original data, and duplicated data for duplication tracking
    let rootNewItemId: string | null = null
    let rootOriginalData: Record<string, unknown> | null = null
    let rootDuplicatedData: Record<string, unknown> | null = null
    let isFirstItem = true
    
    const duplicateItem = (item: HierarchyItem): HierarchyItem => {
      // Store original data for the root item (first call)
      // For tasks, use originalData which contains the actual task configuration
      // For other items (phase, stage, block), use the item itself
      if (isFirstItem) {
        const itemWithOriginal = item as HierarchyItem & { originalData?: Record<string, unknown> }
        if (item.type === 'task' && itemWithOriginal.originalData) {
          rootOriginalData = JSON.parse(JSON.stringify(itemWithOriginal.originalData))
        } else {
          rootOriginalData = JSON.parse(JSON.stringify(item))
        }
        isFirstItem = false
      }
      
      const newItem = JSON.parse(JSON.stringify(item))
      
      // Generate ID with _copy suffix (prefer copy suffix for hierarchy duplication)
      // This preserves original numbering so refactoring works correctly
      const allExistingIds = [...existingIds, ...generatedIds]
      const newId = generateSmartId(item.id, allExistingIds, true)
      newItem.id = newId
      generatedIds.add(newId)
      
      // Track root item's new ID
      if (rootNewItemId === null) {
        rootNewItemId = newId
      }
      
      // Generate label with (Copy) suffix (prefer copy suffix for hierarchy duplication)
      const allExistingLabels = [...existingLabels, ...generatedLabels]
      const newLabel = generateSmartLabel(item.label, allExistingLabels, true)
      if (newLabel) {
        newItem.label = newLabel
        generatedLabels.add(newLabel)
      }
      
      if (newItem.children) {
        newItem.children = newItem.children.map(duplicateItem)
      }
      return newItem
    }
    
    if (path.length === 1) {
      const index = newPhases.findIndex((p: HierarchyItem) => p.id === targetId)
      if (index !== -1) {
        const duplicated = duplicateItem(newPhases[index])
        rootDuplicatedData = duplicated as unknown as Record<string, unknown>
        newPhases.splice(index + 1, 0, duplicated)
      }
    } else {
      let current: HierarchyItem[] = newPhases
      for (let i = 0; i < path.length - 1; i++) {
        const found = current.find(item => item.id === path[i])
        if (found && found.children) {
          if (i === path.length - 2) {
            const index = found.children.findIndex(c => c.id === targetId)
            if (index !== -1) {
              const duplicated = duplicateItem(found.children[index])
              rootDuplicatedData = duplicated as unknown as Record<string, unknown>
              found.children.splice(index + 1, 0, duplicated)
            }
          } else {
            current = found.children
          }
        }
      }
    }
    
    onPhasesChange(newPhases)
    
    // Report duplication for tracking unchanged values
    if (rootNewItemId && rootOriginalData && rootDuplicatedData && onItemDuplicated) {
      onItemDuplicated(rootNewItemId, rootOriginalData, rootDuplicatedData)
    }
  }
  
  const handleMove = (path: string[], direction: 'up' | 'down') => {
    const newPhases: HierarchyItem[] = JSON.parse(JSON.stringify(phases))
    const targetId = path[path.length - 1]
    
    // Helper to find an array and index by path
    const getContainerAndIndex = (containerPath: string[]): { container: HierarchyItem[], index: number } | null => {
      if (containerPath.length === 0) {
        const index = newPhases.findIndex(item => item.id === targetId)
        return index !== -1 ? { container: newPhases, index } : null
      }
      
      let current: HierarchyItem[] = newPhases
      for (let i = 0; i < containerPath.length; i++) {
        const found = current.find(item => item.id === containerPath[i])
        if (!found || !found.children) return null
        
        if (i === containerPath.length - 1) {
          const index = found.children.findIndex(c => c.id === targetId)
          return index !== -1 ? { container: found.children, index } : null
        }
        current = found.children
      }
      return null
    }
    
    // Helper to find sibling containers of a parent
    const getSiblingContainers = (parentPath: string[]): { prev: HierarchyItem | null, next: HierarchyItem | null } => {
      if (parentPath.length === 0) {
        // No parent means this is a phase - no sibling containers
        return { prev: null, next: null }
      }
      
      const parentId = parentPath[parentPath.length - 1]
      const grandparentPath = parentPath.slice(0, -1)
      
      let grandparentContainer: HierarchyItem[]
      if (grandparentPath.length === 0) {
        grandparentContainer = newPhases
      } else {
        let current: HierarchyItem[] = newPhases
        for (let i = 0; i < grandparentPath.length; i++) {
          const found = current.find(item => item.id === grandparentPath[i])
          if (!found || !found.children) return { prev: null, next: null }
          current = found.children
        }
        grandparentContainer = current
      }
      
      const parentIndex = grandparentContainer.findIndex(item => item.id === parentId)
      if (parentIndex === -1) return { prev: null, next: null }
      
      return {
        prev: parentIndex > 0 ? grandparentContainer[parentIndex - 1] : null,
        next: parentIndex < grandparentContainer.length - 1 ? grandparentContainer[parentIndex + 1] : null
      }
    }
    
    const parentPath = path.slice(0, -1)
    const result = getContainerAndIndex(parentPath)
    if (!result) return
    
    const { container, index } = result
    
    // Check if we can move within the same container
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex >= 0 && newIndex < container.length) {
      // Normal in-container move
      const [item] = container.splice(index, 1)
      container.splice(newIndex, 0, item)
      onPhasesChange(newPhases)
      return
    }
    
    // Cross-container movement
    const { prev, next } = getSiblingContainers(parentPath)
    
    if (direction === 'up' && index === 0 && prev && prev.children) {
      // Move to the end of the previous sibling container
      const [item] = container.splice(index, 1)
      prev.children.push(item)
      // Ensure the destination container is expanded
      ensureExpanded(prev.id)
      onPhasesChange(newPhases)
      return
    }
    
    if (direction === 'down' && index === container.length - 1 && next && next.children) {
      // Move to the beginning of the next sibling container
      const [item] = container.splice(index, 1)
      next.children.unshift(item)
      // Ensure the destination container is expanded
      ensureExpanded(next.id)
      onPhasesChange(newPhases)
      return
    }
    
    onPhasesChange(newPhases)
  }
  
  // Helper to determine if cross-container movement is possible
  const canMoveAcrossContainers = (path: string[], direction: 'up' | 'down'): boolean => {
    if (path.length <= 1) {
      // Phases can't move across containers (there's no parent)
      return false
    }
    
    const parentPath = path.slice(0, -1)
    const parentId = parentPath[parentPath.length - 1]
    const grandparentPath = parentPath.slice(0, -1)
    
    let grandparentContainer: HierarchyItem[]
    if (grandparentPath.length === 0) {
      grandparentContainer = phases
    } else {
      let current: HierarchyItem[] = phases
      for (let i = 0; i < grandparentPath.length; i++) {
        const found = current.find(item => item.id === grandparentPath[i])
        if (!found || !found.children) return false
        current = found.children
      }
      grandparentContainer = current
    }
    
    const parentIndex = grandparentContainer.findIndex(item => item.id === parentId)
    if (parentIndex === -1) return false
    
    if (direction === 'up') {
      // Can move up across containers if there's a previous sibling with children
      const prevSibling = parentIndex > 0 ? grandparentContainer[parentIndex - 1] : null
      return prevSibling !== null && prevSibling.children !== undefined
    } else {
      // Can move down across containers if there's a next sibling with children
      const nextSibling = parentIndex < grandparentContainer.length - 1 ? grandparentContainer[parentIndex + 1] : null
      return nextSibling !== null && nextSibling.children !== undefined
    }
  }
  
  // Recursive render function
  const renderTree = (items: HierarchyItem[], depth: number = 0, parentPath: string[] = []) => {
    return items.map((item, index) => {
      const currentPath = [...parentPath, item.id]
      const isExpanded = expandedIds.has(item.id)
      
      // Calculate canMoveUp/canMoveDown including cross-container movement
      const canMoveUpInContainer = index > 0
      const canMoveDownInContainer = index < items.length - 1
      const canMoveUpAcross = !canMoveUpInContainer && canMoveAcrossContainers(currentPath, 'up')
      const canMoveDownAcross = !canMoveDownInContainer && canMoveAcrossContainers(currentPath, 'down')
      
      return (
        <div key={item.id} className="group">
          <TreeNode
            item={item}
            depth={depth}
            path={currentPath}
            isExpanded={isExpanded}
            isSelected={selectedItemId === item.id}
            onToggle={() => toggleExpand(item.id)}
            onSelect={() => onItemSelect(item, currentPath)}
            onContextMenu={handleContextMenu}
            onAddChild={(type) => handleAddChild(currentPath, type)}
            onDelete={() => handleDelete(currentPath)}
            onDuplicate={() => handleDuplicate(currentPath)}
            onMoveUp={() => handleMove(currentPath, 'up')}
            onMoveDown={() => handleMove(currentPath, 'down')}
            canMoveUp={canMoveUpInContainer || canMoveUpAcross}
            canMoveDown={canMoveDownInContainer || canMoveDownAcross}
          />
          
          {/* Render children if expanded */}
          {isExpanded && item.children && item.children.length > 0 && (
            <div className="ml-0">
              {renderTree(item.children, depth + 1, currentPath)}
            </div>
          )}
        </div>
      )
    })
  }
  
  return (
    <div className="h-full flex flex-col bg-white">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-slate-200 bg-slate-50">
        <button
          onClick={expandAll}
          className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded transition-colors"
          title="Expand All"
        >
          Expand All
        </button>
        <button
          onClick={collapseAll}
          className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded transition-colors"
          title="Collapse All"
        >
          Collapse All
        </button>
        <div className="flex-1" />
        <button
          onClick={() => {
            const newPhase: HierarchyItem = {
              id: `phase_${Date.now()}`,
              type: 'phase',
              label: 'New Phase',
              children: [],
            }
            onPhasesChange([...phases, newPhase])
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-indigo-500 text-white rounded-md hover:bg-indigo-600 transition-colors shadow-sm"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          Add Phase
        </button>
      </div>
      
      {/* Tree content */}
      <div className="flex-1 overflow-auto p-2">
        {/* Settings item - always visible at top */}
        {onSettingsSelect && (
          <div
            className={`
              flex items-center gap-2 px-3 py-2.5 mb-2 rounded-md cursor-pointer border transition-colors
              ${isSettingsSelected 
                ? 'bg-indigo-100 border-indigo-300 ring-2 ring-indigo-400' 
                : 'bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
              }
            `}
            onClick={onSettingsSelect}
          >
            <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="font-semibold text-slate-700">Settings</span>
          </div>
        )}
        
        {/* Hierarchy separator */}
        {onSettingsSelect && phases.length > 0 && (
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2 mb-2 mt-3">
            Experiment Structure
          </div>
        )}
        
        {phases.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <FolderIcon className="w-12 h-12 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">No phases yet</p>
            <p className="text-xs mt-1 text-slate-400">
              Click "Add Phase" to create the experiment structure
            </p>
            <p className="text-xs mt-2 text-slate-400">
              Hierarchy: Phase → Stage → Block → Task
            </p>
          </div>
        ) : (
          renderTree(phases)
        )}
      </div>
    </div>
  )
}

export default HierarchyTreeEditor

