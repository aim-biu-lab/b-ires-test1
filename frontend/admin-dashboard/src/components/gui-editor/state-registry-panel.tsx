/**
 * State Registry Panel Component
 * 
 * Displays participant state registry for debugging:
 * - Session variables
 * - Assignment reasoning
 * - Distribution stats
 */

import React, { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import {
  InformationCircleIcon,
  ChartBarIcon,
  DocumentMagnifyingGlassIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline'

interface StateRegistryPanelProps {
  sessionId: string
  experimentId: string
}

interface StateRegistry {
  session_id: string
  experiment_id: string
  participant: Record<string, unknown>
  environment: Record<string, unknown>
  responses: Record<string, unknown>
  scores: Record<string, unknown>
  assignments: Record<string, unknown>
  metadata: Record<string, unknown>
}

interface AssignmentHistory {
  session_id: string
  experiment_id: string
  current_assignments: Record<string, string>
  history: AssignmentRecord[]
}

interface AssignmentRecord {
  level_id: string
  assigned_child_id: string
  ordering_mode: string
  reason: string
  timestamp: string
}

interface DistributionStats {
  experiment_id: string
  levels: Record<string, {
    children: Record<string, { started: number; completed: number; active: number }>
    totals: { started: number; completed: number; active: number }
  }>
  generated_at: string
}

type TabType = 'state' | 'assignments' | 'distribution'

export const StateRegistryPanel: React.FC<StateRegistryPanelProps> = ({
  sessionId,
  experimentId,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('state')
  const [stateRegistry, setStateRegistry] = useState<StateRegistry | null>(null)
  const [assignmentHistory, setAssignmentHistory] = useState<AssignmentHistory | null>(null)
  const [distribution, setDistribution] = useState<DistributionStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Fetch data based on active tab
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        if (activeTab === 'state' && sessionId) {
          const response = await api.get(`/monitoring/sessions/${sessionId}/state-registry`)
          setStateRegistry(response.data)
        } else if (activeTab === 'assignments' && sessionId) {
          const response = await api.get(`/monitoring/sessions/${sessionId}/assignment-history`)
          setAssignmentHistory(response.data)
        } else if (activeTab === 'distribution' && experimentId) {
          const response = await api.get(`/monitoring/experiments/${experimentId}/distribution`)
          setDistribution(response.data)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [activeTab, sessionId, experimentId])

  const copyToClipboard = (data: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const renderJsonTree = (data: unknown, depth = 0): React.ReactNode => {
    if (data === null || data === undefined) {
      return <span className="text-gray-400">null</span>
    }

    if (typeof data === 'boolean') {
      return <span className="text-purple-600">{data.toString()}</span>
    }

    if (typeof data === 'number') {
      return <span className="text-blue-600">{data}</span>
    }

    if (typeof data === 'string') {
      return <span className="text-green-600">"{data}"</span>
    }

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return <span className="text-gray-400">[]</span>
      }
      return (
        <div className="ml-4">
          {data.map((item, index) => (
            <div key={index} className="flex items-start">
              <span className="text-gray-400 mr-2">{index}:</span>
              {renderJsonTree(item, depth + 1)}
            </div>
          ))}
        </div>
      )
    }

    if (typeof data === 'object') {
      const entries = Object.entries(data as Record<string, unknown>)
      if (entries.length === 0) {
        return <span className="text-gray-400">{'{}'}</span>
      }
      return (
        <div className="ml-4">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-start">
              <span className="text-amber-600 font-medium mr-2">{key}:</span>
              {renderJsonTree(value, depth + 1)}
            </div>
          ))}
        </div>
      )
    }

    return <span className="text-gray-600">{String(data)}</span>
  }

  const tabs: { id: TabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'state', label: 'State Registry', icon: DocumentMagnifyingGlassIcon },
    { id: 'assignments', label: 'Assignments', icon: InformationCircleIcon },
    { id: 'distribution', label: 'Distribution', icon: ChartBarIcon },
  ]

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
      {/* Header with tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Debug Panel
          </h3>
          <button
            onClick={() => setActiveTab(activeTab)}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title="Refresh"
          >
            <ArrowPathIcon className={`w-5 h-5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex px-4">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors
                  ${activeTab === tab.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-h-[600px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <ArrowPathIcon className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-500">
            <p className="font-medium">Error loading data</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        ) : (
          <>
            {/* State Registry Tab */}
            {activeTab === 'state' && stateRegistry && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    Session: <span className="font-mono">{stateRegistry.session_id}</span>
                  </p>
                  <button
                    onClick={() => copyToClipboard(stateRegistry)}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    {copied ? <CheckIcon className="w-3 h-3 text-green-500" /> : <ClipboardDocumentIcon className="w-3 h-3" />}
                    {copied ? 'Copied!' : 'Copy JSON'}
                  </button>
                </div>

                {/* Sections */}
                {[
                  { title: 'Participant', data: stateRegistry.participant },
                  { title: 'Environment', data: stateRegistry.environment },
                  { title: 'Responses', data: stateRegistry.responses },
                  { title: 'Scores', data: stateRegistry.scores },
                  { title: 'Assignments', data: stateRegistry.assignments },
                  { title: 'Metadata', data: stateRegistry.metadata },
                ].map((section) => (
                  <div key={section.title} className="border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                      <h4 className="font-medium text-gray-900 dark:text-gray-100">{section.title}</h4>
                    </div>
                    <div className="p-3 text-sm font-mono">
                      {renderJsonTree(section.data)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Assignments Tab */}
            {activeTab === 'assignments' && assignmentHistory && (
              <div className="space-y-4">
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
                  <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                    <h4 className="font-medium text-gray-900 dark:text-gray-100">Current Assignments</h4>
                  </div>
                  <div className="p-3">
                    {Object.keys(assignmentHistory.current_assignments).length === 0 ? (
                      <p className="text-sm text-gray-500">No assignments yet</p>
                    ) : (
                      <div className="space-y-2">
                        {Object.entries(assignmentHistory.current_assignments).map(([levelId, childId]) => (
                          <div key={levelId} className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 rounded px-3 py-2">
                            <span className="font-medium text-blue-700 dark:text-blue-300">{levelId}</span>
                            <span className="font-mono text-sm">{childId}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
                  <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                    <h4 className="font-medium text-gray-900 dark:text-gray-100">Assignment History</h4>
                  </div>
                  <div className="p-3">
                    {assignmentHistory.history.length === 0 ? (
                      <p className="text-sm text-gray-500">No assignment history</p>
                    ) : (
                      <div className="space-y-3">
                        {assignmentHistory.history.map((record, index) => (
                          <div key={index} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium">{record.level_id}</span>
                              <span className="text-xs text-gray-500">
                                {record.ordering_mode}
                              </span>
                            </div>
                            <div className="text-sm">
                              <span className="text-gray-500">Assigned: </span>
                              <span className="font-mono text-green-600">{record.assigned_child_id}</span>
                            </div>
                            {record.reason && (
                              <p className="mt-2 text-xs text-gray-500 bg-gray-50 dark:bg-gray-700/50 rounded p-2">
                                {record.reason}
                              </p>
                            )}
                            {record.timestamp && (
                              <p className="mt-1 text-xs text-gray-400">
                                {new Date(record.timestamp).toLocaleString()}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Distribution Tab */}
            {activeTab === 'distribution' && distribution && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    Experiment: <span className="font-mono">{distribution.experiment_id}</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    Generated: {new Date(distribution.generated_at).toLocaleString()}
                  </p>
                </div>

                {Object.keys(distribution.levels).length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <ChartBarIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No distribution data</p>
                    <p className="text-sm">Balanced/weighted levels will appear here</p>
                  </div>
                ) : (
                  Object.entries(distribution.levels).map(([levelId, levelData]) => (
                    <div key={levelId} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                        <h4 className="font-medium text-gray-900 dark:text-gray-100">{levelId}</h4>
                        <p className="text-xs text-gray-500 mt-1">
                          Total: {levelData.totals.started} started, {levelData.totals.completed} completed, {levelData.totals.active} active
                        </p>
                      </div>
                      <div className="p-3">
                        <div className="space-y-2">
                          {Object.entries(levelData.children).map(([childId, stats]) => {
                            const totalStarted = levelData.totals.started || 1
                            const percentage = Math.round((stats.started / totalStarted) * 100)
                            return (
                              <div key={childId}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-medium">{childId}</span>
                                  <span className="text-xs text-gray-500">
                                    {stats.started} started / {stats.completed} completed
                                  </span>
                                </div>
                                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-blue-500 rounded-full"
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                                <p className="text-xs text-gray-400 mt-0.5 text-right">{percentage}%</p>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default StateRegistryPanel


