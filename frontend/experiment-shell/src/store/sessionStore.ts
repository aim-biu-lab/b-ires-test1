import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../lib/api'
import { eventQueue } from '../lib/eventQueue'

export interface StageConfig {
  id: string
  type: string
  label?: string
  // Top bar display - configurable per stage in YAML
  title?: string               // Main title shown in top bar
  description?: string         // Short description/instruction below title
  mandatory?: boolean
  questions?: QuestionConfig[]
  fields?: FieldConfig[]
  content?: string
  content_type?: string
  source?: string
  config?: Record<string, unknown>
  timing?: TimingConfig
  layout?: LayoutConfig        // Layout and positioning settings
  [key: string]: unknown
}

export interface QuestionConfig {
  id: string
  text: string
  type: string
  required?: boolean
  options?: { value: string; label: string }[]
  validation?: string
  validation_message?: string
  range?: [number, number]
  [key: string]: unknown
}

export interface FieldConfig {
  field: string
  label: string
  type: string
  required?: boolean
  options?: { value: string; label: string }[]
  validation?: string
  validation_message?: string
  min?: number
  max?: number
  // Layout properties for row-based arrangement
  row?: number               // Group fields with same row number together
  width?: 'full' | 'half' | 'third' | 'quarter' | 'two-thirds'  // Column width
  placeholder?: string       // Placeholder text for inputs
  helpText?: string          // Helper text displayed below the field
  headerText?: string        // Header/title text displayed above the field
  // Consent checkbox specific
  consentContent?: string    // HTML content to display in the consent popup
  consentLinkText?: string   // Text for the consent link (e.g., "consent form")
  // Participant identity specific
  enabled?: boolean          // Whether field is shown (default: true)
  include_in_label?: boolean // Include in participant label (default: false)
}

export interface TimingConfig {
  min_duration_ms?: number
  max_duration_ms?: number
  show_timer?: boolean
  show_elapsed_time?: boolean
  on_timeout?: string
}

export interface LayoutConfig {
  // Width settings
  width?: string               // e.g., "600px", "80%", "100%"
  max_width?: string           // e.g., "800px", "100%"
  min_width?: string           // e.g., "300px"
  // Horizontal alignment
  align_horizontal?: 'left' | 'center' | 'right'
  // Vertical alignment
  align_vertical?: 'top' | 'upper-third' | 'middle' | 'lower-third' | 'bottom'
  // Spacing
  margin_top?: string          // e.g., "20px", "5%", "2rem"
  padding?: string             // e.g., "20px", "1rem 2rem"
}

export interface NavigationBarConfig {
  position?: 'top' | 'bottom'
  show_header_placeholder?: boolean
}

export interface ShellConfig {
  theme?: string
  navigation_bar?: NavigationBarConfig
  progress?: {
    show_progress_bar?: boolean
    show_counter?: boolean
    show_percentage?: boolean
  }
  sidebar?: {
    enabled?: boolean
    allow_navigation?: boolean
  }
  logo_url?: string
  custom_css?: string
  [key: string]: unknown
}

// Meta config from experiment YAML
export interface ExperimentMeta {
  id: string
  version?: string
  name?: string
  description?: string
  debug_mode?: boolean
}

export interface Progress {
  current: number
  total: number
  percentage: number
}

// Hierarchical path tracking
export interface HierarchyPath {
  phaseId?: string
  stageId?: string
  blockId?: string
  taskId?: string
}

// Assignment record for balanced/weighted distribution
export interface AssignmentRecord {
  levelId: string
  assignedChildId: string
  orderingMode: string
  timestamp: string
  reason?: string
}

export type SessionStatusType = 'active' | 'completed' | 'abandoned' | 'timed_out' | 'pending_resume' | 'preview' | null

export interface InvalidationPreview {
  targetStageId: string
  invalidatedStages: string[]
}

// Locked items that participant cannot return to
export interface LockedItems {
  phases: string[]
  stages: string[]
  blocks: string[]
  tasks: string[]
}

export interface SessionState {
  // Session data
  sessionId: string | null
  experimentId: string | null
  userId: string | null
  sessionStatus: SessionStatusType
  shellConfig: ShellConfig | null
  debugMode: boolean  // Whether debug features are enabled for this experiment

  // Stage state
  currentStage: StageConfig | null
  currentSubstepIndex: number
  visibleStages: StageConfig[]
  completedStageIds: string[]
  progress: Progress

  // Hierarchical state (4-level structure)
  currentPath: HierarchyPath | null
  assignments: Record<string, string>  // level_id -> assigned_child_id
  assignmentHistory: AssignmentRecord[]
  randomizationSeed: number | null

  // Reference/jump state
  returnStageId: string | null
  returnStageLabel: string | null
  isOnReferenceStage: boolean

  // Invalidation preview state
  pendingInvalidation: InvalidationPreview | null

  // Navigation lock state
  lockedItems: LockedItems

  // UI state
  isLoading: boolean
  isSubmitting: boolean
  isOffline: boolean
  isSyncing: boolean
  pendingSubmissions: number
  error: string | null
  syncError: string | null

  // Preview mode state (hot edit)
  previewMode: boolean
  previewConfig: Record<string, unknown> | null
  pendingRefresh: boolean

  // Stage data (user inputs)
  stageData: Record<string, Record<string, unknown>>
  // Submitted stage data (what was actually submitted to server)
  submittedStageData: Record<string, Record<string, unknown>>

  // Actions
  startSession: (experimentId: string, urlParams?: Record<string, string>) => Promise<void>
  submitStage: (stageId: string, data: Record<string, unknown>) => Promise<void>
  jumpToStage: (stageId: string) => Promise<void>
  previewJumpInvalidation: (stageId: string) => Promise<string[]>
  confirmJumpWithInvalidation: () => Promise<void>
  cancelJumpWithInvalidation: () => void
  returnFromJump: () => Promise<void>
  recoverSession: (sessionId: string) => Promise<void>
  checkExistingSession: (experimentId: string) => Promise<void>
  confirmResumeSession: () => void
  startNewSession: (experimentId: string, urlParams?: Record<string, string>) => Promise<void>
  syncPendingSubmissions: () => Promise<void>

  setOnlineStatus: (isOnline: boolean) => void
  setStageData: (stageId: string, fieldId: string, value: unknown) => void
  clearError: () => void
  clearSyncError: () => void
  reset: () => void
  
  // Helper to check if current stage data differs from submitted data
  hasStageDataChanged: (stageId: string) => boolean
  // Check if stage needs submission (not completed OR data changed)
  stageNeedsSubmission: (stageId: string) => boolean
  
  // Check if a stage is locked (cannot be returned to)
  isStageLockedForReturn: (stageId: string) => boolean

  // Preview mode actions (hot edit)
  initPreviewMode: (experimentId: string, config: Record<string, unknown>) => void
  updatePreviewConfig: (config: Record<string, unknown>, isStructuralChange: boolean) => void
  setPendingRefresh: (pending: boolean) => void
  exitPreviewMode: () => void
  /** Unsubmit a stage (preview mode only) - removes from completed and clears data */
  unsubmitStage: (stageId: string) => void
  /** Reset preview session completely - clears all data and restarts from first stage */
  resetPreviewSession: () => Promise<void>
}

/**
 * Helper function to extract flattened stages from experiment config
 * Handles both hierarchical (phases > stages > blocks > tasks) and flat (stages) structures
 * Adds hierarchy metadata (_phase_id, _stage_id, _block_id, etc.) to each task for sidebar display
 */
function extractStagesFromConfig(config: Record<string, unknown>): StageConfig[] {
  const result: StageConfig[] = []

  // Check hierarchical structure (phases > stages > blocks > tasks)
  const phases = config.phases as Array<Record<string, unknown>> | undefined
  if (phases && phases.length > 0) {
    for (const phase of phases) {
      const phaseId = phase.id as string | undefined
      const phaseUiSettings = (phase.ui_settings || {}) as Record<string, unknown>
      const phaseLabel = (phaseUiSettings.label as string) || (phase.label as string) || phaseId || ''
      const phaseCollapsedByDefault = phaseUiSettings.collapsed_by_default as boolean || false
      const phaseShowInSidebar = phaseUiSettings.show_in_sidebar !== false

      const stages = phase.stages as Array<Record<string, unknown>> | undefined
      if (stages) {
        for (const stage of stages) {
          const stageId = stage.id as string | undefined
          const stageUiSettings = (stage.ui_settings || {}) as Record<string, unknown>
          const stageLabel = (stageUiSettings.label as string) || (stage.label as string) || stageId || ''
          const stageCollapsedByDefault = stageUiSettings.collapsed_by_default as boolean || false
          const stageShowInSidebar = stageUiSettings.show_in_sidebar !== false

          const blocks = stage.blocks as Array<Record<string, unknown>> | undefined
          if (blocks) {
            for (const block of blocks) {
              const blockId = block.id as string | undefined
              const blockUiSettings = (block.ui_settings || {}) as Record<string, unknown>
              const blockLabel = (blockUiSettings.label as string) || (block.label as string) || blockId || ''
              const blockCollapsedByDefault = blockUiSettings.collapsed_by_default as boolean || false
              const blockShowInSidebar = blockUiSettings.show_in_sidebar !== false

              const tasks = block.tasks as Array<Record<string, unknown>> | undefined
              if (tasks) {
                for (const task of tasks) {
                  // Add hierarchy metadata to each task
                  const taskWithMetadata = {
                    ...task,
                    _phase_id: phaseId,
                    _phase_label: phaseLabel,
                    _phase_collapsed_by_default: phaseCollapsedByDefault,
                    _phase_show_in_sidebar: phaseShowInSidebar,
                    _stage_id: stageId,
                    _stage_label: stageLabel,
                    _stage_collapsed_by_default: stageCollapsedByDefault,
                    _stage_show_in_sidebar: stageShowInSidebar,
                    _block_id: blockId,
                    _block_label: blockLabel,
                    _block_collapsed_by_default: blockCollapsedByDefault,
                    _block_show_in_sidebar: blockShowInSidebar,
                  }
                  result.push(taskWithMetadata as unknown as StageConfig)
                }
              } else {
                // Block without tasks - add the block itself with hierarchy metadata
                const blockWithMetadata = {
                  ...block,
                  _phase_id: phaseId,
                  _phase_label: phaseLabel,
                  _phase_collapsed_by_default: phaseCollapsedByDefault,
                  _phase_show_in_sidebar: phaseShowInSidebar,
                  _stage_id: stageId,
                  _stage_label: stageLabel,
                  _stage_collapsed_by_default: stageCollapsedByDefault,
                  _stage_show_in_sidebar: stageShowInSidebar,
                  _block_id: blockId,
                  _block_label: blockLabel,
                  _block_collapsed_by_default: blockCollapsedByDefault,
                  _block_show_in_sidebar: blockShowInSidebar,
                }
                result.push(blockWithMetadata as unknown as StageConfig)
              }
            }
          } else {
            // Stage without blocks - add the stage itself with hierarchy metadata
            const stageWithMetadata = {
              ...stage,
              _phase_id: phaseId,
              _phase_label: phaseLabel,
              _phase_collapsed_by_default: phaseCollapsedByDefault,
              _phase_show_in_sidebar: phaseShowInSidebar,
              _stage_id: stageId,
              _stage_label: stageLabel,
              _stage_collapsed_by_default: stageCollapsedByDefault,
              _stage_show_in_sidebar: stageShowInSidebar,
            }
            result.push(stageWithMetadata as unknown as StageConfig)
          }
        }
      }
    }
    return result
  }

  // Check flat stages structure
  const stages = config.stages as Array<Record<string, unknown>> | undefined
  if (stages) {
    result.push(...(stages as StageConfig[]))
  }

  return result
}

const initialState = {
  sessionId: null,
  experimentId: null,
  userId: null,
  sessionStatus: null as SessionStatusType,
  shellConfig: null as ShellConfig | null,
  debugMode: false,
  currentStage: null,
  currentSubstepIndex: 0,
  visibleStages: [],
  completedStageIds: [],
  progress: { current: 0, total: 0, percentage: 0 },
  // Hierarchical state
  currentPath: null as HierarchyPath | null,
  assignments: {} as Record<string, string>,
  assignmentHistory: [] as AssignmentRecord[],
  randomizationSeed: null as number | null,
  // Jump state
  returnStageId: null,
  returnStageLabel: null,
  isOnReferenceStage: false,
  pendingInvalidation: null,
  // Navigation lock state
  lockedItems: { phases: [], stages: [], blocks: [], tasks: [] },
  isLoading: false,
  isSubmitting: false,
  isOffline: false,
  isSyncing: false,
  pendingSubmissions: 0,
  error: null,
  syncError: null,
  stageData: {},
  submittedStageData: {},
  // Preview mode state
  previewMode: false,
  previewConfig: null,
  pendingRefresh: false,
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      ...initialState,

      startSession: async (experimentId: string, urlParams?: Record<string, string>) => {
        set({ isLoading: true, error: null })
        
        try {
          const response = await api.post('/sessions/start', {
            experiment_id: experimentId,
            url_params: urlParams || {},
            user_agent: navigator.userAgent,
            screen_size: `${window.innerWidth}x${window.innerHeight}`,
          })

          const { 
            session_id, 
            experiment_id, 
            current_stage, 
            visible_stages, 
            progress, 
            shell_config,
            assignments,
            randomization_seed,
            debug_mode,
          } = response.data

          set({
            sessionId: session_id,
            experimentId: experiment_id,
            sessionStatus: 'active',
            shellConfig: shell_config || null,
            debugMode: debug_mode || false,
            currentStage: current_stage,
            visibleStages: visible_stages,
            progress,
            completedStageIds: [],
            // Hierarchical state
            assignments: assignments || {},
            randomizationSeed: randomization_seed || null,
            isLoading: false,
          })

          // Log session start event
          eventQueue.addEvent({
            sessionId: session_id,
            eventType: 'session_start',
            stageId: current_stage?.id || 'unknown',
            payload: { urlParams },
          })

        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Failed to start session'
          set({ error: message, isLoading: false })
        }
      },

      submitStage: async (stageId: string, data: Record<string, unknown>) => {
        const { sessionId, isOffline, previewMode, visibleStages, completedStageIds } = get()
        if (!sessionId) return

        // Handle preview mode - navigate locally without API calls
        if (previewMode) {
          set({ isSubmitting: true })
          
          // Find current stage index
          const currentIndex = visibleStages.findIndex(s => s.id === stageId)
          const nextIndex = currentIndex + 1
          
          // Check if this is the last stage
          if (nextIndex >= visibleStages.length) {
            // Show completion in preview mode
            set({
              isSubmitting: false,
              currentStage: null,
              sessionStatus: 'completed',
              completedStageIds: [...completedStageIds, stageId],
              progress: { current: visibleStages.length, total: visibleStages.length, percentage: 100 },
            })
            return
          }
          
          // Move to next stage
          const nextStage = visibleStages[nextIndex]
          set({
            isSubmitting: false,
            currentStage: nextStage,
            completedStageIds: [...completedStageIds, stageId],
            progress: { 
              current: nextIndex + 1, 
              total: visibleStages.length, 
              percentage: Math.round(((nextIndex + 1) / visibleStages.length) * 100) 
            },
          })
          return
        }

        set({ isSubmitting: true, error: null })

        // Log submission event
        eventQueue.addEvent({
          sessionId,
          eventType: 'stage_submit',
          stageId,
          payload: data,
        })

        if (isOffline) {
          // Queue submission for later sync
          await eventQueue.queueSubmission({
            sessionId,
            stageId,
            data,
          })

          // Update pending count
          const status = await eventQueue.getSubmissionStatus(sessionId)
          set({
            isSubmitting: false,
            pendingSubmissions: status.pending,
            error: 'You are offline. Your response has been saved and will sync when you reconnect.',
          })
          return
        }

        try {
          const response = await api.post(`/sessions/${sessionId}/submit`, {
            stage_id: stageId,
            data,
          })

          const { 
            next_stage, 
            visible_stages, 
            completed_stage_ids, 
            progress, 
            is_complete,
            assignments: newAssignments,
            locked_items,
          } = response.data

          if (is_complete) {
            // Experiment complete - redirect to completion page
            window.location.href = '/complete'
            return
          }

          // Save submitted data for tracking changes
          const { submittedStageData, stageData, assignments } = get()
          set({
            currentStage: next_stage,
            visibleStages: visible_stages,
            completedStageIds: completed_stage_ids,
            progress,
            isSubmitting: false,
            // Clear reference state when submitting a stage
            returnStageId: null,
            returnStageLabel: null,
            isOnReferenceStage: false,
            // Update assignments if new ones were made
            assignments: newAssignments ? { ...assignments, ...newAssignments } : assignments,
            // Update locked items
            lockedItems: locked_items || { phases: [], stages: [], blocks: [], tasks: [] },
            // Save submitted data
            submittedStageData: {
              ...submittedStageData,
              [stageId]: { ...data },
            },
            // Mark the stage as submitted in stageData so UI reflects correctly
            stageData: {
              ...stageData,
              [stageId]: {
                ...stageData[stageId],
                _submitted: true,
              },
            },
          })
        } catch (error: unknown) {
          // If network error, queue for retry
          if (
            error instanceof Error &&
            (error.message.includes('Network error') || error.message.includes('network'))
          ) {
            await eventQueue.queueSubmission({
              sessionId,
              stageId,
              data,
            })

            const status = await eventQueue.getSubmissionStatus(sessionId)
            set({
              isSubmitting: false,
              pendingSubmissions: status.pending,
              isOffline: true,
              error:
                'Network error. Your response has been saved and will sync when you reconnect.',
            })
            return
          }

          const message = error instanceof Error ? error.message : 'Failed to submit stage'
          set({ error: message, isSubmitting: false })
        }
      },

      jumpToStage: async (stageId: string) => {
        const { sessionId, currentStage, previewMode, visibleStages } = get()
        if (!sessionId) return

        // Handle preview mode - navigate locally without API calls
        if (previewMode) {
          const targetStage = visibleStages.find(s => s.id === stageId)
          if (targetStage) {
            const targetIndex = visibleStages.findIndex(s => s.id === stageId)
            set({
              currentStage: targetStage,
              progress: {
                current: targetIndex + 1,
                total: visibleStages.length,
                percentage: Math.round(((targetIndex + 1) / visibleStages.length) * 100),
              },
            })
          }
          return
        }

        set({ isLoading: true, error: null })

        try {
          const response = await api.post(`/sessions/${sessionId}/jump`, {
            target_stage_id: stageId,
          })

          const { current_stage, return_stage_id, is_reference, invalidated_stages, locked_items } = response.data

          set({
            currentStage: current_stage,
            isLoading: false,
            // Track reference jump state
            returnStageId: is_reference ? return_stage_id : null,
            returnStageLabel: is_reference ? currentStage?.label || `Stage ${return_stage_id}` : null,
            isOnReferenceStage: is_reference || false,
            pendingInvalidation: null,
            // Update locked items
            lockedItems: locked_items || { phases: [], stages: [], blocks: [], tasks: [] },
          })

          if (invalidated_stages?.length) {
            // Remove invalidated stage data
            const { stageData, submittedStageData } = get()
            const newStageData = { ...stageData }
            const newSubmittedStageData = { ...submittedStageData }
            for (const id of invalidated_stages) {
              delete newStageData[id]
              delete newSubmittedStageData[id]
            }
            set({ stageData: newStageData, submittedStageData: newSubmittedStageData })
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Failed to jump to stage'
          set({ error: message, isLoading: false })
        }
      },

      previewJumpInvalidation: async (stageId: string): Promise<string[]> => {
        const { sessionId, completedStageIds, visibleStages } = get()
        if (!sessionId) return []

        // Find the target stage index
        const targetIndex = visibleStages.findIndex((s) => s.id === stageId)
        if (targetIndex === -1) return []

        // Stage types that don't have user responses to invalidate
        const NON_RESPONSE_STAGE_TYPES = ['video_player', 'content_display']

        // Find all completed stages after the target stage that would be invalidated
        // Exclude non-response stages (video, content display) since they don't have user data
        const invalidatedStages: string[] = []
        for (let i = targetIndex + 1; i < visibleStages.length; i++) {
          const stage = visibleStages[i]
          if (completedStageIds.includes(stage.id) && !NON_RESPONSE_STAGE_TYPES.includes(stage.type)) {
            invalidatedStages.push(stage.id)
          }
        }

        return invalidatedStages
      },

      confirmJumpWithInvalidation: async () => {
        const { pendingInvalidation } = get()
        if (!pendingInvalidation) return

        // Perform the actual jump
        await get().jumpToStage(pendingInvalidation.targetStageId)
      },

      cancelJumpWithInvalidation: () => {
        set({ pendingInvalidation: null })
      },

      returnFromJump: async () => {
        const { sessionId } = get()
        if (!sessionId) return

        set({ isLoading: true, error: null })

        try {
          await api.post(`/sessions/${sessionId}/return`)

          // Clear reference state
          set({
            returnStageId: null,
            returnStageLabel: null,
            isOnReferenceStage: false,
          })

          // Recover session to get current stage
          await get().recoverSession(sessionId)
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Failed to return from jump'
          set({ error: message, isLoading: false })
        }
      },

      recoverSession: async (sessionId: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await api.get(`/sessions/${sessionId}/state`)

          const {
            status,
            current_stage,
            visible_stages,
            completed_stage_ids,
            progress,
            data,
            shell_config,
            locked_items,
            debug_mode,
          } = response.data

          // Mark all completed stages as _submitted in stageData
          const restoredStageData = { ...(data || {}) }
          for (const stageId of (completed_stage_ids || [])) {
            if (restoredStageData[stageId]) {
              restoredStageData[stageId] = {
                ...restoredStageData[stageId],
                _submitted: true,
              }
            } else {
              restoredStageData[stageId] = { _submitted: true }
            }
          }

          // Handle completed session
          if (status === 'completed') {
            set({
              sessionId,
              sessionStatus: 'completed',
              shellConfig: shell_config || null,
              debugMode: debug_mode || false,
              currentStage: null,
              visibleStages: [],
              completedStageIds: completed_stage_ids || [],
              progress: progress || { current: 100, total: 100, percentage: 100 },
              stageData: restoredStageData,
              submittedStageData: restoredStageData,
              lockedItems: locked_items || { phases: [], stages: [], blocks: [], tasks: [] },
              isLoading: false,
            })
            return
          }

          // Handle active session - show resume dialog
          if (status === 'active' && current_stage) {
            set({
              sessionId,
              sessionStatus: 'pending_resume',
              shellConfig: shell_config || null,
              debugMode: debug_mode || false,
              currentStage: current_stage,
              visibleStages: visible_stages,
              completedStageIds: completed_stage_ids,
              progress,
              stageData: restoredStageData,
              submittedStageData: restoredStageData,
              lockedItems: locked_items || { phases: [], stages: [], blocks: [], tasks: [] },
              isLoading: false,
            })
            return
          }

          // For other statuses (abandoned, timed_out), clear session and start fresh
          set({
            sessionId: null,
            sessionStatus: null,
            isLoading: false,
          })

        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Failed to recover session'
          set({ error: message, isLoading: false, sessionId: null, sessionStatus: null })
        }
      },

      checkExistingSession: async (_experimentId: string) => {
        const { sessionId } = get()
        
        if (sessionId) {
          // Try to recover the existing session
          await get().recoverSession(sessionId)
        } else {
          // No existing session
          set({ sessionStatus: null })
        }
      },

      confirmResumeSession: () => {
        // User chose to resume - just update status to active
        set({ sessionStatus: 'active' })
      },

      startNewSession: async (experimentId: string, urlParams?: Record<string, string>) => {
        // Clear existing session and start fresh
        set({ 
          sessionId: null,
          sessionStatus: null,
          shellConfig: null,
          currentStage: null,
          visibleStages: [],
          completedStageIds: [],
          progress: { current: 0, total: 0, percentage: 0 },
          stageData: {},
        })
        
        // Start new session
        await get().startSession(experimentId, urlParams)
      },

      setOnlineStatus: (isOnline: boolean) => {
        const wasOffline = get().isOffline
        set({ isOffline: !isOnline })

        // If coming back online, sync queued events and submissions
        if (wasOffline && isOnline) {
          eventQueue.syncEvents()
          get().syncPendingSubmissions()
        }
      },

      syncPendingSubmissions: async () => {
        const { sessionId, isSyncing } = get()
        if (!sessionId || isSyncing) return

        set({ isSyncing: true, syncError: null })

        try {
          const result = await eventQueue.syncPendingSubmissions(
            async (sid, stageId, data) => {
              const response = await api.post(`/sessions/${sid}/submit`, {
                stage_id: stageId,
                data,
              })

              const {
                next_stage,
                visible_stages,
                completed_stage_ids,
                progress,
                is_complete,
              } = response.data

              if (is_complete) {
                window.location.href = '/complete'
                return
              }

              // Update state with latest from server
              set({
                currentStage: next_stage,
                visibleStages: visible_stages,
                completedStageIds: completed_stage_ids,
                progress,
              })
            }
          )

          // Update pending count
          const status = await eventQueue.getSubmissionStatus(sessionId)
          set({
            isSyncing: false,
            pendingSubmissions: status.pending,
            syncError: status.lastError,
          })

          if (result.failed > 0) {
            set({
              syncError: `${result.failed} submission(s) failed to sync. Please try again.`,
            })
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Failed to sync submissions'
          set({ syncError: message, isSyncing: false })
        }
      },

      setStageData: (stageId: string, fieldId: string, value: unknown) => {
        const { stageData } = get()
        set({
          stageData: {
            ...stageData,
            [stageId]: {
              ...stageData[stageId],
              [fieldId]: value,
            },
          },
        })
      },

      clearError: () => set({ error: null }),

      clearSyncError: () => set({ syncError: null }),

      reset: () => set(initialState),

      hasStageDataChanged: (stageId: string): boolean => {
        const { stageData, submittedStageData } = get()
        const current = stageData[stageId] || {}
        const submitted = submittedStageData[stageId] || {}
        
        // Filter out internal fields (starting with _) for comparison
        const filterInternalFields = (data: Record<string, unknown>) => {
          const filtered: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(data)) {
            if (!key.startsWith('_')) {
              filtered[key] = value
            }
          }
          return filtered
        }
        
        const currentFiltered = filterInternalFields(current)
        const submittedFiltered = filterInternalFields(submitted)
        
        return JSON.stringify(currentFiltered) !== JSON.stringify(submittedFiltered)
      },

      stageNeedsSubmission: (stageId: string): boolean => {
        const { completedStageIds } = get()
        
        // If stage not completed, needs submission
        if (!completedStageIds.includes(stageId)) {
          return true
        }
        
        // If stage completed but data changed, needs re-submission
        return get().hasStageDataChanged(stageId)
      },

      isStageLockedForReturn: (stageId: string): boolean => {
        const { lockedItems } = get()
        
        // Check if stage itself is locked
        if (lockedItems.stages.includes(stageId)) {
          return true
        }
        
        // Check if it's a task that's locked
        if (lockedItems.tasks.includes(stageId)) {
          return true
        }
        
        return false
      },

      // Preview mode actions
      initPreviewMode: (experimentId: string, config: Record<string, unknown>) => {
        // Extract stages from config
        const stages = extractStagesFromConfig(config)
        const firstStage = stages[0] || null
        const shellConfig = (config.shell_config as ShellConfig) || null
        const meta = config.meta as ExperimentMeta | undefined
        const debugMode = meta?.debug_mode || false

        set({
          previewMode: true,
          previewConfig: config,
          experimentId,
          sessionId: `preview-${experimentId}`,
          sessionStatus: 'preview',
          shellConfig,
          debugMode,
          currentStage: firstStage,
          visibleStages: stages,
          completedStageIds: [],
          progress: { current: 1, total: stages.length, percentage: stages.length > 0 ? Math.round((1 / stages.length) * 100) : 0 },
          isLoading: false,
          pendingRefresh: false,
        })
      },

      updatePreviewConfig: (config: Record<string, unknown>, isStructuralChange: boolean) => {
        const { previewMode, currentStage } = get()
        if (!previewMode) return

        if (isStructuralChange) {
          // Structural change - set pending refresh flag
          set({ 
            previewConfig: config,
            pendingRefresh: true,
          })
        } else {
          // Content change - update live
          const stages = extractStagesFromConfig(config)
          const shellConfig = (config.shell_config as ShellConfig) || null
          
          // Find the updated current stage by ID
          const currentStageId = currentStage?.id
          const updatedCurrentStage = currentStageId 
            ? stages.find(s => s.id === currentStageId) || stages[0]
            : stages[0]

          set({
            previewConfig: config,
            shellConfig,
            currentStage: updatedCurrentStage || null,
            visibleStages: stages,
            progress: { 
              current: currentStageId ? Math.max(1, stages.findIndex(s => s.id === currentStageId) + 1) : 1, 
              total: stages.length, 
              percentage: stages.length > 0 ? Math.round((1 / stages.length) * 100) : 0 
            },
          })
        }
      },

      setPendingRefresh: (pending: boolean) => {
        set({ pendingRefresh: pending })
      },

      exitPreviewMode: () => {
        set({
          previewMode: false,
          previewConfig: null,
          pendingRefresh: false,
          sessionId: null,
          sessionStatus: null,
          experimentId: null,
          currentStage: null,
          visibleStages: [],
          shellConfig: null,
        })
      },

      unsubmitStage: (stageId: string) => {
        const { previewMode, completedStageIds, stageData, submittedStageData, visibleStages } = get()
        
        // Only works in preview mode
        if (!previewMode) return
        
        // Remove from completed stages
        const newCompletedStageIds = completedStageIds.filter(id => id !== stageId)
        
        // Clear stage data
        const newStageData = { ...stageData }
        delete newStageData[stageId]
        
        const newSubmittedStageData = { ...submittedStageData }
        delete newSubmittedStageData[stageId]
        
        // Find the stage and set it as current
        const targetStage = visibleStages.find(s => s.id === stageId)
        const targetIndex = visibleStages.findIndex(s => s.id === stageId)
        
        // First set currentStage to null to force unmount
        set({ currentStage: null })
        
        // Then set the new state with a fresh copy of the target stage to force re-render
        // Use setTimeout to ensure React processes the null state first
        setTimeout(() => {
          set({
            completedStageIds: newCompletedStageIds,
            stageData: newStageData,
            submittedStageData: newSubmittedStageData,
            // Create a new object reference to ensure re-render
            currentStage: targetStage ? { ...targetStage } : null,
            progress: {
              current: targetIndex + 1,
              total: visibleStages.length,
              percentage: visibleStages.length > 0 ? Math.round(((targetIndex + 1) / visibleStages.length) * 100) : 0,
            },
          })
        }, 0)
      },

      resetPreviewSession: async () => {
        const { previewMode, previewConfig, experimentId, sessionId, visibleStages } = get()
        
        // Only works in preview mode
        if (!previewMode || !previewConfig || !experimentId) return
        
        // Clear event queue data for this session
        if (sessionId) {
          const { eventQueue } = await import('../lib/eventQueue')
          await eventQueue.clearSessionData(sessionId)
        }
        
        // Get the first stage
        const firstStage = visibleStages[0] || null
        
        // Reset all session state while keeping preview mode active
        set({
          // Keep preview mode active
          previewMode: true,
          previewConfig: previewConfig,
          experimentId: experimentId,
          sessionId: `preview-${experimentId}`,
          sessionStatus: 'preview',
          // Reset to first stage
          currentStage: firstStage,
          // Clear all progress
          completedStageIds: [],
          stageData: {},
          submittedStageData: {},
          progress: {
            current: 1,
            total: visibleStages.length,
            percentage: visibleStages.length > 0 ? Math.round((1 / visibleStages.length) * 100) : 0,
          },
          // Clear other state
          pendingRefresh: false,
          isOnReferenceStage: false,
          returnStageId: null,
          returnStageLabel: null,
          pendingInvalidation: null,
          error: null,
        })
        
        // Clear the persisted storage for this session
        try {
          localStorage.removeItem('bires-session')
        } catch {
          // Ignore errors
        }
      },
    }),
    {
      name: 'bires-session',
      partialize: (state) => ({
        sessionId: state.sessionId,
        experimentId: state.experimentId,
        stageData: state.stageData,
        submittedStageData: state.submittedStageData,
        completedStageIds: state.completedStageIds,
        // Persist hierarchical state for recovery
        assignments: state.assignments,
        randomizationSeed: state.randomizationSeed,
      }),
    }
  )
)

