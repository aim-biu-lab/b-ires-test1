import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

interface SessionListItem {
  session_id: string
  experiment_id: string
  experiment_name: string | null
  user_id: string
  participant_number: number
  participant_label: string | null
  status: string
  current_stage_id: string
  current_stage_label: string | null
  completed_stages_count: number
  total_stages_count: number
  progress_percentage: number
  created_at: string
  updated_at: string
  completed_at: string | null
  metadata: Record<string, unknown> | null
}

interface SessionStats {
  total_sessions: number
  active_sessions: number
  completed_sessions: number
  abandoned_sessions: number
  completion_rate: number
  avg_completion_time_seconds: number | null
}

const REFRESH_INTERVAL = 10000 // 10 seconds

// Helper to get display name for participant
function getParticipantDisplay(session: SessionListItem): string {
  return session.participant_label || `P${session.participant_number}`
}

export default function SessionMonitorPage() {
  const [selectedExperiment, setSelectedExperiment] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [isAutoRefresh, setIsAutoRefresh] = useState(true)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState<string>('')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [showClearConfirmation, setShowClearConfirmation] = useState(false)
  const [confirmationInput, setConfirmationInput] = useState('')
  const [clearError, setClearError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  
  const queryClient = useQueryClient()

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Mutation for clearing all data
  const clearDataMutation = useMutation({
    mutationFn: async (confirmation: string) => {
      const response = await api.delete('/monitoring/data/all', {
        data: { confirmation },
      })
      return response.data
    },
    onSuccess: (data) => {
      // Invalidate all queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['activeSessions'] })
      queryClient.invalidateQueries({ queryKey: ['allSessions'] })
      queryClient.invalidateQueries({ queryKey: ['sessionStats'] })
      setShowClearConfirmation(false)
      setConfirmationInput('')
      setClearError(null)
      alert(`Successfully cleared: ${data.sessions_deleted} sessions, ${data.events_deleted} events`)
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      setClearError(error.response?.data?.detail || 'Failed to clear data')
    },
  })

  // Fetch experiments for filter dropdown
  const { data: experiments } = useQuery({
    queryKey: ['experiments'],
    queryFn: async () => {
      const response = await api.get('/experiments?limit=100')
      return response.data
    },
  })

  // Fetch active sessions
  const {
    data: activeSessions,
    isLoading: activeLoading,
    refetch: refetchActive,
  } = useQuery<SessionListItem[]>({
    queryKey: ['activeSessions', selectedExperiment],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedExperiment) params.append('experiment_id', selectedExperiment)
      const response = await api.get(`/monitoring/sessions/active?${params}`)
      return response.data
    },
    refetchInterval: isAutoRefresh ? REFRESH_INTERVAL : false,
  })

  // Fetch session stats
  const { data: stats, isLoading: statsLoading } = useQuery<SessionStats>({
    queryKey: ['sessionStats', selectedExperiment],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedExperiment) params.append('experiment_id', selectedExperiment)
      const response = await api.get(`/monitoring/sessions/stats?${params}`)
      return response.data
    },
    refetchInterval: isAutoRefresh ? REFRESH_INTERVAL : false,
  })

  // Fetch all sessions with filtering
  const {
    data: allSessions,
    isLoading: allLoading,
    refetch: refetchAll,
  } = useQuery({
    queryKey: ['allSessions', selectedExperiment, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedExperiment) params.append('experiment_id', selectedExperiment)
      if (statusFilter) params.append('status', statusFilter)
      params.append('page_size', '50')
      const response = await api.get(`/monitoring/sessions?${params}`)
      return response.data
    },
    refetchInterval: isAutoRefresh ? REFRESH_INTERVAL : false,
  })

  // Mutation for updating participant label
  const updateLabelMutation = useMutation({
    mutationFn: async ({ sessionId, label }: { sessionId: string; label: string }) => {
      const response = await api.patch(`/monitoring/sessions/${sessionId}/participant-label`, {
        participant_label: label || null,
      })
      return response.data
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['activeSessions'] })
      queryClient.invalidateQueries({ queryKey: ['allSessions'] })
      setEditingSessionId(null)
      setEditingLabel('')
    },
  })

  const handleStartEdit = (session: SessionListItem) => {
    setEditingSessionId(session.session_id)
    setEditingLabel(session.participant_label || '')
  }

  const handleSaveLabel = (sessionId: string) => {
    updateLabelMutation.mutate({ sessionId, label: editingLabel })
  }

  const handleCancelEdit = () => {
    setEditingSessionId(null)
    setEditingLabel('')
  }

  const handleRefresh = () => {
    refetchActive()
    refetchAll()
  }

  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return 'N/A'
    if (seconds < 60) return `${Math.round(seconds)}s`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`
    return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
  }

  const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return `${Math.floor(diffMins / 1440)}d ago`
  }

  const getStatusBadgeClass = (status: string): string => {
    switch (status) {
      case 'active':
        return 'badge-green'
      case 'completed':
        return 'badge-blue'
      case 'abandoned':
        return 'badge-red'
      default:
        return 'badge-gray'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Session Monitor</h1>
          <p className="text-gray-600 mt-1">
            Real-time view of participant sessions
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-refresh toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={isAutoRefresh}
              onChange={(e) => setIsAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Auto-refresh
          </label>

          <button
            onClick={handleRefresh}
            className="btn btn-secondary flex items-center gap-2"
          >
            <RefreshIcon className="w-4 h-4" />
            Refresh
          </button>

          {/* 3-dots menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="More options"
            >
              <DotsVerticalIcon className="w-5 h-5 text-gray-500" />
            </button>

            {isMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                <button
                  onClick={() => {
                    setIsMenuOpen(false)
                    setShowClearConfirmation(true)
                    setClearError(null)
                    setConfirmationInput('')
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <TrashIcon className="w-4 h-4" />
                  Clear All Data
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Clear All Data Confirmation Modal */}
      {showClearConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <WarningIcon className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Clear All Data</h3>
            </div>
            
            <p className="text-gray-600 mb-4">
              This will permanently delete <strong>all sessions and events</strong> from the database.
              This action cannot be undone.
            </p>
            
            <p className="text-sm text-gray-500 mb-2">
              Type <strong className="text-red-600">yes</strong> to confirm:
            </p>
            
            <input
              type="text"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder="Type 'yes' to confirm"
              className="input w-full mb-4"
              autoFocus
            />
            
            {clearError && (
              <p className="text-red-600 text-sm mb-4">{clearError}</p>
            )}
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowClearConfirmation(false)
                  setConfirmationInput('')
                  setClearError(null)
                }}
                className="btn btn-secondary"
                disabled={clearDataMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={() => clearDataMutation.mutate(confirmationInput)}
                className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                disabled={clearDataMutation.isPending}
              >
                {clearDataMutation.isPending ? 'Clearing...' : 'Clear All Data'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Sessions"
          value={stats?.total_sessions || 0}
          icon={UsersIcon}
          loading={statsLoading}
        />
        <StatCard
          title="Active Now"
          value={stats?.active_sessions || 0}
          icon={ActivityIcon}
          color="green"
          loading={statsLoading}
        />
        <StatCard
          title="Completion Rate"
          value={`${(stats?.completion_rate || 0).toFixed(1)}%`}
          icon={CheckIcon}
          color="blue"
          loading={statsLoading}
        />
        <StatCard
          title="Avg. Duration"
          value={formatDuration(stats?.avg_completion_time_seconds || null)}
          icon={ClockIcon}
          color="purple"
          loading={statsLoading}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <select
          value={selectedExperiment}
          onChange={(e) => setSelectedExperiment(e.target.value)}
          className="input w-64"
        >
          <option value="">All Experiments</option>
          {experiments?.map((exp: { experiment_id: string; name: string }) => (
            <option key={exp.experiment_id} value={exp.experiment_id}>
              {exp.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input w-40"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="abandoned">Abandoned</option>
        </select>
      </div>

      {/* Active Sessions (Real-time) */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            <h2 className="text-lg font-semibold text-gray-900">
              Active Sessions ({activeSessions?.length || 0})
            </h2>
          </div>
          <span className="text-xs text-gray-500">
            Updates every {REFRESH_INTERVAL / 1000}s
          </span>
        </div>

        {activeLoading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : activeSessions && activeSessions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Experiment</th>
                  <th>Current Stage</th>
                  <th>Progress</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {activeSessions.map((session) => (
                  <tr key={session.session_id} className="hover:bg-gray-50">
                    <td>
                      <div className="flex items-center gap-2">
                        {editingSessionId === session.session_id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editingLabel}
                              onChange={(e) => setEditingLabel(e.target.value)}
                              placeholder={`P${session.participant_number}`}
                              className="input w-24 text-sm py-1 px-2"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveLabel(session.session_id)
                                if (e.key === 'Escape') handleCancelEdit()
                              }}
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveLabel(session.session_id)}
                              className="text-green-600 hover:text-green-800 p-1"
                              title="Save"
                            >
                              <CheckSmallIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="text-red-600 hover:text-red-800 p-1"
                              title="Cancel"
                            >
                              <CloseIcon className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span
                              className="font-semibold text-primary-600 cursor-pointer hover:underline"
                              onClick={() => handleStartEdit(session)}
                              title="Click to edit label"
                            >
                              {getParticipantDisplay(session)}
                            </span>
                            <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
                              {session.session_id.slice(0, 6)}
                            </code>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="font-medium">
                      {session.experiment_name || session.experiment_id}
                    </td>
                    <td>
                      <span className="text-sm">
                        {session.current_stage_label || session.current_stage_id}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full transition-all duration-300"
                            style={{ width: `${session.progress_percentage}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">
                          {session.completed_stages_count}/{session.total_stages_count}
                        </span>
                      </div>
                    </td>
                    <td className="text-sm text-gray-500">
                      {formatTimeAgo(session.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            No active sessions at the moment
          </div>
        )}
      </div>

      {/* All Sessions */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            All Sessions ({allSessions?.total || 0})
          </h2>
        </div>

        {allLoading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : allSessions?.sessions && allSessions.sessions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Experiment</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Started</th>
                  <th>Last Update</th>
                </tr>
              </thead>
              <tbody>
                {allSessions.sessions.map((session: SessionListItem) => (
                  <tr key={session.session_id} className="hover:bg-gray-50">
                    <td>
                      <div className="flex items-center gap-2">
                        {editingSessionId === session.session_id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editingLabel}
                              onChange={(e) => setEditingLabel(e.target.value)}
                              placeholder={`P${session.participant_number}`}
                              className="input w-24 text-sm py-1 px-2"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveLabel(session.session_id)
                                if (e.key === 'Escape') handleCancelEdit()
                              }}
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveLabel(session.session_id)}
                              className="text-green-600 hover:text-green-800 p-1"
                              title="Save"
                            >
                              <CheckSmallIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="text-red-600 hover:text-red-800 p-1"
                              title="Cancel"
                            >
                              <CloseIcon className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span
                              className="font-semibold text-primary-600 cursor-pointer hover:underline"
                              onClick={() => handleStartEdit(session)}
                              title="Click to edit label"
                            >
                              {getParticipantDisplay(session)}
                            </span>
                            <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
                              {session.session_id.slice(0, 6)}
                            </code>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="font-medium">
                      {session.experiment_name || session.experiment_id}
                    </td>
                    <td>
                      <span className={`badge ${getStatusBadgeClass(session.status)}`}>
                        {session.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full"
                            style={{ width: `${session.progress_percentage}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">
                          {Math.round(session.progress_percentage)}%
                        </span>
                      </div>
                    </td>
                    <td className="text-sm text-gray-500">
                      {new Date(session.created_at).toLocaleDateString()}
                    </td>
                    <td className="text-sm text-gray-500">
                      {formatTimeAgo(session.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">No sessions found</div>
        )}
      </div>
    </div>
  )
}

// Stat Card Component
function StatCard({
  title,
  value,
  icon: Icon,
  color = 'gray',
  loading = false,
}: {
  title: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  color?: 'gray' | 'green' | 'blue' | 'purple'
  loading?: boolean
}) {
  const colorClasses = {
    gray: 'bg-gray-100 text-gray-600',
    green: 'bg-green-100 text-green-600',
    blue: 'bg-blue-100 text-blue-600',
    purple: 'bg-purple-100 text-purple-600',
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-4">
        <div
          className={`w-12 h-12 rounded-lg flex items-center justify-center ${colorClasses[color]}`}
        >
          <Icon className="w-6 h-6" />
        </div>
        <div>
          {loading ? (
            <div className="h-7 w-16 bg-gray-200 rounded animate-pulse" />
          ) : (
            <p className="text-2xl font-bold text-gray-900">{value}</p>
          )}
          <p className="text-sm text-gray-500">{title}</p>
        </div>
      </div>
    </div>
  )
}

// Icons
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  )
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  )
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function CheckSmallIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  )
}

function DotsVerticalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
      />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  )
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  )
}

