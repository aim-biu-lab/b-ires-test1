import { useState, useMemo, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { StageConfig, Progress, LockedItems } from '../store/sessionStore'

// Extended stage config with hierarchy metadata
interface ExtendedStageConfig extends StageConfig {
  _phase_id?: string
  _phase_label?: string
  _phase_collapsed_by_default?: boolean
  _phase_show_in_sidebar?: boolean
  _stage_id?: string
  _stage_label?: string
  _stage_collapsed_by_default?: boolean
  _stage_show_in_sidebar?: boolean
  _block_id?: string
  _block_label?: string
  _block_collapsed_by_default?: boolean
  _block_show_in_sidebar?: boolean
}

// Hierarchy group structure (can be phase, stage, or block)
interface HierarchyGroup {
  id: string
  type: 'phase' | 'stage' | 'block'
  label: string
  collapsedByDefault: boolean
  showInSidebar: boolean
  children: HierarchyGroup[]
  tasks: ExtendedStageConfig[]
  firstTaskIndex: number  // Track first occurrence for ordering
}

// Root item can be either a group or an ungrouped task
type RootItem = 
  | { kind: 'group'; group: HierarchyGroup }
  | { kind: 'task'; task: ExtendedStageConfig; index: number }

interface SidebarProps {
  stages: StageConfig[]
  currentStageId: string
  completedStageIds: string[]
  progress: Progress
  onStageClick?: (stageId: string) => void
  /** When true, hide the progress indicator (it's shown in bottom nav bar instead) */
  hideProgressIndicator?: boolean
  /** Assignments for balanced/weighted distribution (phase_id -> shown) */
  assignments?: Record<string, string>
  /** Locked items that participant cannot return to */
  lockedItems?: LockedItems
  /** Function to check if a stage is locked */
  isStageLockedForReturn?: (stageId: string) => boolean
  /** Preview mode - allows free navigation to any stage */
  previewMode?: boolean
}

export default function Sidebar({
  stages,
  currentStageId,
  completedStageIds,
  progress,
  onStageClick,
  hideProgressIndicator = false,
  assignments = {},
  lockedItems = { phases: [], stages: [], blocks: [], tasks: [] },
  isStageLockedForReturn,
  previewMode = false,
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string> | null>(null)
  // Track groups that user has explicitly expanded (to override auto-collapse of completed groups)
  const [userExpandedGroups, setUserExpandedGroups] = useState<Set<string>>(new Set())
  const [initializedFromConfig, setInitializedFromConfig] = useState(false)
  // Track the previous stage ID to detect navigation
  const prevStageIdRef = useRef<string | null>(null)

  // On mobile, start collapsed
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  // Build hierarchical structure from flat stages, preserving original order
  const hierarchy = useMemo(() => {
    const extStages = stages as ExtendedStageConfig[]
    
    // Maps to track unique groups
    const phaseMap = new Map<string, HierarchyGroup>()
    const stageMap = new Map<string, HierarchyGroup>()
    const blockMap = new Map<string, HierarchyGroup>()
    
    // Track root items in their original order (groups or ungrouped tasks)
    const rootItems: RootItem[] = []
    // Track which groups have been added to rootItems (by their root-level group ID)
    const addedRootGroups = new Set<string>()
    
    for (let taskIndex = 0; taskIndex < extStages.length; taskIndex++) {
      const task = extStages[taskIndex]
      const phaseId = task._phase_id
      const phaseShowInSidebar = task._phase_show_in_sidebar !== false
      const stageId = task._stage_id
      const stageShowInSidebar = task._stage_show_in_sidebar !== false
      const blockId = task._block_id
      const blockShowInSidebar = task._block_show_in_sidebar !== false
      
      // Skip phases based on assignments
      if (phaseId && assignments[phaseId] && !extStages.some(s => s._phase_id === phaseId)) {
        continue
      }
      
      // Determine where to place this task based on show_in_sidebar settings
      // Find the deepest level that has show_in_sidebar: true
      
      let targetGroup: HierarchyGroup | null = null
      let rootGroupId: string | null = null  // The ID of the root-level group for this task
      
      // Try block level first (deepest)
      if (blockId && blockShowInSidebar) {
        if (!blockMap.has(blockId)) {
          const blockGroup: HierarchyGroup = {
            id: blockId,
            type: 'block',
            label: task._block_label || blockId,
            collapsedByDefault: task._block_collapsed_by_default || false,
            showInSidebar: true,
            children: [],
            tasks: [],
            firstTaskIndex: taskIndex,
          }
          blockMap.set(blockId, blockGroup)
          
          // Add block to its parent (stage or phase or root)
          if (stageId && stageShowInSidebar) {
            if (!stageMap.has(stageId)) {
              const stageGroup: HierarchyGroup = {
                id: stageId,
                type: 'stage',
                label: task._stage_label || stageId,
                collapsedByDefault: task._stage_collapsed_by_default || false,
                showInSidebar: true,
                children: [],
                tasks: [],
                firstTaskIndex: taskIndex,
              }
              stageMap.set(stageId, stageGroup)
              
              // Add stage to phase or root
              if (phaseId && phaseShowInSidebar) {
                if (!phaseMap.has(phaseId)) {
                  const phaseGroup: HierarchyGroup = {
                    id: phaseId,
                    type: 'phase',
                    label: task._phase_label || phaseId,
                    collapsedByDefault: task._phase_collapsed_by_default || false,
                    showInSidebar: true,
                    children: [],
                    tasks: [],
                    firstTaskIndex: taskIndex,
                  }
                  phaseMap.set(phaseId, phaseGroup)
                  rootGroupId = phaseId
                }
                phaseMap.get(phaseId)!.children.push(stageGroup)
              } else {
                rootGroupId = stageId
              }
            }
            stageMap.get(stageId)!.children.push(blockGroup)
          } else if (phaseId && phaseShowInSidebar) {
            if (!phaseMap.has(phaseId)) {
              const phaseGroup: HierarchyGroup = {
                id: phaseId,
                type: 'phase',
                label: task._phase_label || phaseId,
                collapsedByDefault: task._phase_collapsed_by_default || false,
                showInSidebar: true,
                children: [],
                tasks: [],
                firstTaskIndex: taskIndex,
              }
              phaseMap.set(phaseId, phaseGroup)
              rootGroupId = phaseId
            }
            phaseMap.get(phaseId)!.children.push(blockGroup)
          } else {
            rootGroupId = blockId
          }
        }
        targetGroup = blockMap.get(blockId)!
        
        // Determine root group ID if not already set
        if (!rootGroupId) {
          if (stageId && stageShowInSidebar) {
            if (phaseId && phaseShowInSidebar) {
              rootGroupId = phaseId
            } else {
              rootGroupId = stageId
            }
          } else if (phaseId && phaseShowInSidebar) {
            rootGroupId = phaseId
          } else {
            rootGroupId = blockId
          }
        }
      }
      // Try stage level
      else if (stageId && stageShowInSidebar) {
        if (!stageMap.has(stageId)) {
          const stageGroup: HierarchyGroup = {
            id: stageId,
            type: 'stage',
            label: task._stage_label || stageId,
            collapsedByDefault: task._stage_collapsed_by_default || false,
            showInSidebar: true,
            children: [],
            tasks: [],
            firstTaskIndex: taskIndex,
          }
          stageMap.set(stageId, stageGroup)
          
          // Add stage to phase or root
          if (phaseId && phaseShowInSidebar) {
            if (!phaseMap.has(phaseId)) {
              const phaseGroup: HierarchyGroup = {
                id: phaseId,
                type: 'phase',
                label: task._phase_label || phaseId,
                collapsedByDefault: task._phase_collapsed_by_default || false,
                showInSidebar: true,
                children: [],
                tasks: [],
                firstTaskIndex: taskIndex,
              }
              phaseMap.set(phaseId, phaseGroup)
              rootGroupId = phaseId
            }
            phaseMap.get(phaseId)!.children.push(stageGroup)
          } else {
            rootGroupId = stageId
          }
        }
        targetGroup = stageMap.get(stageId)!
        
        // Determine root group ID if not already set
        if (!rootGroupId) {
          if (phaseId && phaseShowInSidebar) {
            rootGroupId = phaseId
          } else {
            rootGroupId = stageId
          }
        }
      }
      // Try phase level
      else if (phaseId && phaseShowInSidebar) {
        if (!phaseMap.has(phaseId)) {
          const phaseGroup: HierarchyGroup = {
            id: phaseId,
            type: 'phase',
            label: task._phase_label || phaseId,
            collapsedByDefault: task._phase_collapsed_by_default || false,
            showInSidebar: true,
            children: [],
            tasks: [],
            firstTaskIndex: taskIndex,
          }
          phaseMap.set(phaseId, phaseGroup)
          rootGroupId = phaseId
        }
        targetGroup = phaseMap.get(phaseId)!
        rootGroupId = phaseId
      }
      
      // Add task to target group or as ungrouped root item
      if (targetGroup) {
        targetGroup.tasks.push(task)
        
        // Add root group to rootItems if not already added (preserves order)
        if (rootGroupId && !addedRootGroups.has(rootGroupId)) {
          addedRootGroups.add(rootGroupId)
          const rootGroup = phaseMap.get(rootGroupId) || stageMap.get(rootGroupId) || blockMap.get(rootGroupId)
          if (rootGroup) {
            rootItems.push({ kind: 'group', group: rootGroup })
          }
        }
      } else {
        // Ungrouped task - add directly to rootItems to preserve order
        rootItems.push({ kind: 'task', task, index: taskIndex })
      }
    }
    
    return { rootItems }
  }, [stages, assignments])

  // Helper: Get all tasks recursively in a group
  const getAllTasksInGroup = (group: HierarchyGroup): ExtendedStageConfig[] => {
    const tasks = [...group.tasks]
    group.children.forEach(child => {
      tasks.push(...getAllTasksInGroup(child))
    })
    return tasks
  }

  // Helper: Find all groups containing a specific task ID
  const findGroupsContainingTask = (items: RootItem[], taskId: string): HierarchyGroup[] => {
    const result: HierarchyGroup[] = []
    
    const checkGroup = (group: HierarchyGroup): boolean => {
      // Check if this group directly contains the task
      const directlyContains = group.tasks.some(t => t.id === taskId)
      
      // Check if any child group contains the task
      const childContains = group.children.some(child => checkGroup(child))
      
      if (directlyContains || childContains) {
        result.push(group)
        return true
      }
      return false
    }
    
    for (const item of items) {
      if (item.kind === 'group') {
        checkGroup(item.group)
      }
    }
    return result
  }

  // Helper: Get all groups with collapsedByDefault: true
  const getCollapsedByDefaultGroups = (items: RootItem[]): HierarchyGroup[] => {
    const result: HierarchyGroup[] = []
    
    const processGroup = (group: HierarchyGroup) => {
      if (group.collapsedByDefault) {
        result.push(group)
      }
      group.children.forEach(processGroup)
    }
    
    for (const item of items) {
      if (item.kind === 'group') {
        processGroup(item.group)
      }
    }
    return result
  }

  // Helper: Check if a group contains the current task (recursively)
  const groupContainsTask = (group: HierarchyGroup, taskId: string): boolean => {
    return group.tasks.some(t => t.id === taskId) ||
      group.children.some(child => groupContainsTask(child, taskId))
  }

  // Collect all groups that should be collapsed by default
  // If a parent has collapsedByDefault: true, children not on path to current should also be collapsed
  const collectDefaultCollapsed = (items: RootItem[]): Set<string> => {
    const collapsed = new Set<string>()
    
    const processGroup = (group: HierarchyGroup, parentHasCollapsedByDefault: boolean) => {
      // Check if group contains current stage (is on the path to current)
      const containsCurrent = groupContainsTask(group, currentStageId)
      
      // This group should be collapsed if:
      // 1. It has collapsedByDefault AND doesn't contain current, OR
      // 2. Its parent has collapsedByDefault AND this group doesn't contain current
      const shouldCollapse = !containsCurrent && (group.collapsedByDefault || parentHasCollapsedByDefault)
      
      if (shouldCollapse) {
        collapsed.add(group.id)
      }
      
      // Pass down collapsedByDefault status to children
      const passToChildren = group.collapsedByDefault || parentHasCollapsedByDefault
      group.children.forEach(child => processGroup(child, passToChildren))
    }
    
    for (const item of items) {
      if (item.kind === 'group') {
        processGroup(item.group, false)
      }
    }
    return collapsed
  }

  // Initialize collapsed groups from config
  if (!initializedFromConfig && hierarchy.rootItems.length > 0) {
    const initialCollapsed = collectDefaultCollapsed(hierarchy.rootItems)
    setCollapsedGroups(initialCollapsed)
    setInitializedFromConfig(true)
  }

  const effectiveCollapsedGroups = collapsedGroups || new Set<string>()

  // Helper: Check if a group or any of its ancestors has collapsedByDefault
  const hasCollapsedByDefaultAncestor = (groupId: string, items: RootItem[]): boolean => {
    const collapsedByDefaultGroups = getCollapsedByDefaultGroups(items)
    
    // Check if this group itself has collapsedByDefault
    if (collapsedByDefaultGroups.some(g => g.id === groupId)) {
      return true
    }
    
    // Check if any ancestor has collapsedByDefault
    // We need to find the path to this group and check each ancestor
    const findAncestorPath = (group: HierarchyGroup, targetId: string, path: HierarchyGroup[] = []): HierarchyGroup[] | null => {
      if (group.id === targetId) {
        return path
      }
      for (const child of group.children) {
        const result = findAncestorPath(child, targetId, [...path, group])
        if (result) return result
      }
      return null
    }
    
    for (const item of items) {
      if (item.kind === 'group') {
        const ancestorPath = findAncestorPath(item.group, groupId)
        if (ancestorPath) {
          // Check if any ancestor in the path has collapsedByDefault
          return ancestorPath.some(ancestor => ancestor.collapsedByDefault)
        }
      }
    }
    
    return false
  }

  // Auto-expand/collapse groups based on currentStageId changes
  useEffect(() => {
    if (!initializedFromConfig || hierarchy.rootItems.length === 0) return
    
    const prevStageId = prevStageIdRef.current
    
    // Skip if this is the first render or stage hasn't changed
    if (prevStageId === null || prevStageId === currentStageId) {
      prevStageIdRef.current = currentStageId
      return
    }
    
    // Find groups containing previous and current stages (these are the "path" groups)
    const prevGroups = prevStageId ? findGroupsContainingTask(hierarchy.rootItems, prevStageId) : []
    const currentGroups = findGroupsContainingTask(hierarchy.rootItems, currentStageId)
    
    // Groups we're entering (on path to current but not on path to previous)
    const enteringGroups = currentGroups.filter(g => !prevGroups.some(pg => pg.id === g.id))
    
    // Groups we're leaving (on path to previous but not on path to current)
    const leavingGroups = prevGroups.filter(g => !currentGroups.some(cg => cg.id === g.id))
    
    setCollapsedGroups(prev => {
      const next = new Set(prev || new Set())
      
      // Expand groups we're entering that have collapsedByDefault (or ancestor has it)
      for (const group of enteringGroups) {
        if (group.collapsedByDefault || hasCollapsedByDefaultAncestor(group.id, hierarchy.rootItems)) {
          next.delete(group.id)
        }
      }
      
      // Collapse groups we're leaving that have collapsedByDefault or ancestor has it (and are not completed)
      for (const group of leavingGroups) {
        if (group.collapsedByDefault || hasCollapsedByDefaultAncestor(group.id, hierarchy.rootItems)) {
          // Only collapse if not all tasks are completed (let auto-collapse handle completed groups)
          const allTasks = getAllTasksInGroup(group)
          const isCompleted = allTasks.length > 0 && allTasks.every(t => completedStageIds.includes(t.id))
          if (!isCompleted) {
            next.add(group.id)
          }
        }
      }
      
      return next
    })
    
    // Also clear user-expanded state for groups we're leaving
    setUserExpandedGroups(prev => {
      const next = new Set(prev)
      for (const group of leavingGroups) {
        if (group.collapsedByDefault || hasCollapsedByDefaultAncestor(group.id, hierarchy.rootItems)) {
          next.delete(group.id)
        }
      }
      return next
    })
    
    prevStageIdRef.current = currentStageId
  }, [currentStageId, initializedFromConfig, hierarchy.rootItems, completedStageIds])

  // Toggle group collapse - handles both explicit and auto-collapsed groups
  const toggleGroup = (groupId: string) => {
    // Check if user had explicitly expanded this group
    const wasUserExpanded = userExpandedGroups.has(groupId)
    // Check if group is in the collapsed set
    const isInCollapsedSet = effectiveCollapsedGroups.has(groupId)
    
    if (wasUserExpanded) {
      // User previously expanded it, now collapsing - remove from user-expanded
      setUserExpandedGroups(prev => {
        const next = new Set(prev)
        next.delete(groupId)
        return next
      })
      // Add to collapsed set to explicitly collapse
      setCollapsedGroups(prev => {
        const next = new Set(prev || new Set())
        next.add(groupId)
        return next
      })
    } else if (isInCollapsedSet) {
      // Was explicitly collapsed, now expanding
      setCollapsedGroups(prev => {
        const next = new Set(prev || new Set())
        next.delete(groupId)
        return next
      })
    } else {
      // Was auto-collapsed (completed group), user is expanding it
      setUserExpandedGroups(prev => {
        const next = new Set(prev)
        next.add(groupId)
        return next
      })
    }
  }

  // Helper functions
  const isGroupCompleted = (group: HierarchyGroup): boolean => {
    const allTasks = getAllTasksInGroup(group)
    return allTasks.length > 0 && allTasks.every(t => completedStageIds.includes(t.id))
  }

  const groupContainsCurrent = (group: HierarchyGroup): boolean => {
    return getAllTasksInGroup(group).some(t => t.id === currentStageId)
  }

  const getCompletedCount = (group: HierarchyGroup): { completed: number; total: number } => {
    const allTasks = getAllTasksInGroup(group)
    return {
      completed: allTasks.filter(t => completedStageIds.includes(t.id)).length,
      total: allTasks.length,
    }
  }

  if (isMobile && isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="fixed left-4 top-20 z-30 p-2 bg-surface border border-border rounded-lg shadow-md"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    )
  }

  // Render a single task item
  const renderTaskItem = (task: ExtendedStageConfig, localIndex: number) => {
    const isCompleted = completedStageIds.includes(task.id)
    const isCurrent = task.id === currentStageId
    
    // Check if this stage is locked for return
    const isLocked = isStageLockedForReturn?.(task.id) ?? false
    
    // Find this task's actual index in the flat stages array
    const actualIndex = stages.findIndex(s => s.id === task.id)
    
    // Check if this is the next available stage
    // All stages BEFORE this one (in the flat array) must be completed
    const isNextAvailable = !isCompleted && actualIndex >= 0 && 
      stages.slice(0, actualIndex).every((s) => completedStageIds.includes(s.id))
    
    // In preview mode, all stages are clickable (except current)
    // Normal mode: Stage is clickable if completed (and not locked) OR next available (and not current)
    const isClickable = previewMode 
      ? (!isCurrent && onStageClick)
      : (((isCompleted && !isLocked) || isNextAvailable) && !isCurrent && onStageClick)

    const content = (
      <>
        {/* Status Icon */}
        <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
          {isCompleted && isLocked ? (
            // Locked completed stage - show lock icon
            <svg className="w-4 h-4 text-text-muted" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : isCompleted ? (
            <svg className="w-5 h-5 text-success" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          ) : isCurrent ? (
            <span className="w-2 h-2 bg-primary rounded-full" />
          ) : (
            <span className="text-text-muted">{localIndex + 1}</span>
          )}
        </span>

        {/* Task Label */}
        <span className="truncate">{task.label || `Step ${localIndex + 1}`}</span>
      </>
    )

    if (isClickable) {
      return (
        <button
          key={task.id}
          onClick={() => onStageClick(task.id)}
          className={clsx(
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left',
            'hover:bg-muted cursor-pointer',
            'text-text-secondary'
          )}
        >
          {content}
        </button>
      )
    }

    return (
      <div
        key={task.id}
        className={clsx(
          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
          isCurrent && 'bg-primary-light text-primary font-medium',
          isCompleted && !isCurrent && 'text-text-secondary',
          !isCompleted && !isCurrent && 'text-text-muted'
        )}
      >
        {content}
      </div>
    )
  }

  // Render a hierarchy group (recursive)
  const renderGroup = (group: HierarchyGroup, depth: number) => {
    // Group is collapsed if:
    // 1. User explicitly collapsed it (in collapsedGroups), OR
    // 2. Auto-collapse (completed and not current) UNLESS user explicitly expanded it
    const autoCollapse = isGroupCompleted(group) && !groupContainsCurrent(group)
    const isGroupCollapsed = effectiveCollapsedGroups.has(group.id) ||
      (autoCollapse && !userExpandedGroups.has(group.id))
    const counts = getCompletedCount(group)

    return (
      <div key={group.id} className="mb-1">
        {/* Group Header */}
        <button
          onClick={() => toggleGroup(group.id)}
          className={clsx(
            'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors',
            'hover:bg-muted',
            isGroupCompleted(group) ? 'text-text-secondary' : 'text-text-primary'
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {/* Collapse/Expand Icon */}
          <svg
            className={clsx(
              'w-4 h-4 transition-transform flex-shrink-0',
              !isGroupCollapsed && 'rotate-90'
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          
          {/* Completion indicator */}
          {isGroupCompleted(group) ? (
            <svg className="w-4 h-4 text-success flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          ) : groupContainsCurrent(group) ? (
            <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0" />
          ) : (
            <span className="w-4 h-4 flex-shrink-0" />
          )}
          
          <span className="truncate">{group.label}</span>
          
          {/* Count badge */}
          <span className="ml-auto text-xs text-text-muted flex-shrink-0">
            {counts.completed}/{counts.total}
          </span>
        </button>
        
        {/* Group Contents */}
        {!isGroupCollapsed && (
          <div style={{ paddingLeft: `${(depth + 1) * 12}px` }}>
            {/* Render child groups first */}
            {group.children.map(child => renderGroup(child, depth + 1))}
            
            {/* Render tasks */}
            {group.tasks.map((task, index) => renderTaskItem(task, index))}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside
      className={clsx(
        'w-64 bg-surface border-r border-border p-4 flex flex-col',
        'hidden md:flex',
        isMobile && !isCollapsed && 'fixed inset-0 z-40 flex'
      )}
    >
      {isMobile && (
        <button
          onClick={() => setIsCollapsed(true)}
          className="absolute top-4 right-4 p-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Progress Bar Section - hidden when nav bar is at bottom */}
      {!hideProgressIndicator && (
        <div className="mb-6 pb-4 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text-primary">
              Step {progress.current + 1} of {progress.total}
            </span>
            <span className="text-sm font-semibold text-primary">
              {Math.round(progress.percentage)}%
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>
      )}

      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4 flex-shrink-0">
        Stages
      </h3>

      <nav className="space-y-1 flex-1 overflow-y-auto">
        {hierarchy.rootItems.length > 0 ? (
          <>
            {/* Render items in original order (groups and ungrouped tasks mixed) */}
            {hierarchy.rootItems.map((item, idx) => 
              item.kind === 'group' 
                ? renderGroup(item.group, 0)
                : renderTaskItem(item.task, item.index)
            )}
          </>
        ) : (
          // Flat rendering (no hierarchy)
          stages.map((stage, index) => renderTaskItem(stage as ExtendedStageConfig, index))
        )}
      </nav>
    </aside>
  )
}
