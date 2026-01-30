import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

interface Experiment {
  experiment_id: string
  name: string
  status: string
}

interface ExportStats {
  experiment_id: string
  total_sessions: number
  status_breakdown: Record<string, number>
  completion_rate: number
  stage_completions: Record<string, number>
}

type ExportFormat = 'csv_wide' | 'csv_long' | 'json' | 'events'

export default function ExportPage() {
  const [selectedExperiment, setSelectedExperiment] = useState<string>('')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv_wide')
  const [includeEvents, setIncludeEvents] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Fetch experiments
  const { data: experiments, isLoading: experimentsLoading } = useQuery({
    queryKey: ['experiments'],
    queryFn: async () => {
      const response = await api.get('/experiments?limit=100')
      return response.data as Experiment[]
    },
  })

  // Fetch export stats when experiment is selected
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['exportStats', selectedExperiment],
    queryFn: async () => {
      const response = await api.get(`/export/${selectedExperiment}/stats`)
      return response.data as ExportStats
    },
    enabled: !!selectedExperiment,
  })

  const handleExport = async () => {
    if (!selectedExperiment) return

    setIsExporting(true)
    setExportError(null)

    try {
      const params = new URLSearchParams()

      if (startDate) params.append('start_date', new Date(startDate).toISOString())
      if (endDate) params.append('end_date', new Date(endDate).toISOString())

      let endpoint = ''
      let filename = ''

      switch (exportFormat) {
        case 'csv_wide':
          params.append('format', 'wide')
          if (selectedStages.length > 0) params.append('stages', selectedStages.join(','))
          endpoint = `/export/${selectedExperiment}/csv`
          filename = `${selectedExperiment}_wide.csv`
          break
        case 'csv_long':
          params.append('format', 'long')
          if (selectedStages.length > 0) params.append('stages', selectedStages.join(','))
          endpoint = `/export/${selectedExperiment}/csv`
          filename = `${selectedExperiment}_long.csv`
          break
        case 'json':
          if (includeEvents) params.append('include_events', 'true')
          endpoint = `/export/${selectedExperiment}/json`
          filename = `${selectedExperiment}.json`
          break
        case 'events':
          endpoint = `/export/${selectedExperiment}/events`
          filename = `${selectedExperiment}_events.json`
          break
      }

      const response = await api.get(`${endpoint}?${params.toString()}`, {
        responseType: 'blob',
      })

      // Create download link
      const blob = new Blob([response.data], {
        type: exportFormat.startsWith('csv') ? 'text/csv' : 'application/json',
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error: unknown) {
      console.error('Export error:', error)
      const axiosError = error as { response?: { data?: { detail?: string } } }
      setExportError(axiosError.response?.data?.detail || 'Export failed. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  const selectedExp = experiments?.find((e) => e.experiment_id === selectedExperiment)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Export Data</h1>
        <p className="mt-1 text-gray-500">
          Export experiment results in various formats for analysis
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Export Configuration */}
        <div className="lg:col-span-2 space-y-6">
          {/* Experiment Selection */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Select Experiment
            </h2>

            {experimentsLoading ? (
              <div className="animate-pulse h-10 bg-gray-200 rounded"></div>
            ) : (
              <select
                value={selectedExperiment}
                onChange={(e) => {
                  setSelectedExperiment(e.target.value)
                  setSelectedStages([])
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">Choose an experiment...</option>
                {experiments?.map((exp) => (
                  <option key={exp.experiment_id} value={exp.experiment_id}>
                    {exp.name} ({exp.status})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Export Format */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Export Format
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <FormatCard
                title="CSV (Wide)"
                description="One row per session, columns for each response"
                icon={<TableIcon className="w-6 h-6" />}
                selected={exportFormat === 'csv_wide'}
                onClick={() => setExportFormat('csv_wide')}
              />
              <FormatCard
                title="CSV (Long)"
                description="One row per response, easier for statistical analysis"
                icon={<ListIcon className="w-6 h-6" />}
                selected={exportFormat === 'csv_long'}
                onClick={() => setExportFormat('csv_long')}
              />
              <FormatCard
                title="JSON"
                description="Full session data with nested structure"
                icon={<CodeIcon className="w-6 h-6" />}
                selected={exportFormat === 'json'}
                onClick={() => setExportFormat('json')}
              />
              <FormatCard
                title="Events JSON"
                description="Raw event log with timestamps"
                icon={<ActivityIcon className="w-6 h-6" />}
                selected={exportFormat === 'events'}
                onClick={() => setExportFormat('events')}
              />
            </div>

            {/* JSON-specific option */}
            {exportFormat === 'json' && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeEvents}
                    onChange={(e) => setIncludeEvents(e.target.checked)}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">
                    Include detailed event logs in export
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Filters (Optional)
            </h2>

            <div className="space-y-4">
              {/* Date Range */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              </div>

              {/* Stage Filter (for CSV formats) */}
              {(exportFormat === 'csv_wide' || exportFormat === 'csv_long') && stats && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Filter Stages
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(stats.stage_completions).map((stageId) => (
                      <button
                        key={stageId}
                        onClick={() => {
                          if (selectedStages.includes(stageId)) {
                            setSelectedStages(selectedStages.filter((s) => s !== stageId))
                          } else {
                            setSelectedStages([...selectedStages, stageId])
                          }
                        }}
                        className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                          selectedStages.includes(stageId)
                            ? 'bg-primary-100 border-primary-300 text-primary-700'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {stageId}
                      </button>
                    ))}
                  </div>
                  {selectedStages.length === 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      No stages selected = all stages included
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Export Button */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleExport}
              disabled={!selectedExperiment || isExporting}
              className="flex items-center gap-2 px-6 py-3 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isExporting ? (
                <>
                  <SpinnerIcon className="w-5 h-5 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <DownloadIcon className="w-5 h-5" />
                  Export Data
                </>
              )}
            </button>

            {exportError && (
              <p className="text-sm text-red-600">{exportError}</p>
            )}
          </div>
        </div>

        {/* Stats Preview */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Export Preview
            </h2>

            {!selectedExperiment ? (
              <p className="text-gray-500 text-sm">
                Select an experiment to see export statistics
              </p>
            ) : statsLoading ? (
              <div className="space-y-3">
                <div className="animate-pulse h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="animate-pulse h-4 bg-gray-200 rounded w-1/2"></div>
                <div className="animate-pulse h-4 bg-gray-200 rounded w-2/3"></div>
              </div>
            ) : stats ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-500">Experiment</p>
                  <p className="font-medium text-gray-900">{selectedExp?.name}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Total Sessions</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.total_sessions}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Completion Rate</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{ width: `${stats.completion_rate}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium text-gray-900">
                      {stats.completion_rate.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-gray-500 mb-2">Session Status</p>
                  <div className="space-y-2">
                    {Object.entries(stats.status_breakdown).map(([status, count]) => (
                      <div key={status} className="flex justify-between text-sm">
                        <span className="text-gray-600 capitalize">{status}</span>
                        <span className="font-medium text-gray-900">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {Object.keys(stats.stage_completions).length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 mb-2">Stage Completions</p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {Object.entries(stats.stage_completions).map(([stage, count]) => (
                        <div key={stage} className="flex justify-between text-sm">
                          <span className="text-gray-600 truncate mr-2">{stage}</span>
                          <span className="font-medium text-gray-900">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Format Info */}
          <div className="bg-gradient-to-br from-primary-50 to-indigo-50 rounded-xl border border-primary-100 p-6">
            <h3 className="font-semibold text-primary-900 mb-3">Format Guide</h3>
            <div className="space-y-3 text-sm text-primary-800">
              <div>
                <p className="font-medium">CSV Wide</p>
                <p className="text-primary-600">Best for SPSS, Excel pivot tables</p>
              </div>
              <div>
                <p className="font-medium">CSV Long</p>
                <p className="text-primary-600">Best for R, Python pandas, mixed models</p>
              </div>
              <div>
                <p className="font-medium">JSON</p>
                <p className="text-primary-600">Full data with metadata, programmatic access</p>
              </div>
              <div>
                <p className="font-medium">Events JSON</p>
                <p className="text-primary-600">Timing analysis, user behavior tracking</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Format card component
interface FormatCardProps {
  title: string
  description: string
  icon: React.ReactNode
  selected: boolean
  onClick: () => void
}

function FormatCard({ title, description, icon, selected, onClick }: FormatCardProps) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-lg border-2 transition-all ${
        selected
          ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className={`mb-2 ${selected ? 'text-primary-600' : 'text-gray-400'}`}>
        {icon}
      </div>
      <p className={`font-medium ${selected ? 'text-primary-900' : 'text-gray-900'}`}>
        {title}
      </p>
      <p className="text-xs text-gray-500 mt-1">{description}</p>
    </button>
  )
}

// Icons
function TableIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  )
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  )
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  )
}



