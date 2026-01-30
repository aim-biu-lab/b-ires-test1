import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

// Types
interface LiveEvent {
  event_id: string
  session_id: string
  user_id: string
  participant_number: number
  participant_label: string | null
  event_type: string
  stage_id: string
  block_id: string | null
  payload: Record<string, unknown>
  client_timestamp: string
  server_timestamp: string
}

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

interface BlockStatistics {
  block_id: string
  block_type: string
  response_count: number
  min_value: number | null
  max_value: number | null
  avg_value: number | null
  median_value: number | null
  value_distribution: Record<string, number> | null
}

interface StageStatistics {
  stage_id: string
  stage_label: string | null
  view_count: number
  completion_count: number
  avg_time_seconds: number | null
  blocks: BlockStatistics[]
}

interface ExperimentLiveStats {
  experiment_id: string
  experiment_name: string
  total_sessions: number
  active_sessions: number
  completed_sessions: number
  abandoned_sessions: number
  completion_rate: number
  stages: StageStatistics[]
  updated_at: string
}

interface Experiment {
  experiment_id: string
  name: string
}

// Polling interval in ms
const POLL_INTERVAL = 3000

// Time range options in minutes
const TIME_RANGES = [
  { label: 'Last minute', value: 1 },
  { label: 'Last 10 minutes', value: 10 },
  { label: 'Last hour', value: 60 },
  { label: 'Last 6 hours', value: 360 },
  { label: 'Last day', value: 1440 },
  { label: 'All time', value: 0 },
]

// Helper to get display name for participant
function getParticipantDisplay(item: { participant_number: number; participant_label: string | null }): string {
  return item.participant_label || `P${item.participant_number}`
}

type ViewMode = 'events' | 'participants' | 'statistics'
type StatusFilter = 'all' | 'active' | 'completed' | 'abandoned'

// Known event types for categorization
const EVENT_TYPE_CATEGORIES: Record<string, { label: string; color: string; bgColor: string }> = {
  // Session events
  session_start: { label: 'Session Start', color: 'text-violet-600', bgColor: 'bg-violet-50' },
  session_end: { label: 'Session Complete', color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
  // Stage events
  stage_view: { label: 'Stage View', color: 'text-sky-600', bgColor: 'bg-sky-50' },
  stage_submit: { label: 'Stage Submit', color: 'text-sky-600', bgColor: 'bg-sky-50' },
  stage_skip: { label: 'Stage Skip', color: 'text-slate-600', bgColor: 'bg-slate-50' },
  // Video events
  video_play: { label: 'Video Play', color: 'text-amber-600', bgColor: 'bg-amber-50' },
  video_pause: { label: 'Video Pause', color: 'text-amber-600', bgColor: 'bg-amber-50' },
  video_ended: { label: 'Video Ended', color: 'text-amber-600', bgColor: 'bg-amber-50' },
  video_progress: { label: 'Video Progress', color: 'text-amber-600', bgColor: 'bg-amber-50' },
  // Multiple choice events
  multiple_choice_submit: { label: 'MC Submit', color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
  multiple_choice_select: { label: 'MC Select', color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
  // Attention check events
  attention_check_passed: { label: 'Attn Passed', color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
  attention_check_failed: { label: 'Attn Failed', color: 'text-red-600', bgColor: 'bg-red-50' },
  // Error/system events
  error: { label: 'Error', color: 'text-rose-600', bgColor: 'bg-rose-50' },
}

export default function LivePreviewPage() {
  const [selectedExperiment, setSelectedExperiment] = useState<string>('')
  const [selectedSession, setSelectedSession] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [timeRange, setTimeRange] = useState<number>(60) // Default: last hour
  const [viewMode, setViewMode] = useState<ViewMode>('participants')
  const [isPolling, setIsPolling] = useState(true)
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [isLoadingEvents, setIsLoadingEvents] = useState(false)
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())
  const [hiddenEventTypes, setHiddenEventTypes] = useState<Set<string>>(new Set())
  const [showEventTypeFilter, setShowEventTypeFilter] = useState(false)
  const lastTimestampRef = useRef<string | null>(null)
  const eventsContainerRef = useRef<HTMLDivElement>(null)
  const initialFetchDoneRef = useRef(false)

  // Extract unique event types from current events
  const uniqueEventTypes = useMemo(() => {
    const types = new Set<string>()
    events.forEach(e => types.add(e.event_type))
    return Array.from(types).sort()
  }, [events])

  // Filter events based on hidden types
  const filteredEvents = useMemo(() => {
    if (hiddenEventTypes.size === 0) return events
    return events.filter(e => !hiddenEventTypes.has(e.event_type))
  }, [events, hiddenEventTypes])

  // Toggle event type visibility
  const toggleEventType = useCallback((eventType: string) => {
    setHiddenEventTypes(prev => {
      const newSet = new Set(prev)
      if (newSet.has(eventType)) {
        newSet.delete(eventType)
      } else {
        newSet.add(eventType)
      }
      return newSet
    })
  }, [])

  // Show all event types
  const showAllEventTypes = useCallback(() => {
    setHiddenEventTypes(new Set())
  }, [])

  // Hide all event types
  const hideAllEventTypes = useCallback(() => {
    setHiddenEventTypes(new Set(uniqueEventTypes))
  }, [uniqueEventTypes])

  // Fetch experiments for filter dropdown
  const { data: experiments } = useQuery<Experiment[]>({
    queryKey: ['experiments'],
    queryFn: async () => {
      const response = await api.get('/experiments?limit=100')
      return response.data
    },
  })

  // Fetch live sessions
  const { data: sessions, refetch: refetchSessions } = useQuery<SessionListItem[]>({
    queryKey: ['liveSessions', selectedExperiment, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedExperiment) params.append('experiment_id', selectedExperiment)
      if (statusFilter !== 'all') params.append('status', statusFilter)
      params.append('limit', '100')
      const response = await api.get(`/monitoring/live/sessions?${params}`)
      return response.data
    },
    refetchInterval: isPolling ? POLL_INTERVAL : false,
  })

  // Fetch live statistics for selected experiment
  const { data: stats, refetch: refetchStats, error: statsError, isLoading: statsLoading } = useQuery<ExperimentLiveStats | null>({
    queryKey: ['liveStats', selectedExperiment],
    queryFn: async () => {
      if (!selectedExperiment) return null
      const response = await api.get(`/monitoring/live/stats/${selectedExperiment}`)
      return response.data
    },
    enabled: !!selectedExperiment,
    refetchInterval: isPolling ? POLL_INTERVAL : false,
  })
  
  // Log stats error if any
  if (statsError) {
    console.error('Stats error:', statsError)
  }

  // Calculate the "since" timestamp based on time range
  const getSinceTimestamp = useCallback((minutes: number): string | null => {
    if (minutes === 0) return null // All time
    const since = new Date(Date.now() - minutes * 60 * 1000)
    return since.toISOString()
  }, [])

  // Fetch events - can be called for initial load or polling
  const fetchEvents = useCallback(async (isInitial: boolean = false) => {
    try {
      setIsLoadingEvents(true)
      const params = new URLSearchParams()
      if (selectedExperiment) params.append('experiment_id', selectedExperiment)
      if (selectedSession) params.append('session_id', selectedSession)
      if (statusFilter !== 'all') params.append('status', statusFilter)
      
      // For initial fetch, use time range; for polling, use last timestamp
      if (isInitial) {
        const since = getSinceTimestamp(timeRange)
        if (since) params.append('since', since)
        params.append('limit', '200')
      } else if (lastTimestampRef.current) {
        params.append('since', lastTimestampRef.current)
        params.append('limit', '50')
      } else {
        // No last timestamp, fetch recent based on time range
        const since = getSinceTimestamp(timeRange)
        if (since) params.append('since', since)
        params.append('limit', '200')
      }

      const response = await api.get(`/monitoring/live/events?${params}`)
      const newEvents: LiveEvent[] = response.data.events || []

      if (isInitial) {
        // Replace all events
        setEvents(newEvents)
        if (response.data.last_timestamp) {
          lastTimestampRef.current = response.data.last_timestamp
        }
      } else if (newEvents.length > 0) {
        // Append new events
        setEvents(prev => {
          // Deduplicate by event_id
          const existingIds = new Set(prev.map(e => e.event_id))
          const uniqueNew = newEvents.filter(e => !existingIds.has(e.event_id))
          const combined = [...prev, ...uniqueNew]
          // Keep only last 500 events
          return combined.slice(-500)
        })
        if (response.data.last_timestamp) {
          lastTimestampRef.current = response.data.last_timestamp
        }
      }
    } catch (error) {
      console.error('Failed to fetch events:', error)
    } finally {
      setIsLoadingEvents(false)
    }
  }, [selectedExperiment, selectedSession, statusFilter, timeRange, getSinceTimestamp])

  // Initial fetch when component mounts or filters change
  useEffect(() => {
    setEvents([])
    lastTimestampRef.current = null
    initialFetchDoneRef.current = false
    fetchEvents(true)
  }, [selectedExperiment, selectedSession, statusFilter, timeRange])

  // Poll for new events
  useEffect(() => {
    if (!isPolling) return

    const interval = setInterval(() => {
      fetchEvents(false)
    }, POLL_INTERVAL)
    
    return () => clearInterval(interval)
  }, [isPolling, fetchEvents])

  // Auto-scroll events to top (newest first)
  useEffect(() => {
    if (eventsContainerRef.current && viewMode === 'events') {
      eventsContainerRef.current.scrollTop = 0
    }
  }, [events, viewMode])

  const handleRefresh = () => {
    refetchSessions()
    if (selectedExperiment) refetchStats()
    fetchEvents(true)
  }

  // Parse timestamp ensuring UTC interpretation
  const parseTimestamp = (dateString: string): Date => {
    // If the timestamp doesn't have a timezone indicator, treat it as UTC
    if (!dateString.endsWith('Z') && !dateString.includes('+') && !dateString.includes('-', 10)) {
      return new Date(dateString + 'Z')
    }
    return new Date(dateString)
  }

  const formatTimeAgo = (dateString: string): string => {
    const date = parseTimestamp(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSecs = Math.floor(diffMs / 1000)

    if (diffSecs < 5) return 'Just now'
    if (diffSecs < 60) return `${diffSecs}s ago`
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`
    return `${Math.floor(diffSecs / 86400)}d ago`
  }

  const formatLocalTime = (dateString: string): string => {
    const date = parseTimestamp(dateString)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    
    // Format HH:mm
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const timeStr = `${hours}:${minutes}`
    
    if (isToday) {
      // For today: show time with relative in brackets
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      
      let relativeStr: string
      if (diffMins < 1) {
        relativeStr = 'just now'
      } else if (diffMins < 60) {
        relativeStr = `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`
      } else {
        const diffHours = Math.floor(diffMins / 60)
        relativeStr = `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
      }
      
      return `${timeStr} (${relativeStr})`
    } else {
      // For other days: HH:mm dd/mm/yyyy
      const day = date.getDate().toString().padStart(2, '0')
      const month = (date.getMonth() + 1).toString().padStart(2, '0')
      const year = date.getFullYear()
      return `${timeStr} ${day}/${month}/${year}`
    }
  }

  const formatDuration = (seconds: number | null): string => {
    if (seconds === null) return 'N/A'
    if (seconds < 60) return `${Math.round(seconds)}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
    return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
  }

  const getStatusBadgeClass = (status: string): string => {
    switch (status) {
      case 'active':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200'
      case 'completed':
        return 'bg-sky-100 text-sky-700 border-sky-200'
      case 'abandoned':
        return 'bg-rose-100 text-rose-700 border-rose-200'
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200'
    }
  }

  const getEventTypeColor = (eventType: string): string => {
    if (eventType === 'session_end') return 'text-emerald-600 bg-emerald-50 ring-1 ring-emerald-200'
    if (eventType === 'session_start') return 'text-violet-600 bg-violet-50'
    if (eventType.includes('session')) return 'text-violet-600 bg-violet-50'
    if (eventType.includes('stage')) return 'text-sky-600 bg-sky-50'
    if (eventType.includes('video')) return 'text-amber-600 bg-amber-50'
    if (eventType.includes('click') || eventType.includes('input')) return 'text-emerald-600 bg-emerald-50'
    if (eventType.includes('error')) return 'text-rose-600 bg-rose-50'
    if (eventType.includes('multiple_choice')) return 'text-indigo-600 bg-indigo-50'
    if (eventType.includes('attention_check')) return 'text-orange-600 bg-orange-50'
    return 'text-slate-600 bg-slate-50'
  }

  const toggleEventExpand = (eventId: string) => {
    setExpandedEvents(prev => {
      const newSet = new Set(prev)
      if (newSet.has(eventId)) {
        newSet.delete(eventId)
      } else {
        newSet.add(eventId)
      }
      return newSet
    })
  }

  const getEventIcon = (eventType: string): string => {
    if (eventType.includes('session_start')) return '🚀'
    if (eventType.includes('session_end') || eventType.includes('session_complete')) return '🏁'
    if (eventType.includes('stage_view')) return '👁️'
    if (eventType.includes('stage_submit') || eventType.includes('stage_complete')) return '📝'
    if (eventType.includes('video')) return '🎬'
    if (eventType.includes('click')) return '👆'
    if (eventType.includes('input')) return '⌨️'
    if (eventType.includes('error')) return '❌'
    if (eventType.includes('response')) return '💬'
    if (eventType.includes('multiple_choice')) return '📋'
    if (eventType.includes('attention_check')) return '🎯'
    return '📌'
  }

  // Check if the event has correctness information (for multiple choice, attention checks, etc.)
  const getCorrectnessIndicator = (event: LiveEvent): { isCorrect: boolean | null; text: string | null } => {
    const { payload, event_type } = event
    
    // Multiple choice submit event
    if (event_type === 'multiple_choice_submit') {
      const isCorrect = payload.is_correct as boolean | null | undefined
      if (isCorrect === true) {
        return { isCorrect: true, text: 'Correct' }
      } else if (isCorrect === false) {
        return { isCorrect: false, text: 'Incorrect' }
      }
    }
    
    // Attention check events
    if (event_type === 'attention_check_passed') {
      return { isCorrect: true, text: 'Passed' }
    }
    if (event_type === 'attention_check_failed') {
      return { isCorrect: false, text: 'Failed' }
    }
    
    return { isCorrect: null, text: null }
  }

  const formatPayloadValue = (value: unknown): string => {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) return JSON.stringify(value)
    if (typeof value === 'object') return JSON.stringify(value, null, 2)
    return String(value)
  }

  const renderEventRow = (event: LiveEvent) => {
    const isExpanded = expandedEvents.has(event.event_id)
    const hasPayload = Object.keys(event.payload).length > 0
    const payloadStr = hasPayload ? JSON.stringify(event.payload) : ''
    const correctness = getCorrectnessIndicator(event)

    return (
      <div
        key={event.event_id}
        className={`border-b border-slate-100 transition-colors ${isExpanded ? 'bg-indigo-50/50' : 'hover:bg-slate-50/50'}`}
      >
        {/* Main row - always clickable */}
        <div
          className="flex items-start gap-3 px-4 py-2.5 text-sm cursor-pointer select-none"
          onClick={() => toggleEventExpand(event.event_id)}
        >
          {/* Expand indicator */}
          <span className={`text-slate-400 transition-transform mt-1 w-4 shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>
            <ChevronIcon className="w-4 h-4" />
          </span>

          {/* Time column */}
          <span className="text-xs text-slate-400 font-mono whitespace-nowrap mt-0.5 w-[170px] shrink-0 text-right">
            {formatLocalTime(event.server_timestamp)}
          </span>

          {/* Event icon */}
          <span className="text-sm mt-0.5 w-5 shrink-0 text-center" title={event.event_type}>
            {getEventIcon(event.event_type)}
          </span>

          {/* Event type badge + Correctness indicator in same column */}
          <div className="flex flex-col items-start gap-1 w-[150px] shrink-0">
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap text-center ${getEventTypeColor(event.event_type)}`}
            >
              {event.event_type}
            </span>

            {/* Correctness indicator for multiple choice / attention check events */}
            {correctness.isCorrect !== null && (
              <span
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${
                  correctness.isCorrect
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    : 'bg-red-100 text-red-700 border border-red-200'
                }`}
              >
                {correctness.isCorrect ? (
                  <CheckIcon className="w-3 h-3" />
                ) : (
                  <XIcon className="w-3 h-3" />
                )}
                {correctness.text}
              </span>
            )}
          </div>

          {/* Participant & Session */}
          <div className="flex flex-col gap-0.5 w-[120px] shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-indigo-600 text-sm">
                {getParticipantDisplay(event)}
              </span>
              <code className="text-xs bg-slate-100 px-1 py-0.5 rounded text-slate-500" title={event.session_id}>
                {event.session_id.slice(0, 6)}
              </code>
            </div>
          </div>

          {/* Stage & Block */}
          <div className="flex flex-col gap-0.5 w-[160px] shrink-0">
            <div className="flex items-center gap-1">
              <span className="text-slate-500 text-xs">stage:</span>
              <span className="font-medium text-slate-700 text-sm truncate" title={event.stage_id}>{event.stage_id}</span>
            </div>
            {event.block_id && (
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-xs">block:</span>
                <span className="text-slate-600 text-xs truncate" title={event.block_id}>{event.block_id}</span>
              </div>
            )}
          </div>

          {/* Answer preview for multiple choice */}
          {event.event_type === 'multiple_choice_submit' && event.payload.selected_answers !== undefined && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs text-slate-400">Answer:</span>
              <span className="text-xs font-medium text-slate-700">
                {Array.isArray(event.payload.selected_answers)
                  ? (event.payload.selected_answers as string[]).join(', ')
                  : String(event.payload.selected_answers)}
              </span>
            </div>
          )}

          {/* Session completion summary */}
          {event.event_type === 'session_end' && (
            <div className="flex items-center gap-3 shrink-0">
              {event.payload.duration_formatted !== undefined && (
                <span className="flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
                  <ClockIcon className="w-3 h-3" />
                  {String(event.payload.duration_formatted)}
                </span>
              )}
              {event.payload.completed_stages_count !== undefined && (
                <span className="text-xs text-slate-500">
                  {Number(event.payload.completed_stages_count)}/{Number(event.payload.total_stages)} stages
                </span>
              )}
            </div>
          )}

          {/* Payload preview - no truncate */}
          {hasPayload && !event.event_type.includes('multiple_choice') && (
            <div className="flex-1 min-w-0">
              <span className="text-xs text-slate-500 break-words">
                {payloadStr.length > 100 ? payloadStr.slice(0, 100) + '...' : payloadStr}
              </span>
            </div>
          )}
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div className="px-4 pb-3 pt-1 ml-8">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                Event Details
              </div>
              <div className="p-4 space-y-3">
                {/* Event metadata */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs w-20">Participant:</span>
                    <span className="text-indigo-600 font-semibold text-xs">{getParticipantDisplay(event)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs w-20">Event ID:</span>
                    <code className="text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-xs">{event.event_id}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs w-20">Session ID:</span>
                    <code className="text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-xs">{event.session_id}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs w-20">User ID:</span>
                    <code className="text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-xs">{event.user_id}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs w-20">Client Time:</span>
                    <span className="text-slate-700 text-xs">{formatLocalTime(event.client_timestamp)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs w-20">Stage:</span>
                    <span className="text-slate-700 font-medium text-xs">{event.stage_id}</span>
                  </div>
                  {event.block_id && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs w-20">Block:</span>
                      <span className="text-slate-700 text-xs">{event.block_id}</span>
                    </div>
                  )}
                </div>

                {/* Payload */}
                {hasPayload ? (
                  <div>
                    <span className="text-slate-600 font-medium text-sm block mb-3">Payload Data:</span>
                    <div className="space-y-2 bg-slate-50 rounded-lg p-3">
                      {Object.entries(event.payload).map(([key, value]) => (
                        <div key={key} className="flex gap-3 items-start">
                          <span className="text-indigo-600 font-medium text-sm min-w-[120px] shrink-0">{key}:</span>
                          <div className="text-slate-800 break-all whitespace-pre-wrap font-mono text-sm bg-white px-3 py-2 rounded border border-slate-200 flex-1">
                            {formatPayloadValue(value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-400 text-sm italic">No payload data</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderParticipantCard = (session: SessionListItem) => (
    <div
      key={session.session_id}
      className={`p-4 rounded-xl border transition-all cursor-pointer ${
        selectedSession === session.session_id
          ? 'border-indigo-300 bg-indigo-50/50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
      }`}
      onClick={() => setSelectedSession(
        selectedSession === session.session_id ? '' : session.session_id
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-indigo-600">
            {getParticipantDisplay(session)}
          </span>
          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono text-slate-500">
            {session.session_id.slice(0, 6)}
          </code>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusBadgeClass(session.status)}`}>
            {session.status}
          </span>
        </div>
        {session.status === 'active' && (
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-sm">
          <span className="text-slate-500">Current:</span>
          <span className="font-medium text-slate-700 ml-1">
            {session.current_stage_label || session.current_stage_id || '(none)'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                session.status === 'completed' ? 'bg-sky-500' :
                session.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
              style={{ width: `${session.progress_percentage}%` }}
            />
          </div>
          <span className="text-xs font-medium text-slate-500 w-16 text-right">
            {session.completed_stages_count}/{session.total_stages_count}
            <span className="text-slate-400 ml-1">({Math.round(session.progress_percentage)}%)</span>
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
          <span>Started: {formatTimeAgo(session.created_at)}</span>
          <span>Updated: {formatTimeAgo(session.updated_at)}</span>
        </div>
      </div>
    </div>
  )

  const renderStatisticsPanel = () => {
    if (!selectedExperiment) {
      return (
        <div className="flex items-center justify-center h-64 text-slate-400">
          Select an experiment to view statistics
        </div>
      )
    }
    
    if (statsLoading) {
      return (
        <div className="flex items-center justify-center h-64 text-slate-400">
          Loading statistics...
        </div>
      )
    }
    
    if (statsError) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-rose-500">
          <p>Error loading statistics</p>
          <p className="text-sm text-slate-400 mt-2">{String(statsError)}</p>
        </div>
      )
    }
    
    if (!stats) {
      return (
        <div className="flex items-center justify-center h-64 text-slate-400">
          No statistics available
        </div>
      )
    }

    return (
      <div className="space-y-6">
        {/* Overview Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Sessions"
            value={stats.total_sessions}
            color="slate"
          />
          <StatCard
            label="Active Now"
            value={stats.active_sessions}
            color="emerald"
            pulse={stats.active_sessions > 0}
          />
          <StatCard
            label="Completed"
            value={stats.completed_sessions}
            color="sky"
          />
          <StatCard
            label="Completion Rate"
            value={`${stats.completion_rate.toFixed(1)}%`}
            color="violet"
          />
        </div>

        {/* Stage Statistics */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-800">Stage Statistics</h3>
          {stats.stages.map((stage) => (
            <div key={stage.stage_id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-700">
                    {stage.stage_label || stage.stage_id}
                  </span>
                  <span className="text-xs text-slate-400 ml-2">({stage.stage_id})</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-slate-500">
                    <span className="font-medium text-slate-700">{stage.view_count}</span> views
                  </span>
                  <span className="text-slate-500">
                    <span className="font-medium text-slate-700">{stage.completion_count}</span> completions
                  </span>
                  {stage.avg_time_seconds !== null && (
                    <span className="text-slate-500">
                      avg. <span className="font-medium text-slate-700">{formatDuration(stage.avg_time_seconds)}</span>
                    </span>
                  )}
                </div>
              </div>

              {stage.blocks.length > 0 && (
                <div className="divide-y divide-slate-100">
                  {stage.blocks.map((block) => (
                    <div key={block.block_id} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-700">
                            {block.block_id}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500">
                            {block.block_type}
                          </span>
                        </div>
                        <span className="text-sm text-slate-500">
                          <span className="font-medium text-slate-700">{block.response_count}</span> responses
                        </span>
                      </div>

                      {/* Numeric stats */}
                      {block.avg_value !== null && (
                        <div className="flex flex-wrap gap-4 text-xs mt-2">
                          <span className="text-slate-500">
                            Min: <span className="font-medium text-slate-700">{block.min_value?.toFixed(2)}</span>
                          </span>
                          <span className="text-slate-500">
                            Max: <span className="font-medium text-slate-700">{block.max_value?.toFixed(2)}</span>
                          </span>
                          <span className="text-slate-500">
                            Avg: <span className="font-medium text-slate-700">{block.avg_value?.toFixed(2)}</span>
                          </span>
                          <span className="text-slate-500">
                            Median: <span className="font-medium text-slate-700">{block.median_value?.toFixed(2)}</span>
                          </span>
                        </div>
                      )}

                      {/* Value distribution */}
                      {block.value_distribution && Object.keys(block.value_distribution).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {Object.entries(block.value_distribution)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 10)
                            .map(([value, count]) => (
                              <span
                                key={value}
                                className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100"
                              >
                                {value.length > 20 ? `${value.slice(0, 20)}...` : value}: {count}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Live Preview</h1>
          <p className="text-slate-500 mt-1">
            Real-time monitoring of participant activity and responses
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Polling toggle */}
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <div className={`relative w-10 h-5 rounded-full transition-colors ${isPolling ? 'bg-emerald-500' : 'bg-slate-300'}`}>
              <input
                type="checkbox"
                checked={isPolling}
                onChange={(e) => setIsPolling(e.target.checked)}
                className="sr-only"
              />
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isPolling ? 'translate-x-5' : ''}`} />
            </div>
            <span className={isPolling ? 'text-emerald-600 font-medium' : ''}>
              {isPolling ? 'Live' : 'Paused'}
            </span>
          </label>

          <button
            onClick={handleRefresh}
            className="btn btn-secondary flex items-center gap-2"
          >
            <RefreshIcon className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-white border border-slate-200">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Experiment</label>
          <select
            value={selectedExperiment}
            onChange={(e) => {
              setSelectedExperiment(e.target.value)
              setSelectedSession('')
            }}
            className="input w-64"
          >
            <option value="">All Experiments</option>
            {experiments?.map((exp) => (
              <option key={exp.experiment_id} value={exp.experiment_id}>
                {exp.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="input w-40"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="abandoned">Abandoned</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Time Range</label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            className="input w-44"
          >
            {TIME_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto">
          <label className="block text-xs font-medium text-slate-500 mb-1">View</label>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {(['participants', 'events', 'statistics'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  viewMode === mode
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content based on view mode */}
      {viewMode === 'participants' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions && sessions.length > 0 ? (
            sessions.map(renderParticipantCard)
          ) : (
            <div className="col-span-full text-center py-12 text-slate-400">
              No sessions found matching the current filters
            </div>
          )}
        </div>
      )}

      {viewMode === 'events' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isPolling && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
              )}
              <h2 className="font-semibold text-slate-700">Live Events</h2>
              <span className="text-sm text-slate-400">
                ({filteredEvents.length}{hiddenEventTypes.size > 0 ? `/${events.length}` : ''} events)
              </span>
            </div>
            <div className="flex items-center gap-3">
              {selectedSession && (
                <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded">
                  Filtering: {sessions?.find(s => s.session_id === selectedSession) 
                    ? getParticipantDisplay(sessions.find(s => s.session_id === selectedSession)!)
                    : selectedSession.slice(0, 8)}
                  <button
                    onClick={() => setSelectedSession('')}
                    className="ml-2 text-indigo-400 hover:text-indigo-600"
                  >
                    ×
                  </button>
                </span>
              )}
              <button
                onClick={() => setShowEventTypeFilter(!showEventTypeFilter)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  showEventTypeFilter || hiddenEventTypes.size > 0
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <FilterIcon className="w-3.5 h-3.5" />
                Event Types
                {hiddenEventTypes.size > 0 && (
                  <span className="bg-indigo-200 text-indigo-800 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                    {uniqueEventTypes.length - hiddenEventTypes.size}/{uniqueEventTypes.length}
                  </span>
                )}
              </button>
              <span className="text-xs text-slate-400">
                {TIME_RANGES.find(r => r.value === timeRange)?.label}
              </span>
            </div>
          </div>

          {/* Event Type Filter Panel */}
          {showEventTypeFilter && (
            <div className="px-4 py-3 bg-slate-50/50 border-b border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600">Filter by Event Type</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={showAllEventTypes}
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    Show All
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    onClick={hideAllEventTypes}
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    Hide All
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {uniqueEventTypes.map(eventType => {
                  const isVisible = !hiddenEventTypes.has(eventType)
                  const category = EVENT_TYPE_CATEGORIES[eventType]
                  const eventCount = events.filter(e => e.event_type === eventType).length
                  
                  return (
                    <button
                      key={eventType}
                      onClick={() => toggleEventType(eventType)}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all ${
                        isVisible
                          ? `${category?.bgColor || 'bg-slate-100'} ${category?.color || 'text-slate-700'} ring-1 ring-inset ring-current/20`
                          : 'bg-slate-100 text-slate-400 opacity-60'
                      }`}
                    >
                      {isVisible ? (
                        <EyeIcon className="w-3 h-3" />
                      ) : (
                        <EyeOffIcon className="w-3 h-3" />
                      )}
                      {category?.label || eventType}
                      <span className={`text-[10px] ${isVisible ? 'opacity-70' : 'opacity-50'}`}>
                        ({eventCount})
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div
            ref={eventsContainerRef}
            className="max-h-[600px] overflow-y-auto"
          >
            {isLoadingEvents && events.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                Loading events...
              </div>
            ) : filteredEvents.length > 0 ? (
              [...filteredEvents].sort((a, b) => 
                parseTimestamp(b.server_timestamp).getTime() - parseTimestamp(a.server_timestamp).getTime()
              ).map(renderEventRow)
            ) : events.length > 0 ? (
              <div className="text-center py-12 text-slate-400">
                All events hidden by filter. 
                <button 
                  onClick={showAllEventTypes}
                  className="ml-2 text-indigo-600 hover:text-indigo-800 underline"
                >
                  Show all
                </button>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400">
                {isPolling ? 'No events in the selected time range. Waiting for new events...' : 'Polling paused'}
              </div>
            )}
          </div>
        </div>
      )}

      {viewMode === 'statistics' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          {renderStatisticsPanel()}
        </div>
      )}

      {/* Quick summary footer */}
      {sessions && sessions.length > 0 && (
        <div className="flex items-center justify-center gap-6 text-sm text-slate-500 py-4">
          <span>
            <span className="font-semibold text-emerald-600">
              {sessions.filter(s => s.status === 'active').length}
            </span> active
          </span>
          <span>•</span>
          <span>
            <span className="font-semibold text-sky-600">
              {sessions.filter(s => s.status === 'completed').length}
            </span> completed
          </span>
          <span>•</span>
          <span>
            <span className="font-semibold text-slate-600">
              {sessions.length}
            </span> total
          </span>
        </div>
      )}
    </div>
  )
}

// Stat Card Component
function StatCard({
  label,
  value,
  color,
  pulse = false,
}: {
  label: string
  value: string | number
  color: 'slate' | 'emerald' | 'sky' | 'violet' | 'amber'
  pulse?: boolean
}) {
  const colorMap = {
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    sky: 'bg-sky-50 border-sky-200 text-sky-700',
    violet: 'bg-violet-50 border-violet-200 text-violet-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
  }

  return (
    <div className={`p-4 rounded-xl border ${colorMap[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-2xl font-bold">{value}</span>
        {pulse && (
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
        )}
      </div>
      <span className="text-sm opacity-80">{label}</span>
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

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 9l-7 7-7-7"
      />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
      />
    </svg>
  )
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  )
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
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
