/**
 * Distribution Dashboard Component
 * 
 * Real-time visualization of balanced/weighted distribution across experiment levels.
 * Shows:
 * - Bar charts for distribution per level
 * - Target quota indicators
 * - Active participant counts
 * - Historical distribution trends
 */

import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import {
  ChartBarIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  UserGroupIcon,
  ClockIcon,
  PlayIcon,
  StopIcon,
} from '@heroicons/react/24/outline'

interface DistributionDashboardProps {
  experimentId: string
  /** Auto-refresh interval in ms (0 = disabled) */
  refreshInterval?: number
}

interface ChildStats {
  started: number
  completed: number
  active: number
}

interface LevelStats {
  children: Record<string, ChildStats>
  totals: {
    started: number
    completed: number
    active: number
  }
}

interface DistributionData {
  experiment_id: string
  levels: Record<string, LevelStats>
  generated_at: string
}

// Colors for the distribution bars
const DISTRIBUTION_COLORS = [
  { bg: 'bg-blue-500', text: 'text-blue-700', light: 'bg-blue-100' },
  { bg: 'bg-emerald-500', text: 'text-emerald-700', light: 'bg-emerald-100' },
  { bg: 'bg-violet-500', text: 'text-violet-700', light: 'bg-violet-100' },
  { bg: 'bg-amber-500', text: 'text-amber-700', light: 'bg-amber-100' },
  { bg: 'bg-rose-500', text: 'text-rose-700', light: 'bg-rose-100' },
  { bg: 'bg-cyan-500', text: 'text-cyan-700', light: 'bg-cyan-100' },
  { bg: 'bg-fuchsia-500', text: 'text-fuchsia-700', light: 'bg-fuchsia-100' },
  { bg: 'bg-lime-500', text: 'text-lime-700', light: 'bg-lime-100' },
]

// Get color by index (cycles through colors)
const getColor = (index: number) => DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length]

export const DistributionDashboard: React.FC<DistributionDashboardProps> = ({
  experimentId,
  refreshInterval = 30000, // 30 seconds default
}) => {
  const [data, setData] = useState<DistributionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isAutoRefresh, setIsAutoRefresh] = useState(refreshInterval > 0)

  // Fetch distribution data
  const fetchData = useCallback(async () => {
    try {
      setError(null)
      const response = await api.get(`/monitoring/experiments/${experimentId}/distribution`)
      setData(response.data)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch distribution data')
    } finally {
      setLoading(false)
    }
  }, [experimentId])

  // Initial fetch
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-refresh
  useEffect(() => {
    if (!isAutoRefresh || refreshInterval <= 0) return

    const interval = setInterval(fetchData, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchData, refreshInterval, isAutoRefresh])

  // Reset counters
  const resetCounters = async (levelId?: string) => {
    const confirmed = window.confirm(
      levelId
        ? `Reset counters for level "${levelId}"? This cannot be undone.`
        : 'Reset ALL distribution counters for this experiment? This cannot be undone.'
    )
    if (!confirmed) return

    try {
      const url = levelId
        ? `/monitoring/experiments/${experimentId}/reset-counters?level_id=${levelId}`
        : `/monitoring/experiments/${experimentId}/reset-counters`
      await api.post(url)
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset counters')
    }
  }

  // Calculate balance status
  const getBalanceStatus = (levelStats: LevelStats) => {
    const counts = Object.values(levelStats.children).map(c => c.started)
    if (counts.length < 2) return { status: 'neutral', message: 'Single item' }

    const max = Math.max(...counts)
    const min = Math.min(...counts)
    const diff = max - min

    if (diff === 0) return { status: 'perfect', message: 'Perfectly balanced' }
    if (diff <= 2) return { status: 'good', message: 'Well balanced' }
    if (diff <= 5) return { status: 'fair', message: 'Minor imbalance' }
    return { status: 'poor', message: 'Significant imbalance' }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'perfect':
      case 'good':
        return <CheckCircleIcon className="w-5 h-5 text-emerald-500" />
      case 'fair':
        return <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
      case 'poor':
        return <ExclamationTriangleIcon className="w-5 h-5 text-rose-500" />
      default:
        return null
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <ArrowPathIcon className="w-8 h-8 text-gray-400 animate-spin" />
        <span className="ml-2 text-gray-500">Loading distribution data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-red-700">
          <ExclamationTriangleIcon className="w-5 h-5" />
          <span className="font-medium">Error loading distribution</span>
        </div>
        <p className="mt-1 text-sm text-red-600">{error}</p>
        <button
          onClick={fetchData}
          className="mt-3 px-3 py-1 text-sm bg-red-100 hover:bg-red-200 rounded"
        >
          Try Again
        </button>
      </div>
    )
  }

  const levels = data?.levels || {}
  const hasData = Object.keys(levels).length > 0

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <ChartBarIcon className="w-6 h-6 text-blue-500" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Distribution Dashboard
            </h3>
            <p className="text-sm text-gray-500">
              Real-time balanced/weighted distribution
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setIsAutoRefresh(!isAutoRefresh)}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
              isAutoRefresh
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-100 text-gray-600'
            }`}
            title={isAutoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          >
            {isAutoRefresh ? (
              <PlayIcon className="w-3 h-3" />
            ) : (
              <StopIcon className="w-3 h-3" />
            )}
            Auto
          </button>

          {/* Manual refresh */}
          <button
            onClick={fetchData}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title="Refresh now"
          >
            <ArrowPathIcon className={`w-5 h-5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Reset all counters */}
          {hasData && (
            <button
              onClick={() => resetCounters()}
              className="px-2 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded"
              title="Reset all counters"
            >
              Reset All
            </button>
          )}
        </div>
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 flex items-center gap-1">
          <ClockIcon className="w-3 h-3" />
          Last updated: {lastUpdated.toLocaleTimeString()}
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {!hasData ? (
          <div className="text-center py-12 text-gray-500">
            <ChartBarIcon className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No Distribution Data</p>
            <p className="text-sm mt-1">
              Distribution data appears when balanced or weighted<br />
              ordering modes are used and participants start the experiment.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                  <UserGroupIcon className="w-5 h-5" />
                  <span className="text-sm font-medium">Total Started</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-blue-800 dark:text-blue-200">
                  {Object.values(levels).reduce((sum, l) => sum + l.totals.started, 0)}
                </p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                  <CheckCircleIcon className="w-5 h-5" />
                  <span className="text-sm font-medium">Total Completed</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-emerald-800 dark:text-emerald-200">
                  {Object.values(levels).reduce((sum, l) => sum + l.totals.completed, 0)}
                </p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                  <PlayIcon className="w-5 h-5" />
                  <span className="text-sm font-medium">Active Now</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-amber-800 dark:text-amber-200">
                  {Object.values(levels).reduce((sum, l) => sum + l.totals.active, 0)}
                </p>
              </div>
            </div>

            {/* Per-Level Distribution */}
            {Object.entries(levels).map(([levelId, levelStats]) => {
              const balanceStatus = getBalanceStatus(levelStats)
              const childEntries = Object.entries(levelStats.children)
              const maxCount = Math.max(...childEntries.map(([, stats]) => stats.started), 1)

              return (
                <div
                  key={levelId}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                >
                  {/* Level Header */}
                  <div className="bg-gray-50 dark:bg-gray-700/50 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h4 className="font-semibold text-gray-900 dark:text-gray-100">
                        {levelId}
                      </h4>
                      <div className="flex items-center gap-1">
                        {getStatusIcon(balanceStatus.status)}
                        <span className={`text-xs ${
                          balanceStatus.status === 'perfect' || balanceStatus.status === 'good'
                            ? 'text-emerald-600'
                            : balanceStatus.status === 'fair'
                            ? 'text-amber-600'
                            : 'text-rose-600'
                        }`}>
                          {balanceStatus.message}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span>
                        Started: <strong>{levelStats.totals.started}</strong>
                      </span>
                      <span>
                        Completed: <strong>{levelStats.totals.completed}</strong>
                      </span>
                      <span>
                        Active: <strong>{levelStats.totals.active}</strong>
                      </span>
                      <button
                        onClick={() => resetCounters(levelId)}
                        className="px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 rounded"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  {/* Distribution Bars */}
                  <div className="p-4 space-y-3">
                    {childEntries.map(([childId, stats], index) => {
                      const color = getColor(index)
                      const percentage = levelStats.totals.started > 0
                        ? Math.round((stats.started / levelStats.totals.started) * 100)
                        : 0
                      const barWidth = maxCount > 0
                        ? Math.round((stats.started / maxCount) * 100)
                        : 0
                      const idealPercentage = Math.round(100 / childEntries.length)
                      const deviation = percentage - idealPercentage

                      return (
                        <div key={childId} className="space-y-1">
                          {/* Label row */}
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className={`w-3 h-3 rounded ${color.bg}`} />
                              <span className="font-medium text-gray-700 dark:text-gray-300">
                                {childId}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-gray-500">
                              <span className="font-mono">
                                {stats.started} started
                              </span>
                              <span className="font-mono text-xs">
                                {stats.completed} completed
                              </span>
                              {stats.active > 0 && (
                                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                                  {stats.active} active
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${color.bg} rounded-full transition-all duration-500 flex items-center justify-end px-2`}
                                style={{ width: `${Math.max(barWidth, 2)}%` }}
                              >
                                {barWidth > 15 && (
                                  <span className="text-xs text-white font-medium">
                                    {percentage}%
                                  </span>
                                )}
                              </div>
                            </div>
                            {barWidth <= 15 && (
                              <span className={`text-xs font-medium ${color.text}`}>
                                {percentage}%
                              </span>
                            )}
                          </div>

                          {/* Deviation indicator */}
                          <div className="flex items-center justify-between text-xs text-gray-400">
                            <span>Target: ~{idealPercentage}%</span>
                            <span className={
                              Math.abs(deviation) <= 5 ? 'text-emerald-500' :
                              Math.abs(deviation) <= 10 ? 'text-amber-500' :
                              'text-rose-500'
                            }>
                              {deviation > 0 ? '+' : ''}{deviation}% from target
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default DistributionDashboard


