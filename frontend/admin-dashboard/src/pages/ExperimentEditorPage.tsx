import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import yaml from 'js-yaml'
import { api } from '../lib/api'
import { StageTabsEditor, StageTabsEditorRef } from '../components/stage-tabs-editor'
import { PathsPreview, PathsSimulation } from '../components/paths-preview'
import { parseValidationError, ParsedValidationError } from '../lib/validation-error-parser'
import { HotEditChannel, createHotEditChannel } from '../lib/hot-edit-channel'

// Version management types
interface ExperimentVersion {
  id: string
  experiment_id: string
  version_name: string
  description?: string
  created_by: string
  created_at: string
}

const DEFAULT_YAML = `meta:
  id: "my_experiment"
  version: "1.0.0"
  name: "My Experiment"

shell_config:
  theme: "clinical_blue"
  progress:
    show_progress_bar: true
    show_counter: true
  sidebar:
    enabled: true
    allow_navigation: true

# 4-Level Hierarchy: Phase > Stage > Block > Task
phases:
  # Phase 1: Introduction
  - id: "introduction"
    label: "Introduction"
    title: "Introduction"
    rules:
      ordering: sequential
    ui_settings:
      visible_to_participant: true
    stages:
      - id: "onboarding_stage"
        label: "Onboarding"
        rules:
          ordering: sequential
        blocks:
          - id: "consent_block"
            label: "Consent"
            tasks:
              - id: "consent"
                type: "consent_form"
                label: "Consent"
                title: "Informed Consent"
                description: "Please read and agree to participate"
                mandatory: true
                content_type: "html"
                content: |
                  <h2>Informed Consent</h2>
                  <p>Please read and agree to participate in this study.</p>
          - id: "demographics_block"
            label: "Demographics"
            tasks:
              - id: "demographics"
                type: "user_info"
                label: "Demographics"
                title: "About You"
                description: "Please provide some basic information"
                mandatory: true
                fields:
                  - field: "age"
                    label: "Age"
                    type: "number"
                    required: true
                    min: 18
                    max: 120
                  - field: "gender"
                    label: "Gender"
                    type: "select"
                    required: true
                    options:
                      - value: "male"
                        label: "Male"
                      - value: "female"
                        label: "Female"
                      - value: "other"
                        label: "Other"
                      - value: "prefer_not"
                        label: "Prefer not to say"

  # Phase 2: Main Experiment
  - id: "main_experiment"
    label: "Experiment"
    title: "Main Experiment"
    rules:
      ordering: sequential
    ui_settings:
      visible_to_participant: true
    stages:
      - id: "survey_stage"
        label: "Survey"
        rules:
          ordering: sequential
        blocks:
          - id: "survey_block"
            label: "Questions"
            tasks:
              - id: "survey"
                type: "questionnaire"
                label: "Survey"
                title: "Survey"
                description: "Please answer the following questions"
                mandatory: true
                questions:
                  - id: "q1"
                    text: "How satisfied are you with this experiment?"
                    type: "likert_scale"
                    range: [1, 5]
                    required: true

  # Phase 3: Completion
  - id: "completion"
    label: "Completion"
    title: "Thank You"
    rules:
      ordering: sequential
    ui_settings:
      visible_to_participant: true
    stages:
      - id: "debrief_stage"
        label: "Debriefing"
        rules:
          ordering: sequential
        blocks:
          - id: "debrief_block"
            label: "Thank You"
            tasks:
              - id: "debrief"
                type: "content_display"
                label: "Thank You"
                title: "Thank You"
                description: "Study completed"
                content_type: "html"
                content: |
                  <h2>Thank You for Participating!</h2>
                  <p>Your responses have been recorded.</p>
                  <p>You may now close this window.</p>
`

export default function ExperimentEditorPage() {
  const { experimentId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isNew = !experimentId || experimentId === 'new'

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [yamlContent, setYamlContent] = useState(DEFAULT_YAML)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [viewMode, setViewMode] = useState<'editor' | 'paths' | 'simulation'>('editor')
  
  // Ref for the editor component to allow jumping to errors
  const editorRef = useRef<StageTabsEditorRef>(null)
  const [isSavingAndPublishing, setIsSavingAndPublishing] = useState(false)
  
  // Track saved state for unsaved changes detection
  const [savedState, setSavedState] = useState({ name: '', description: '', yaml: DEFAULT_YAML })
  const hasUnsavedChanges = useMemo(() => {
    return name !== savedState.name || 
           description !== savedState.description || 
           yamlContent !== savedState.yaml
  }, [name, description, yamlContent, savedState])
  
  // Version management state
  const [showSaveVersionModal, setShowSaveVersionModal] = useState(false)
  const [showRestoreVersionModal, setShowRestoreVersionModal] = useState(false)
  const [versionName, setVersionName] = useState('')
  const [versionDescription, setVersionDescription] = useState('')
  const [restoreName, setRestoreName] = useState('')
  const [restoreDescription, setRestoreDescription] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  
  // Hot edit state
  const [hotEditEnabled, setHotEditEnabled] = useState(false)
  const [previewConnected, setPreviewConnected] = useState(false)
  const hotEditChannelRef = useRef<HotEditChannel | null>(null)

  // Parse validation errors for clickable display
  const parsedValidationErrors = useMemo<ParsedValidationError[]>(() => {
    return validationErrors.map(parseValidationError)
  }, [validationErrors])

  // Handle clicking on a validation error to jump to it
  const handleErrorClick = (error: ParsedValidationError) => {
    if (editorRef.current) {
      editorRef.current.jumpToError(error)
    }
  }

  // Fetch existing experiment
  const { data: experiment, isLoading } = useQuery({
    queryKey: ['experiment', experimentId],
    queryFn: async () => {
      const response = await api.get(`/experiments/${experimentId}`)
      return response.data
    },
    enabled: !isNew,
  })

  // Fetch YAML for existing experiment
  const { data: yamlData } = useQuery({
    queryKey: ['experiment-yaml', experimentId],
    queryFn: async () => {
      const response = await api.get(`/experiments/${experimentId}/yaml`)
      return response.data
    },
    enabled: !isNew,
  })

  // Effect for experiment metadata (name, description) - runs when experiment data changes
  useEffect(() => {
    if (experiment) {
      setName(experiment.name)
      setDescription(experiment.description || '')
      setSavedState(prev => ({ 
        ...prev, 
        name: experiment.name, 
        description: experiment.description || '' 
      }))
    }
  }, [experiment])

  // Effect for YAML content - only runs when yamlData specifically changes
  // This prevents stale yamlData from overwriting local edits when experiment query is invalidated
  useEffect(() => {
    if (yamlData?.yaml) {
      setYamlContent(yamlData.yaml)
      setSavedState(prev => ({ ...prev, yaml: yamlData.yaml }))
    }
  }, [yamlData])

  // Warn about unsaved changes when closing/refreshing browser
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
        return e.returnValue
      }
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  // Hot edit channel management
  useEffect(() => {
    if (!hotEditEnabled || !experimentId || isNew) {
      // Close existing channel when hot edit is disabled
      if (hotEditChannelRef.current) {
        hotEditChannelRef.current.close()
        hotEditChannelRef.current = null
        setPreviewConnected(false)
      }
      return
    }

    // Create and open the channel
    const channel = createHotEditChannel(experimentId)
    channel.onPreviewConnected((connected) => {
      setPreviewConnected(connected)
    })
    
    // Set initial config
    try {
      const config = yaml.load(yamlContent) as Record<string, unknown>
      channel.setInitialConfig(config)
    } catch {
      // Invalid YAML, will send when valid
    }
    
    channel.open()
    hotEditChannelRef.current = channel

    return () => {
      channel.close()
      hotEditChannelRef.current = null
      setPreviewConnected(false)
    }
  }, [hotEditEnabled, experimentId, isNew])

  // Broadcast changes when hot edit is enabled
  useEffect(() => {
    if (!hotEditEnabled || !hotEditChannelRef.current) return

    try {
      const config = yaml.load(yamlContent) as Record<string, unknown>
      hotEditChannelRef.current.queueConfigUpdate(config)
    } catch {
      // Invalid YAML, skip update
    }
  }, [yamlContent, hotEditEnabled])

  // Handle opening preview in new tab
  const handleOpenPreview = useCallback(() => {
    if (!hotEditChannelRef.current) return
    // Use the channel's openPreview to manage the window reference
    hotEditChannelRef.current.openPreview()
  }, [])

  // Toggle hot edit mode
  const handleToggleHotEdit = useCallback(() => {
    setHotEditEnabled((prev) => !prev)
  }, [])

  // Validate mutation
  const validateMutation = useMutation({
    mutationFn: async () => {
      if (isNew) {
        // For new experiments, just try to create
        return { valid: true, errors: [] }
      }
      const response = await api.get(`/experiments/${experimentId}/validate`)
      return response.data
    },
  })

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) {
        const response = await api.post('/experiments', {
          name,
          description,
          config_yaml: yamlContent,
        })
        return response.data
      } else {
        const response = await api.patch(`/experiments/${experimentId}`, {
          name,
          description,
          config_yaml: yamlContent,
        })
        return response.data
      }
    },
    onSuccess: (data) => {
      // Navigate if experiment ID changed (new experiment or meta.id changed)
      if (data.experiment_id !== experimentId) {
        navigate(`/experiments/${data.experiment_id}`)
      }
    },
  })

  // Publish mutation
  const publishMutation = useMutation({
    mutationFn: async (expId: string) => {
      const response = await api.post(`/experiments/${expId}/publish`)
      return response.data
    },
    onSuccess: () => {
      // Refetch experiment data to update status without page reload
      queryClient.invalidateQueries({ queryKey: ['experiment', experimentId] })
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
    },
  })

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: async () => {
      const response = await api.patch(`/experiments/${experimentId}`, {
        status: 'archived',
      })
      return response.data
    },
    onSuccess: () => {
      // Refetch experiment data to update status without page reload
      queryClient.invalidateQueries({ queryKey: ['experiment', experimentId] })
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
    },
  })

  // Duplicate mutation
  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/experiments/${experimentId}/duplicate`)
      return response.data
    },
    onSuccess: (data) => {
      navigate(`/experiments/${data.experiment_id}`)
    },
  })
  
  // Fetch saved versions
  const { data: versions, refetch: refetchVersions } = useQuery({
    queryKey: ['experiment-versions', experimentId],
    queryFn: async () => {
      const response = await api.get(`/experiments/${experimentId}/versions`)
      return response.data as ExperimentVersion[]
    },
    enabled: !isNew && showRestoreVersionModal,
  })
  
  // Save version mutation
  const saveVersionMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/experiments/${experimentId}/versions`, {
        version_name: versionName,
        description: versionDescription || undefined,
      })
      return response.data
    },
    onSuccess: () => {
      setShowSaveVersionModal(false)
      setVersionName('')
      setVersionDescription('')
      alert('Version saved successfully!')
    },
  })
  
  // Restore version mutation
  const restoreVersionMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({
        name: restoreName,
        ...(restoreDescription && { description: restoreDescription }),
      })
      const response = await api.post(`/experiments/versions/${selectedVersionId}/restore?${params}`)
      return response.data
    },
    onSuccess: (data) => {
      setShowRestoreVersionModal(false)
      setSelectedVersionId(null)
      setRestoreName('')
      setRestoreDescription('')
      navigate(`/experiments/${data.experiment_id}`)
    },
  })
  
  
  // Export handler
  const handleExport = useCallback(async () => {
    try {
      const response = await api.get(`/experiments/${experimentId}/export`, {
        responseType: 'blob',
      })
      
      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers['content-disposition']
      let filename = `${name || 'experiment'}_export.yaml`
      if (contentDisposition) {
        const match = contentDisposition.match(/filename=(.+)/)
        if (match) {
          filename = match[1]
        }
      }
      
      // Create download link
      const blob = new Blob([response.data], { type: 'application/x-yaml' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      alert('Failed to export experiment')
      console.error('Export error:', error)
    }
  }, [experimentId, name])
  

  const experimentStatus = experiment?.status as 'draft' | 'published' | 'archived' | undefined
  const isPublished = experimentStatus === 'published'
  const isArchived = experimentStatus === 'archived'

  const handleSave = async () => {
    setIsSaving(true)
    setValidationErrors([])

    try {
      await saveMutation.mutateAsync()
      // Update saved state after successful save
      setSavedState({ name, description, yaml: yamlContent })
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string | { errors?: string[] } } } }
      if (err.response?.data?.detail) {
        const detail = err.response.data.detail
        if (typeof detail === 'object' && detail.errors) {
          setValidationErrors(detail.errors)
        } else {
          setValidationErrors([String(detail)])
        }
      } else {
        setValidationErrors(['Failed to save experiment'])
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleValidate = async () => {
    setValidationErrors([])
    try {
      const result = await validateMutation.mutateAsync()
      if (!result.valid) {
        setValidationErrors(result.errors)
      } else {
        alert('Configuration is valid!')
      }
    } catch {
      setValidationErrors(['Validation failed'])
    }
  }

  const handleSaveAndPublish = async () => {
    setIsSavingAndPublishing(true)
    setValidationErrors([])

    try {
      // First save the experiment
      let savedExperimentId = experimentId
      if (isNew) {
        const saveResult = await saveMutation.mutateAsync()
        savedExperimentId = saveResult.experiment_id
        // Update saved state after successful save
        setSavedState({ name, description, yaml: yamlContent })
      } else {
        await saveMutation.mutateAsync()
        // Update saved state after successful save
        setSavedState({ name, description, yaml: yamlContent })
      }

      // Then publish it
      await publishMutation.mutateAsync(savedExperimentId!)
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string | { errors?: string[] } } } }
      if (err.response?.data?.detail) {
        const detail = err.response.data.detail
        if (typeof detail === 'object' && detail.errors) {
          setValidationErrors(detail.errors)
        } else {
          setValidationErrors([String(detail)])
        }
      } else {
        setValidationErrors(['Failed to save and publish experiment'])
      }
    } finally {
      setIsSavingAndPublishing(false)
    }
  }

  if (!isNew && isLoading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Published experiment banner */}
      {isPublished && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LockIcon className="w-4 h-4 text-blue-600" />
            <span className="text-sm text-blue-800">
              <strong>Published experiment.</strong> To make changes, archive it first or create a copy.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (confirm('Are you sure you want to archive this experiment? It will no longer be available to participants.')) {
                  archiveMutation.mutate()
                }
              }}
              className="btn btn-sm bg-orange-100 text-orange-700 hover:bg-orange-200 border-orange-300"
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending ? 'Archiving...' : 'Archive to Edit'}
            </button>
            <button
              onClick={() => duplicateMutation.mutate()}
              className="btn btn-sm bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-300"
              disabled={duplicateMutation.isPending}
            >
              {duplicateMutation.isPending ? 'Creating...' : 'Create Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Archived experiment banner */}
      {isArchived && (
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArchiveIcon className="w-4 h-4 text-gray-600" />
            <span className="text-sm text-gray-700">
              <strong>Archived experiment.</strong> You can edit and republish it when ready.
            </span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-200">
        <div className="flex-1 max-w-md">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Experiment Name"
            className="input text-lg font-semibold"
            readOnly={isPublished}
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="input mt-2 text-sm"
            readOnly={isPublished}
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Hot Edit controls - only for existing experiments that are not published */}
          {!isNew && !isPublished && (
            <>
              <button
                onClick={handleToggleHotEdit}
                className={`btn flex items-center gap-1.5 ${
                  hotEditEnabled 
                    ? 'bg-green-100 text-green-700 hover:bg-green-200 border-green-300' 
                    : 'btn-secondary'
                }`}
                title={hotEditEnabled ? 'Disable hot edit mode' : 'Enable hot edit mode for live preview'}
              >
                <HotEditIcon className="w-4 h-4" />
                {hotEditEnabled ? 'Hot Edit On' : 'Hot Edit'}
                {hotEditEnabled && previewConnected && (
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" title="Preview connected" />
                )}
              </button>
              {hotEditEnabled && (
                <button
                  onClick={handleOpenPreview}
                  className="btn btn-secondary flex items-center gap-1.5"
                  title="Open preview in new tab"
                >
                  <ExternalLinkIcon className="w-4 h-4" />
                  Open Preview
                </button>
              )}
              <div className="w-px h-6 bg-gray-200" />
            </>
          )}
          
          {/* Export button - only for existing experiments */}
          {!isNew && (
            <button
              onClick={handleExport}
              className="btn btn-secondary flex items-center gap-1.5"
            >
              <DownloadIcon className="w-4 h-4" />
              Export YAML
            </button>
          )}
          
          {/* Version dropdown */}
          {!isNew && (
            <div className="relative group">
              <button className="btn btn-secondary flex items-center gap-1.5">
                <HistoryIcon className="w-4 h-4" />
                Versions
                <ChevronDownIcon className="w-3 h-3" />
              </button>
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[180px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150">
                <button
                  onClick={() => setShowSaveVersionModal(true)}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <SaveIcon className="w-4 h-4" />
                  Save Version
                </button>
                <button
                  onClick={() => {
                    setShowRestoreVersionModal(true)
                    refetchVersions()
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <RestoreIcon className="w-4 h-4" />
                  Restore Version
                </button>
              </div>
            </div>
          )}
          
          <div className="w-px h-6 bg-gray-200" />
          
          <button
            onClick={handleValidate}
            className="btn btn-secondary"
            disabled={validateMutation.isPending}
          >
            Validate
          </button>
          <button
            onClick={handleSave}
            className="btn btn-secondary"
            disabled={isSaving || isSavingAndPublishing || !name || isPublished}
            title={isPublished ? 'Archive the experiment first to enable editing' : undefined}
          >
            {isSaving ? 'Saving...' : 'Save'}
            {hasUnsavedChanges && !isSaving && !isPublished && (
              <span className="ml-1.5 w-2 h-2 bg-yellow-400 rounded-full" title="Unsaved changes" />
            )}
          </button>
          <button
            onClick={handleSaveAndPublish}
            className="btn btn-primary"
            disabled={isSaving || isSavingAndPublishing || !name || isPublished}
            title={isPublished ? 'Experiment is already published' : 'Save and publish the experiment'}
          >
            <PublishIcon className="w-4 h-4 mr-2" />
            {isSavingAndPublishing ? 'Publishing...' : 'Save & Publish'}
          </button>
        </div>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="my-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <h4 className="font-medium text-red-800 mb-2 flex items-center gap-2">
            <ErrorIcon className="w-4 h-4" />
            Validation Errors:
          </h4>
          <p className="text-xs text-red-600 mb-2">Click on an error to jump to the problem location</p>
          <ul className="text-sm text-red-700 space-y-1">
            {parsedValidationErrors.map((error, index) => (
              <li
                key={index}
                onClick={() => handleErrorClick(error)}
                className="validation-error-item flex items-start gap-2"
              >
                <JumpToIcon className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500" />
                <span>
                  {error.stageIndex !== null && (
                    <span className="font-semibold text-red-800">
                      Stage[{error.stageIndex}]
                      {error.fieldPath.length > 0 && `.${error.fieldPath.join('.')}`}:{' '}
                    </span>
                  )}
                  {error.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* View Mode Tabs */}
      <div className="mt-4 flex items-center gap-1 border-b border-gray-200">
        <button
          onClick={() => setViewMode('editor')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            viewMode === 'editor'
              ? 'bg-white border border-b-white border-gray-200 text-indigo-700 -mb-px'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="flex items-center gap-2">
            <EditorIcon className="w-4 h-4" />
            Editor
          </span>
        </button>
        <button
          onClick={() => setViewMode('paths')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            viewMode === 'paths'
              ? 'bg-white border border-b-white border-gray-200 text-indigo-700 -mb-px'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="flex items-center gap-2">
            <PathsIcon className="w-4 h-4" />
            Paths Preview
          </span>
        </button>
        <button
          onClick={() => setViewMode('simulation')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            viewMode === 'simulation'
              ? 'bg-white border border-b-white border-gray-200 text-indigo-700 -mb-px'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="flex items-center gap-2">
            <SimulationIcon className="w-4 h-4" />
            Simulation
          </span>
        </button>
      </div>

      {/* Editor with integrated GUI panel */}
      {viewMode === 'editor' && (
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col border border-gray-200 border-t-0 rounded-b-lg overflow-hidden">
            <StageTabsEditor
              ref={editorRef}
              yamlContent={yamlContent}
              onChange={setYamlContent}
              isReadOnly={isPublished}
              validationErrors={parsedValidationErrors}
              experimentId={isNew ? undefined : experimentId}
              showGuiEditor={true}
            />
          </div>
        </div>
      )}

      {/* Paths Preview */}
      {viewMode === 'paths' && (
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col border border-gray-200 border-t-0 rounded-b-lg overflow-hidden">
            {isNew ? (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <p>Save the experiment first to preview paths</p>
              </div>
            ) : (
              <PathsPreview 
                experimentId={experimentId!} 
                config={yamlContent ? yaml.load(yamlContent) as Record<string, unknown> : undefined}
              />
            )}
          </div>
        </div>
      )}

      {/* Simulation */}
      {viewMode === 'simulation' && (
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col border border-gray-200 border-t-0 rounded-b-lg overflow-hidden">
            {isNew ? (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <p>Save the experiment first to run simulations</p>
              </div>
            ) : (
              <PathsSimulation 
                experimentId={experimentId!} 
                config={yamlContent ? yaml.load(yamlContent) as Record<string, unknown> : undefined}
              />
            )}
          </div>
        </div>
      )}

      {/* Help text */}
      {viewMode === 'editor' && (
        <div className="mt-4 text-sm text-gray-500">
          <p>
            Edit stages individually using the tabs on the left. Use{' '}
            <code className="px-1 py-0.5 bg-gray-100 rounded">Ctrl+Space</code> for autocomplete suggestions.
          </p>
        </div>
      )}
      
      {/* Save Version Modal */}
      {showSaveVersionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSaveVersionModal(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <SaveIcon className="w-5 h-5 text-primary-600" />
              Save Version
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Save a named snapshot of the current experiment configuration. You can restore this version later.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Version Name *</label>
                <input
                  type="text"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  placeholder="e.g., Before adding video stage"
                  className="input w-full"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                <textarea
                  value={versionDescription}
                  onChange={(e) => setVersionDescription(e.target.value)}
                  placeholder="Add notes about this version..."
                  className="input w-full"
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowSaveVersionModal(false)
                  setVersionName('')
                  setVersionDescription('')
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => saveVersionMutation.mutate()}
                disabled={!versionName.trim() || saveVersionMutation.isPending}
                className="btn btn-primary"
              >
                {saveVersionMutation.isPending ? 'Saving...' : 'Save Version'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Restore Version Modal */}
      {showRestoreVersionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowRestoreVersionModal(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <RestoreIcon className="w-5 h-5 text-primary-600" />
              Restore Version
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Select a saved version to restore as a new experiment.
            </p>
            
            {/* Version list */}
            <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto mb-4">
              {!versions || versions.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  No saved versions found. Save a version first to be able to restore.
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {versions.map((version) => (
                    <label
                      key={version.id}
                      className={`flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                        selectedVersionId === version.id ? 'bg-primary-50' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="version"
                        checked={selectedVersionId === version.id}
                        onChange={() => {
                          setSelectedVersionId(version.id)
                          setRestoreName(`${name} (Restored: ${version.version_name})`)
                        }}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">{version.version_name}</div>
                        {version.description && (
                          <div className="text-sm text-gray-500 truncate">{version.description}</div>
                        )}
                        <div className="text-xs text-gray-400 mt-1">
                          {new Date(version.created_at).toLocaleString()}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            
            {/* Restore name input */}
            {selectedVersionId && (
              <div className="space-y-3 mb-4 p-3 bg-gray-50 rounded-lg">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Experiment Name *</label>
                  <input
                    type="text"
                    value={restoreName}
                    onChange={(e) => setRestoreName(e.target.value)}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                  <input
                    type="text"
                    value={restoreDescription}
                    onChange={(e) => setRestoreDescription(e.target.value)}
                    placeholder="Description for the restored experiment"
                    className="input w-full"
                  />
                </div>
              </div>
            )}
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowRestoreVersionModal(false)
                  setSelectedVersionId(null)
                  setRestoreName('')
                  setRestoreDescription('')
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => restoreVersionMutation.mutate()}
                disabled={!selectedVersionId || !restoreName.trim() || restoreVersionMutation.isPending}
                className="btn btn-primary"
              >
                {restoreVersionMutation.isPending ? 'Restoring...' : 'Restore as New Experiment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Icons
function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  )
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
      />
    </svg>
  )
}

function PublishIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
      />
    </svg>
  )
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function JumpToIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 7l5 5m0 0l-5 5m5-5H6"
      />
    </svg>
  )
}

function ChevronDownIcon({ className }: { className?: string }) {
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

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
  )
}


function HistoryIcon({ className }: { className?: string }) {
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

function SaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
      />
    </svg>
  )
}

function RestoreIcon({ className }: { className?: string }) {
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

function EditorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  )
}

function PathsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
      />
    </svg>
  )
}

function SimulationIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  )
}

function HotEditIcon({ className }: { className?: string }) {
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

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  )
}
