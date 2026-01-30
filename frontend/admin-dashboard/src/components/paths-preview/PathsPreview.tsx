/**
 * Paths Preview Component
 * 
 * Visualizes all possible paths through an experiment as a flowchart.
 * Shows pick groups, ordering, visibility conditions, and more.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import { PathNode } from './path-nodes'
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  MapIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
} from '@heroicons/react/24/outline'

interface PathsPreviewProps {
  experimentId: string
  config?: Record<string, unknown>
}

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

interface PathsResponse {
  experiment_id: string
  title: string
  pathTree: PathTreeNode
}

export function PathsPreview({ experimentId, config }: PathsPreviewProps) {
  const [pathTree, setPathTree] = useState<PathTreeNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [allExpanded, setAllExpanded] = useState(true)

  const fetchPaths = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await api.get<PathsResponse>(`/experiments/${experimentId}/paths`)
      setPathTree(response.data.pathTree)
      
      // Initially expand all nodes
      const allIds = collectAllNodeIds(response.data.pathTree)
      setExpandedNodes(new Set(allIds))
      setAllExpanded(true)
    } catch (err) {
      console.error('Failed to fetch paths:', err)
      setError('Failed to load experiment paths')
    } finally {
      setLoading(false)
    }
  }, [experimentId])

  useEffect(() => {
    fetchPaths()
  }, [fetchPaths, config])

  const collectAllNodeIds = (node: PathTreeNode): string[] => {
    const ids = [node.id]
    if (node.children) {
      for (const child of node.children) {
        ids.push(...collectAllNodeIds(child))
      }
    }
    return ids
  }

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedNodes(new Set())
      setAllExpanded(false)
    } else {
      if (pathTree) {
        const allIds = collectAllNodeIds(pathTree)
        setExpandedNodes(new Set(allIds))
      }
      setAllExpanded(true)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <ArrowPathIcon className="w-8 h-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Analyzing paths...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-500">
        <ExclamationTriangleIcon className="w-12 h-12 mb-2" />
        <p>{error}</p>
        <button
          onClick={fetchPaths}
          className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!pathTree) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <MapIcon className="w-12 h-12 mb-2" />
        <p>No paths to display</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <MapIcon className="w-5 h-5 text-gray-500" />
          <span className="font-medium text-gray-700 dark:text-gray-300">
            Experiment Flow
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAll}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
          >
            {allExpanded ? (
              <>
                <ArrowsPointingInIcon className="w-4 h-4" />
                Collapse All
              </>
            ) : (
              <>
                <ArrowsPointingOutIcon className="w-4 h-4" />
                Expand All
              </>
            )}
          </button>
          
          <button
            onClick={fetchPaths}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-indigo-500" />
            <span className="text-gray-600 dark:text-gray-400">Phase</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-blue-500" />
            <span className="text-gray-600 dark:text-gray-400">Stage</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-500" />
            <span className="text-gray-600 dark:text-gray-400">Block</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-500" />
            <span className="text-gray-600 dark:text-gray-400">Task</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border-2 border-dashed border-violet-500" />
            <span className="text-gray-600 dark:text-gray-400">Pick Group</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border-2 border-dashed border-cyan-500" />
            <span className="text-gray-600 dark:text-gray-400">Random/Order Group</span>
          </div>
        </div>
      </div>

      {/* Tree View */}
      <div className="flex-1 overflow-auto p-4">
        <div className="min-w-fit">
          <PathNode
            node={pathTree}
            expandedNodes={expandedNodes}
            onToggle={toggleNode}
            depth={0}
          />
        </div>
      </div>
    </div>
  )
}

export default PathsPreview

