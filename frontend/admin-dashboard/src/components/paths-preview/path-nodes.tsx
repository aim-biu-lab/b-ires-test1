/**
 * Path Node Components
 * 
 * Custom node components for visualizing experiment hierarchy.
 */

import React from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  ArrowsRightLeftIcon,
  CubeIcon,
  DocumentTextIcon,
  FolderIcon,
  Squares2X2Icon,
  AdjustmentsHorizontalIcon,
  ArrowPathRoundedSquareIcon,
  ScaleIcon,
  TableCellsIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'

interface PathTreeNode {
  id: string
  type: 'root' | 'phase' | 'stage' | 'block' | 'task' | 'pickGroup' | 'orderGroup'
  label: string
  children?: PathTreeNode[]
  rules?: {
    ordering?: string
    pickCount?: number
    pickStrategy?: string
    pickConditions?: Array<{ variable: string; operator: string }>
    visibility?: string
    quota?: number
  }
  visibility?: string
  isConditional?: boolean
  stageType?: string
  pickAssigns?: Record<string, string>
  branchType?: 'pick' | 'ordering'
  pickCount?: number
  pickStrategy?: string
  totalCandidates?: number
  candidates?: string[]
  pickConditions?: Array<{ variable: string; operator: string }>
  ordering?: string
}

interface PathNodeProps {
  node: PathTreeNode
  expandedNodes: Set<string>
  onToggle: (nodeId: string) => void
  depth: number
}

const NODE_STYLES: Record<string, { bg: string; border: string; icon: React.ReactNode }> = {
  root: {
    bg: 'bg-gray-100 dark:bg-gray-800',
    border: 'border-gray-300 dark:border-gray-600',
    icon: <FolderIcon className="w-4 h-4" />,
  },
  phase: {
    bg: 'bg-indigo-50 dark:bg-indigo-900/30',
    border: 'border-indigo-300 dark:border-indigo-600',
    icon: <Squares2X2Icon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />,
  },
  stage: {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    border: 'border-blue-300 dark:border-blue-600',
    icon: <CubeIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />,
  },
  block: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    border: 'border-emerald-300 dark:border-emerald-600',
    icon: <DocumentTextIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
  },
  task: {
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    border: 'border-amber-300 dark:border-amber-600',
    icon: <DocumentTextIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
  },
  pickGroup: {
    bg: 'bg-violet-50 dark:bg-violet-900/20',
    border: 'border-violet-400 dark:border-violet-500 border-dashed',
    icon: <FunnelIcon className="w-4 h-4 text-violet-600 dark:text-violet-400" />,
  },
  orderGroup: {
    bg: 'bg-cyan-50 dark:bg-cyan-900/20',
    border: 'border-cyan-400 dark:border-cyan-500 border-dashed',
    icon: <ArrowPathRoundedSquareIcon className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />,
  },
}

function getOrderingIcon(ordering: string) {
  switch (ordering) {
    case 'randomized':
      return <ArrowPathRoundedSquareIcon className="w-3 h-3" />
    case 'balanced':
      return <ScaleIcon className="w-3 h-3" />
    case 'weighted':
      return <AdjustmentsHorizontalIcon className="w-3 h-3" />
    case 'latin_square':
      return <TableCellsIcon className="w-3 h-3" />
    default:
      return <ArrowsRightLeftIcon className="w-3 h-3" />
  }
}

function Badge({ 
  children, 
  variant = 'default' 
}: { 
  children: React.ReactNode
  variant?: 'default' | 'pick' | 'order' | 'visibility' | 'condition'
}) {
  const variants = {
    default: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    pick: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
    order: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300',
    visibility: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300',
    condition: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  }

  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded font-medium',
      variants[variant]
    )}>
      {children}
    </span>
  )
}

export function PathNode({ node, expandedNodes, onToggle, depth }: PathNodeProps) {
  const hasChildren = node.children && node.children.length > 0
  const isExpanded = expandedNodes.has(node.id)
  const style = NODE_STYLES[node.type] || NODE_STYLES.task

  return (
    <div className="select-none">
      {/* Node Header */}
      <div
        className={clsx(
          'flex items-start gap-2 p-2 rounded-lg border mb-1 cursor-pointer hover:shadow-sm transition-shadow',
          style.bg,
          style.border,
          node.isConditional && 'border-dashed'
        )}
        onClick={() => hasChildren && onToggle(node.id)}
        style={{ marginLeft: depth * 24 }}
      >
        {/* Expand/Collapse Toggle */}
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDownIcon className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-gray-500" />
            )
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
          )}
        </div>

        {/* Node Icon */}
        <div className="flex-shrink-0 mt-0.5">
          {style.icon}
        </div>

        {/* Node Content */}
        <div className="flex-1 min-w-0">
          {/* Label and Type */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {node.label}
            </span>
            
            {node.type === 'task' && node.stageType && (
              <Badge>{node.stageType}</Badge>
            )}
            
            {/* Pick Group Badge */}
            {node.type === 'pickGroup' && (
              <Badge variant="pick">
                <FunnelIcon className="w-3 h-3" />
                Pick {node.pickCount} of {node.totalCandidates}
                {node.pickStrategy && node.pickStrategy !== 'random' && (
                  <span className="ml-1">({node.pickStrategy})</span>
                )}
              </Badge>
            )}
            
            {/* Order Group Badge */}
            {node.type === 'orderGroup' && (
              <Badge variant="order">
                {getOrderingIcon(node.ordering || '')}
                {node.ordering === 'randomized' && 'Random Order'}
                {node.ordering === 'balanced' && 'Balanced'}
                {node.ordering === 'weighted' && 'Weighted'}
                {node.ordering === 'latin_square' && 'Latin Square'}
              </Badge>
            )}
          </div>

          {/* Rules/Annotations */}
          <div className="flex flex-wrap gap-1.5 mt-1">
            {/* Visibility Rule */}
            {node.visibility && (
              <Badge variant="visibility">
                <EyeIcon className="w-3 h-3" />
                {node.visibility.length > 30 
                  ? node.visibility.substring(0, 30) + '...'
                  : node.visibility
                }
              </Badge>
            )}
            
            {/* Pick Conditions */}
            {node.pickConditions && node.pickConditions.length > 0 && (
              <Badge variant="condition">
                <FunnelIcon className="w-3 h-3" />
                {node.pickConditions.map((c, i) => (
                  <span key={i}>
                    {c.variable} {c.operator === 'not_in' || c.operator === '!=' ? '≠' : '='} prev
                    {i < node.pickConditions!.length - 1 && ', '}
                  </span>
                ))}
              </Badge>
            )}
            
            {/* Rules from parent */}
            {node.rules?.ordering && node.rules.ordering !== 'sequential' && (
              <Badge variant="order">
                {getOrderingIcon(node.rules.ordering)}
                {node.rules.ordering}
              </Badge>
            )}
            
            {node.rules?.pickCount && (
              <Badge variant="pick">
                <FunnelIcon className="w-3 h-3" />
                Pick {node.rules.pickCount}
                {node.rules.pickStrategy && ` (${node.rules.pickStrategy})`}
              </Badge>
            )}
            
            {node.rules?.visibility && (
              <Badge variant="visibility">
                <EyeIcon className="w-3 h-3" />
                Conditional
              </Badge>
            )}
            
            {node.rules?.quota && (
              <Badge>
                Quota: {node.rules.quota}
              </Badge>
            )}
            
            {/* Pick Assigns */}
            {node.pickAssigns && Object.keys(node.pickAssigns).length > 0 && (
              <Badge variant="default">
                Sets: {Object.entries(node.pickAssigns).map(([k, v]) => `${k}=${v}`).join(', ')}
              </Badge>
            )}
          </div>
        </div>

        {/* Children count */}
        {hasChildren && (
          <div className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
            {node.children?.length} {node.children?.length === 1 ? 'child' : 'children'}
          </div>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="relative">
          {/* Connecting line */}
          <div 
            className="absolute left-0 top-0 bottom-4 w-px bg-gray-300 dark:bg-gray-600"
            style={{ marginLeft: depth * 24 + 12 }}
          />
          
          {node.children?.map((child) => (
            <PathNode
              key={child.id}
              node={child}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default PathNode

