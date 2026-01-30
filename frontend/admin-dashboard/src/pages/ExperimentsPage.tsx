import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import clsx from 'clsx'
import yaml from 'js-yaml'

interface Experiment {
  experiment_id: string
  name: string
  description?: string
  status: 'draft' | 'published' | 'archived'
  version: string
  created_at: string
  updated_at: string
  published_at?: string
}

export default function ExperimentsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<string>('')
  
  // Import state
  const [showImportModal, setShowImportModal] = useState(false)
  const [importName, setImportName] = useState('')
  const [importDescription, setImportDescription] = useState('')
  const [importYaml, setImportYaml] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 3-dots menu and clear all state
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [showClearConfirmation, setShowClearConfirmation] = useState(false)
  const [confirmationInput, setConfirmationInput] = useState('')
  const [clearError, setClearError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const { data: experiments, isLoading } = useQuery({
    queryKey: ['experiments', statusFilter],
    queryFn: async () => {
      const params = statusFilter ? `?status=${statusFilter}` : ''
      const response = await api.get(`/experiments${params}`)
      return response.data as Experiment[]
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (experimentId: string) => {
      await api.delete(`/experiments/${experimentId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
    },
  })

  const publishMutation = useMutation({
    mutationFn: async (experimentId: string) => {
      await api.post(`/experiments/${experimentId}/publish`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: async (experimentId: string) => {
      await api.patch(`/experiments/${experimentId}`, { status: 'archived' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: async (experimentId: string) => {
      await api.post(`/experiments/${experimentId}/duplicate`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
    },
  })

  // Import experiment mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/experiments/import', {
        name: importName,
        description: importDescription || undefined,
        config_yaml: importYaml,
      })
      return response.data
    },
    onSuccess: (data) => {
      setShowImportModal(false)
      setImportName('')
      setImportDescription('')
      setImportYaml('')
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
      navigate(`/experiments/${data.experiment_id}`)
    },
  })

  // Mutation for clearing all experiments
  const clearAllMutation = useMutation({
    mutationFn: async (confirmation: string) => {
      const response = await api.delete('/experiments/data/all', {
        data: { confirmation },
      })
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
      setShowClearConfirmation(false)
      setConfirmationInput('')
      setClearError(null)
      alert(`Successfully deleted: ${data.experiments_deleted} experiments, ${data.versions_deleted} versions`)
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      setClearError(error.response?.data?.detail || 'Failed to clear experiments')
    },
  })

  // Import file handler
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setImportYaml(content)
      
      // Try to extract name from the imported config
      try {
        const parsed = yaml.load(content) as Record<string, unknown>
        let configData = parsed
        if ('export_meta' in parsed && 'config' in parsed) {
          const exportMeta = parsed.export_meta as Record<string, unknown>
          setImportName(String(exportMeta.experiment_name || '') + ' (Imported)')
          setImportDescription(String(exportMeta.experiment_description || ''))
          configData = parsed.config as Record<string, unknown>
        } else {
          const meta = configData.meta as Record<string, unknown> | undefined
          setImportName(String(meta?.name || 'Imported Experiment'))
          setImportDescription(String(meta?.description || ''))
        }
      } catch {
        setImportName('Imported Experiment')
      }
      
      setShowImportModal(true)
    }
    reader.readAsText(file)
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Experiments</h1>
          <p className="text-gray-600 mt-1">Manage your experiment configurations</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="btn btn-secondary flex items-center cursor-pointer">
            <UploadIcon className="w-5 h-5 mr-2" />
            Import YAML
            <input
              ref={fileInputRef}
              type="file"
              accept=".yaml,.yml"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
          <Link to="/experiments/new" className="btn btn-primary">
            <PlusIcon className="w-5 h-5 mr-2" />
            New Experiment
          </Link>

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
                  Clear All Experiments
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['', 'draft', 'published', 'archived'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              statusFilter === status
                ? 'bg-primary-100 text-primary-700'
                : 'text-gray-600 hover:bg-gray-100'
            )}
          >
            {status || 'All'}
          </button>
        ))}
      </div>

      {/* Experiments Table */}
      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : experiments?.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No experiments found.{' '}
            <Link to="/experiments/new" className="text-primary-600 hover:text-primary-700">
              Create your first experiment
            </Link>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Version</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {experiments?.map((exp) => (
                <tr key={exp.experiment_id}>
                  <td>
                    <div>
                      <div className="font-medium text-gray-900">{exp.name}</div>
                      {exp.description && (
                        <div className="text-sm text-gray-500 truncate max-w-xs">
                          {exp.description}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${
                      exp.status === 'published' ? 'badge-green' :
                      exp.status === 'draft' ? 'badge-yellow' : 'badge-gray'
                    }`}>
                      {exp.status}
                    </span>
                  </td>
                  <td className="text-gray-500">{exp.version}</td>
                  <td className="text-gray-500">
                    {new Date(exp.updated_at).toLocaleDateString()}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/experiments/${exp.experiment_id}`}
                        className="text-primary-600 hover:text-primary-700 text-sm"
                      >
                        {exp.status === 'published' ? 'View' : 'Edit'}
                      </Link>
                      {exp.status === 'draft' && (
                        <button
                          onClick={() => publishMutation.mutate(exp.experiment_id)}
                          className="text-green-600 hover:text-green-700 text-sm"
                          disabled={publishMutation.isPending}
                        >
                          Publish
                        </button>
                      )}
                      {exp.status === 'archived' && (
                        <button
                          onClick={() => {
                            if (confirm('Are you sure you want to republish this experiment? It will become available to participants again.')) {
                              publishMutation.mutate(exp.experiment_id)
                            }
                          }}
                          className="text-green-600 hover:text-green-700 text-sm"
                          disabled={publishMutation.isPending}
                        >
                          Republish
                        </button>
                      )}
                      {exp.status === 'published' && (
                        <button
                          onClick={() => {
                            if (confirm('Are you sure you want to archive this experiment? It will no longer be available to participants.')) {
                              archiveMutation.mutate(exp.experiment_id)
                            }
                          }}
                          className="text-orange-600 hover:text-orange-700 text-sm"
                          disabled={archiveMutation.isPending}
                        >
                          Archive
                        </button>
                      )}
                      <button
                        onClick={() => duplicateMutation.mutate(exp.experiment_id)}
                        className="text-blue-600 hover:text-blue-700 text-sm"
                        disabled={duplicateMutation.isPending}
                        title="Create a copy of this experiment"
                      >
                        Clone
                      </button>
                      {exp.status !== 'published' && (
                        <button
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this experiment?')) {
                              deleteMutation.mutate(exp.experiment_id)
                            }
                          }}
                          className="text-red-600 hover:text-red-700 text-sm"
                          disabled={deleteMutation.isPending}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowImportModal(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <UploadIcon className="w-5 h-5 text-primary-600" />
              Import Experiment
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Create a new experiment from the imported YAML configuration.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Experiment Name *</label>
                <input
                  type="text"
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder="Name for the imported experiment"
                  className="input w-full"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={importDescription}
                  onChange={(e) => setImportDescription(e.target.value)}
                  placeholder="Description"
                  className="input w-full"
                />
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-sm text-gray-600">
                  <span className="font-medium">File loaded:</span> Configuration ready to import
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowImportModal(false)
                  setImportName('')
                  setImportDescription('')
                  setImportYaml('')
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => importMutation.mutate()}
                disabled={!importName.trim() || !importYaml || importMutation.isPending}
                className="btn btn-primary"
              >
                {importMutation.isPending ? 'Importing...' : 'Import Experiment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Experiments Confirmation Modal */}
      {showClearConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <WarningIcon className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Clear All Experiments</h3>
            </div>
            
            <p className="text-gray-600 mb-4">
              This will permanently delete <strong>all experiments and their versions</strong> from the database.
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
                disabled={clearAllMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={() => clearAllMutation.mutate(confirmationInput)}
                className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                disabled={clearAllMutation.isPending}
              >
                {clearAllMutation.isPending ? 'Clearing...' : 'Clear All Experiments'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
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

