import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { api } from '../lib/api'

interface SessionStats {
  total_sessions: number
  active_sessions: number
  completed_sessions: number
  abandoned_sessions: number
  completion_rate: number
  avg_completion_time_seconds: number | null
}

interface DailySessionData {
  date: string
  date_full: string
  sessions: number
  completed: number
  abandoned: number
}

interface SessionsOverTimeResponse {
  data: DailySessionData[]
  period_days: number
}

export default function DashboardPage() {
  const { data: experiments } = useQuery({
    queryKey: ['experiments'],
    queryFn: async () => {
      const response = await api.get('/experiments?limit=100')
      return response.data
    },
  })

  const { data: sessionStats } = useQuery<SessionStats>({
    queryKey: ['sessionStats'],
    queryFn: async () => {
      const response = await api.get('/monitoring/sessions/stats')
      return response.data
    },
  })

  const { data: sessionsOverTime } = useQuery<SessionsOverTimeResponse>({
    queryKey: ['sessionsOverTime'],
    queryFn: async () => {
      const response = await api.get('/monitoring/sessions/over-time?days=14')
      return response.data
    },
  })

  // Use real data from API for the chart
  const dailySessionData = sessionsOverTime?.data || []

  // Pie chart data for session status
  const sessionStatusData = [
    { name: 'Completed', value: sessionStats?.completed_sessions || 0, color: '#22c55e' },
    { name: 'Active', value: sessionStats?.active_sessions || 0, color: '#3b82f6' },
    { name: 'Abandoned', value: sessionStats?.abandoned_sessions || 0, color: '#ef4444' },
  ].filter((d) => d.value > 0)

  // Experiment status breakdown
  const experimentStatusData = [
    {
      name: 'Published',
      count: experiments?.filter((e: { status: string }) => e.status === 'published').length || 0,
    },
    {
      name: 'Draft',
      count: experiments?.filter((e: { status: string }) => e.status === 'draft').length || 0,
    },
    {
      name: 'Archived',
      count: experiments?.filter((e: { status: string }) => e.status === 'archived').length || 0,
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Welcome to the B-IRES Admin Dashboard</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          title="Total Experiments"
          value={experiments?.length || 0}
          icon={BeakerIcon}
        />
        <StatCard
          title="Total Sessions"
          value={sessionStats?.total_sessions || 0}
          icon={UsersIcon}
          color="blue"
        />
        <StatCard
          title="Completion Rate"
          value={`${(sessionStats?.completion_rate || 0).toFixed(1)}%`}
          icon={CheckIcon}
          color="green"
        />
        <StatCard
          title="Active Now"
          value={sessionStats?.active_sessions || 0}
          icon={ActivityIcon}
          color="purple"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sessions Over Time */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Sessions Over Time</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailySessionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="sessions"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Session Status Breakdown */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Session Status</h3>
          <div className="h-64 flex items-center justify-center">
            {sessionStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sessionStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {sessionStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-gray-500">No session data yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Experiment Status Bar Chart */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Experiments by Status</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={experimentStatusData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} stroke="#9ca3af" width={80} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Experiments */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Experiments</h2>
          <Link to="/experiments" className="text-sm text-primary-600 hover:text-primary-700">
            View all →
          </Link>
        </div>
        
        {experiments?.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((exp: { experiment_id: string; name: string; status: string; updated_at: string }) => (
                <tr key={exp.experiment_id}>
                  <td className="font-medium">{exp.name}</td>
                  <td>
                    <span className={`badge ${
                      exp.status === 'published' ? 'badge-green' :
                      exp.status === 'draft' ? 'badge-yellow' : 'badge-gray'
                    }`}>
                      {exp.status}
                    </span>
                  </td>
                  <td className="text-gray-500">
                    {new Date(exp.updated_at).toLocaleDateString()}
                  </td>
                  <td>
                    <Link
                      to={`/experiments/${exp.experiment_id}`}
                      className="text-primary-600 hover:text-primary-700 text-sm"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-6 text-center text-gray-500">
            No experiments yet.{' '}
            <Link to="/experiments/new" className="text-primary-600 hover:text-primary-700">
              Create your first experiment
            </Link>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link to="/experiments/new" className="card p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
              <PlusIcon className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">New Experiment</h3>
              <p className="text-sm text-gray-500">Create a new experiment from scratch</p>
            </div>
          </div>
        </Link>

        <Link to="/assets" className="card p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <UploadIcon className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Upload Assets</h3>
              <p className="text-sm text-gray-500">Upload images, videos, and files</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  icon: Icon,
  color = 'gray',
}: {
  title: string
  value: number | string
  icon: React.ComponentType<{ className?: string }>
  color?: 'gray' | 'blue' | 'green' | 'purple'
}) {
  const colorClasses = {
    gray: 'bg-gray-100 text-gray-600',
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${colorClasses[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-sm text-gray-500">{title}</p>
        </div>
      </div>
    </div>
  )
}

// Icons
function BeakerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  )
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  )
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
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

