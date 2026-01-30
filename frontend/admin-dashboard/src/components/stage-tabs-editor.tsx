import { useState, useMemo, useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import Editor, { Monaco } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import yaml from 'js-yaml'
import { toast } from 'sonner'
import { registerBiresYamlSchema, STAGE_TYPES } from '../lib/yaml-schema'
import { EditorToolbar } from './editor-toolbar'
import { findLineInYaml, ParsedValidationError } from '../lib/validation-error-parser'
import { StageGuiEditor, SettingsGuiEditor, HierarchyTreeEditor, HierarchyItemEditor } from './gui-editor'
import type { HierarchyChild, VariableInfo } from './gui-editor'
import { useGuiYamlSync } from '../lib/use-gui-yaml-sync'
import { extractVariablesBeforeItem } from '../lib/variable-context'
import { api } from '../lib/api'
import { generateSmartId, generateSmartLabel, DuplicationSource } from '../lib/duplication-utils'
import { RefactorModal } from './gui-editor/refactor-modal'
import { applyRefactorRules, RefactorRules } from '../lib/refactor-utils'

interface Stage {
  id: string
  type: string
  label?: string
  [key: string]: unknown
}

interface ParsedConfig {
  meta?: Record<string, unknown>
  shell_config?: Record<string, unknown>
  stages?: Stage[]
  phases?: HierarchyPhase[]
  public_variables?: Record<string, unknown>
  [key: string]: unknown
}

// Hierarchy types for 4-level structure
interface HierarchyPhase {
  id: string
  label?: string
  title?: string
  rules?: HierarchyRules
  ui_settings?: HierarchyUISettings
  stages?: HierarchyStage[]
}

interface HierarchyStage {
  id: string
  label?: string
  title?: string
  type?: string
  rules?: HierarchyRules
  ui_settings?: HierarchyUISettings
  blocks?: HierarchyBlock[]
}

interface HierarchyBlock {
  id: string
  label?: string
  title?: string
  rules?: HierarchyRules
  ui_settings?: HierarchyUISettings
  tasks?: Stage[]
}

interface HierarchyRules {
  ordering?: string
  visibility?: string
  balance_on?: string
  weights?: { id: string; value: number }[]
  quota?: number
}

interface HierarchyUISettings {
  visible_to_participant?: boolean
  show_in_sidebar?: boolean
  label?: string
  collapsed_by_default?: boolean
}

// Convert parsed phases to HierarchyTreeEditor format
interface TreeHierarchyItem {
  id: string
  type: 'phase' | 'stage' | 'block' | 'task'
  label?: string
  title?: string
  stageType?: string
  rules?: HierarchyRules
  ui_settings?: HierarchyUISettings
  children?: TreeHierarchyItem[]
  // Store original data to preserve all properties during duplication
  originalData?: Record<string, unknown>
}

interface StageTabsEditorProps {
  yamlContent: string
  onChange: (yaml: string) => void
  isReadOnly?: boolean
  validationErrors?: ParsedValidationError[]
  experimentId?: string
  showGuiEditor?: boolean
}

export interface StageTabsEditorRef {
  jumpToError: (error: ParsedValidationError) => void
  clearHighlights: () => void
}

type TabType = 'settings' | 'stage'

interface Tab {
  id: string
  type: TabType
  label: string
  stageIndex?: number
}

// Basic stage templates - used when adding a new stage by type
const DEFAULT_STAGE_TEMPLATES: Record<string, string> = {
  questionnaire: `id: "new_questionnaire"
type: "questionnaire"
label: "Questionnaire"
title: "Questionnaire"
description: "Please answer the following questions"
mandatory: true
layout:
  width: 70%
  align_vertical: upper-third
questions:
  - id: "q1"
    text: "Your question here?"
    type: "text"
    required: true`,
  user_info: `id: "new_demographics"
type: "user_info"
label: "Demographics"
title: "About You"
description: "Please provide your demographic information"
mandatory: true
layout:
  width: 70%
  align_vertical: upper-third
fields:
  - field: "age"
    label: "Age"
    type: "number"
    required: true
    min: 18
    max: 120`,
  participant_identity: `id: "participant_identity"
type: "participant_identity"
label: "Your Identity"
title: "Participant Identification"
description: "Please enter your details"
mandatory: true
layout:
  width: 70%
  align_vertical: upper-third
fields:
  - field: "first_name"
    label: ""
    type: "text"
    enabled: true
    required: true
    include_in_label: true
    row: 1
    width: "half"
    placeholder: "First name"
  - field: "last_name"
    label: ""
    type: "text"
    enabled: true
    required: false
    include_in_label: true
    row: 1
    width: "half"
    placeholder: "Last name"`,
  consent_form: `id: "new_consent"
type: "consent_form"
label: "Consent"
title: "Informed Consent"
description: "Please read and agree to participate in this study"
mandatory: true
layout:
  width: 70%
  align_vertical: upper-third
content_type: "html"
content: |
  <h2>Informed Consent</h2>
  <p>Please read and agree to participate.</p>`,
  content_display: `id: "new_content"
type: "content_display"
label: "Content"
title: "Information"
description: "Please read the following information"
layout:
  width: 70%
  align_vertical: upper-third
content_type: "html"
content: |
  <h2>Title</h2>
  <p>Your content here...</p>`,
  video_player: `id: "new_video"
type: "video_player"
label: "Watch Video"
title: "Video"
description: "Please watch the following video"
layout:
  width: 70%
  align_vertical: upper-third
source: ""  # Use Asset button in toolbar to insert video URL, or paste YouTube URL
config:
  autoplay: false
  controls: true
  allow_seek: true
  allow_pause: true`,
  iframe_sandbox: `id: "new_task"
type: "iframe_sandbox"
label: "Interactive Task"
title: "Task"
description: "Please complete the following task"
layout:
  width: 70%
  align_vertical: upper-third
source: ""  # Use Asset button in toolbar to insert HTML task URL
config:
  height: "600px"
  allow_fullscreen: true
  completion_trigger: "TASK_COMPLETE"`,
  likert_scale: `id: "new_rating"
type: "likert_scale"
label: "Rating"
title: "Rating"
description: "Please rate on the scale below"
layout:
  width: 70%
  align_vertical: upper-third

# Question text displayed above the scale
question_text: "How do you feel about this?"

# Scale range (min and max values) - used if custom options not provided
range: [1, 5]

# Option 1: Use custom labels with hidden scores
likert_options:
  - label: "Strongly Disagree"
    score: 1
  - label: "Disagree"
    score: 2
  - label: "Neutral"
    score: 3
  - label: "Agree"
    score: 4
  - label: "Strongly Agree"
    score: 5

# Display options
show_faces: true         # Show face images (auto-disabled if >5 options)
show_score: false        # Show/hide numeric score

# Styling
likert_style_config:
  option_gap: 8          # Gap between options (pixels)
  option_padding: 16     # Padding inside each option (pixels)
  margin_top: 0          # Top margin (pixels)
  margin_bottom: 0       # Bottom margin (pixels)`,
  attention_check: `id: "new_attention"
type: "attention_check"
label: "Attention Check"
title: "Verification"
description: "Please answer the following verification question"
layout:
  width: 70%
  align_vertical: upper-third
questions:
  - id: "ac1"
    text: "Please select 'Agree' to continue"
    type: "radio"
    required: true
    options:
      - value: "agree"
        label: "Agree"
      - value: "disagree"
        label: "Disagree"
expected_answer: "agree"`,
  external_task: `id: "new_external_task"
type: "external_task"
label: "External Task"
title: "External Task"
description: "Please complete the task in the external application"
mandatory: true
layout:
  width: 70%
  align_vertical: upper-third
target_url: ""  # URL of the external application
config:
  completion_mode: "required"
  window_mode: "popup"
  window_width: 1200
  window_height: 800
  ready_text: "Ready to start"
  ready_description: ""
  block_width: "40%"`,
  multiple_choice: `id: "new_multiple_choice"
type: "multiple_choice"
label: "Question"
title: "Question"
description: "Select the best answer"
mandatory: true
layout:
  width: 70%
  align_vertical: upper-third

question:
  type: "text"
  content: "Your question here?"

answers:
  - id: "a"
    type: "text"
    content: "Answer A"
  - id: "b"
    type: "text"
    content: "Answer B"
  - id: "c"
    type: "text"
    content: "Answer C"
  - id: "d"
    type: "text"
    content: "Answer D"

config:
  layout: "single_column"
  correct_answer: "a"
  show_correct_after_submit: true
  show_answer_labels: true`,
}

// Stage template interface (fetched from API)
interface StageTemplate {
  id: string
  name: string
  description: string
  category: string
  filename: string
  yaml?: string  // Only populated when fetched individually
}

type AddStageMenuView = 'closed' | 'main' | 'basic' | 'templates'

// YAML view mode: full config, selected item only (no children), or selected with children
type YamlViewMode = 'full' | 'selectedOnly' | 'selectedWithChildren'

export const StageTabsEditor = forwardRef<StageTabsEditorRef, StageTabsEditorProps>(
  function StageTabsEditor({ yamlContent, onChange, isReadOnly = false, validationErrors: _validationErrors = [], experimentId, showGuiEditor = true }, ref) {
  const [activeTabId, setActiveTabId] = useState<string>('settings')
  const [addStageMenuView, setAddStageMenuView] = useState<AddStageMenuView>('closed')
  
  // Stage templates fetched from API
  const [stageTemplates, setStageTemplates] = useState<StageTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const templateCacheRef = useRef<Record<string, string>>({})  // Cache for fetched template YAML
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(true)
  const [guiEditorVisible, setGuiEditorVisible] = useState(showGuiEditor)
  const [yamlEditorVisible, setYamlEditorVisible] = useState(true) // Toggle for YAML editor visibility
  const [yamlViewMode, setYamlViewMode] = useState<YamlViewMode>('full') // 3-way toggle: full config, selected item only, selected with children
  const [selectedHierarchyItemId, setSelectedHierarchyItemId] = useState<string | undefined>()
  const [selectedHierarchyPath, setSelectedHierarchyPath] = useState<string[]>([])
  const [selectedHierarchyItem, setSelectedHierarchyItem] = useState<TreeHierarchyItem | null>(null)
  // Track duplication sources for visual indication of unchanged values
  const [duplicationSources, setDuplicationSources] = useState<Record<string, DuplicationSource>>({})
  // Track item for refactoring after duplication
  const [refactorTarget, setRefactorTarget] = useState<{
    id: string
    type: 'stage' | 'phase' | 'block' | 'task'
    data: Record<string, unknown>
    stageIndex?: number // For flat stages
  } | null>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const editorInstanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  
  // Track error line decorations
  const decorationsRef = useRef<string[]>([])
  
  // Track tab switching to prevent race conditions
  const isTabSwitchingRef = useRef(false)
  const activeTabIdRef = useRef(activeTabId)
  
  // Track yamlViewMode state with a ref for use in callbacks
  const yamlViewModeRef = useRef(yamlViewMode)
  
  // Track state with refs for use in deferred callbacks (e.g., blur validation)
  // Initialize with null, will be synced by useEffect
  const parsedConfigRef = useRef<ParsedConfig | null>(null)
  const selectedHierarchyPathRef = useRef<string[]>([])
  const selectedHierarchyItemRef = useRef<TreeHierarchyItem | null>(null)

  // Parse YAML into sections
  const { parsedConfig, settingsYaml, stageYamls, parseError } = useMemo(() => {
    try {
      const config = yaml.load(yamlContent) as ParsedConfig | null
      if (!config) {
        return { parsedConfig: null, settingsYaml: '', stageYamls: [], parseError: 'Empty configuration' }
      }

      // Extract settings (everything except stages)
      const { stages, ...settings } = config
      const settingsStr = yaml.dump(settings, { indent: 2, lineWidth: -1, noRefs: true })

      // Extract individual stages
      const stageStrs = (stages || []).map((stage) => 
        yaml.dump(stage, { indent: 2, lineWidth: -1, noRefs: true })
      )

      return {
        parsedConfig: config,
        settingsYaml: settingsStr,
        stageYamls: stageStrs,
        parseError: null,
      }
    } catch (err) {
      return {
        parsedConfig: null,
        settingsYaml: yamlContent,
        stageYamls: [],
        parseError: err instanceof Error ? err.message : 'Invalid YAML',
      }
    }
  }, [yamlContent])

  // Check if config uses phases (4-level hierarchy) or flat stages
  const hasPhases = useMemo(() => {
    return parsedConfig?.phases && parsedConfig.phases.length > 0
  }, [parsedConfig])
  
  // Check if config structure supports phases (even if empty)
  const supportsPhases = useMemo(() => {
    return parsedConfig?.phases !== undefined
  }, [parsedConfig])

  // Convert phases to tree hierarchy items
  const hierarchyItems: TreeHierarchyItem[] = useMemo(() => {
    if (!parsedConfig?.phases) return []
    
    const convertPhase = (phase: HierarchyPhase): TreeHierarchyItem => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { stages, ...phaseData } = phase
      return {
        id: phase.id,
        type: 'phase',
        label: phase.label,
        title: phase.title,
        rules: phase.rules,
        ui_settings: phase.ui_settings,
        children: phase.stages?.map(convertStage) || [],
        originalData: phaseData,
      }
    }
    
    const convertStage = (stage: HierarchyStage): TreeHierarchyItem => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { blocks, ...stageData } = stage
      return {
        id: stage.id,
        type: 'stage',
        label: stage.label,
        title: stage.title,
        stageType: stage.type,
        rules: stage.rules,
        ui_settings: stage.ui_settings,
        children: stage.blocks?.map(convertBlock) || [],
        originalData: stageData,
      }
    }
    
    const convertBlock = (block: HierarchyBlock): TreeHierarchyItem => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tasks, ...blockData } = block
      return {
        id: block.id,
        type: 'block',
        label: block.label,
        title: block.title,
        rules: block.rules,
        ui_settings: block.ui_settings,
        children: block.tasks?.map(convertTask) || [],
        originalData: blockData,
      }
    }
    
    const convertTask = (task: Stage): TreeHierarchyItem => ({
      id: task.id,
      type: 'task',
      label: task.label,
      title: task.id,
      stageType: task.type,
      originalData: task as Record<string, unknown>,
    })
    
    return parsedConfig.phases.map(convertPhase)
  }, [parsedConfig])

  // Handle hierarchy item selection
  const handleHierarchyItemSelect = useCallback((item: TreeHierarchyItem, path: string[]) => {
    // Clear any pending editor changes to prevent stale data when switching items
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    setLocalEditorContent(null)
    
    setSelectedHierarchyItemId(item.id)
    setSelectedHierarchyPath(path)
    setSelectedHierarchyItem(item)
  }, [])
  
  // Handle hierarchy item duplication - track for unchanged value indication
  const handleHierarchyItemDuplicated = useCallback((newItemId: string, originalItemData: Record<string, unknown>, duplicatedItemData: Record<string, unknown>) => {
    const duplicationSource: DuplicationSource = {
      sourceId: originalItemData.id as string,
      originalValues: originalItemData,
      timestamp: Date.now(),
    }
    
    setDuplicationSources(prev => ({
      ...prev,
      [newItemId]: duplicationSource,
    }))
    
    // Determine item type from the data
    const itemType = (originalItemData.type as 'phase' | 'stage' | 'block' | 'task') || 'stage'
    
    // Show toast with refactor option
    toast.success(`${itemType.charAt(0).toUpperCase() + itemType.slice(1)} duplicated`, {
      description: `Created: ${newItemId}`,
      duration: 8000,
      action: {
        label: 'Refactor',
        onClick: () => {
          setRefactorTarget({
            id: newItemId,
            type: itemType,
            data: duplicatedItemData, // Use duplicated data (with _copy suffixes) for refactor modal
          })
        },
      },
    })
  }, [])
  
  // Get YAML for a selected hierarchy item (with or without children)
  const getSelectedItemYaml = useCallback((includeChildren: boolean): string => {
    if (!parsedConfig?.phases || selectedHierarchyPath.length === 0) return ''
    
    try {
      const phases = parsedConfig.phases
      let current: Array<{ id: string; [key: string]: unknown }> = phases as Array<{ id: string; [key: string]: unknown }>
      let item: Record<string, unknown> | null = null
      let itemLevel = 0 // 0=phase, 1=stage, 2=block, 3=task
      
      for (let i = 0; i < selectedHierarchyPath.length; i++) {
        const id = selectedHierarchyPath[i]
        const found = current.find(c => c.id === id)
        if (!found) return ''
        item = found as Record<string, unknown>
        itemLevel = i
        
        if (i < selectedHierarchyPath.length - 1) {
          if (i === 0) current = (item.stages as Array<{ id: string; [key: string]: unknown }>) || []
          else if (i === 1) current = (item.blocks as Array<{ id: string; [key: string]: unknown }>) || []
          else if (i === 2) current = (item.tasks as Array<{ id: string; [key: string]: unknown }>) || []
        }
      }
      
      if (item) {
        if (includeChildren) {
          // Return the full item with all children
          return yaml.dump(item, { indent: 2, lineWidth: -1, noRefs: true })
        } else {
          // Return only the item without children (stages, blocks, tasks)
          const itemCopy = { ...item }
          // Remove children based on level
          if (itemLevel === 0) delete itemCopy.stages // Phase - remove stages
          else if (itemLevel === 1) delete itemCopy.blocks // Stage - remove blocks
          else if (itemLevel === 2) delete itemCopy.tasks // Block - remove tasks
          // Tasks have no children to remove
          return yaml.dump(itemCopy, { indent: 2, lineWidth: -1, noRefs: true })
        }
      }
    } catch {
      // Ignore errors
    }
    return ''
  }, [parsedConfig, selectedHierarchyPath])

  // Handle hierarchy changes (from tree editor)
  const handleHierarchyChange = useCallback((newPhases: TreeHierarchyItem[]) => {
    // Convert tree items back to YAML phases structure
    // Merge originalData with tree item properties to preserve all fields during duplication
    const convertToPhase = (item: TreeHierarchyItem): HierarchyPhase => ({
      ...(item.originalData || {}),
      id: item.id,
      label: item.label,
      title: item.title,
      rules: item.rules,
      ui_settings: item.ui_settings,
      stages: item.children?.filter(c => c.type === 'stage').map(convertToStage) || [],
    })
    
    const convertToStage = (item: TreeHierarchyItem): HierarchyStage => ({
      ...(item.originalData || {}),
      id: item.id,
      label: item.label,
      title: item.title,
      type: item.stageType,
      rules: item.rules,
      ui_settings: item.ui_settings,
      blocks: item.children?.filter(c => c.type === 'block').map(convertToBlock) || [],
    })
    
    const convertToBlock = (item: TreeHierarchyItem): HierarchyBlock => ({
      ...(item.originalData || {}),
      id: item.id,
      label: item.label,
      title: item.title,
      rules: item.rules,
      ui_settings: item.ui_settings,
      tasks: item.children?.filter(c => c.type === 'task').map(convertToTask) || [],
    })
    
    const convertToTask = (item: TreeHierarchyItem): Stage => ({
      ...(item.originalData || {}),
      id: item.id,
      type: item.stageType || 'content_display',
      label: item.label,
    })
    
    try {
      const settings = yaml.load(settingsYaml) as Record<string, unknown> || {}
      const phases = newPhases.map(convertToPhase)
      const fullConfig: Record<string, unknown> = { ...settings, phases }
      // Remove stages if we have phases
      delete fullConfig.stages
      const newYaml = yaml.dump(fullConfig, { indent: 2, lineWidth: -1, noRefs: true })
      onChange(newYaml)
    } catch {
      // Ignore errors
    }
  }, [settingsYaml, onChange])

  // Generate tabs
  const tabs: Tab[] = useMemo(() => {
    const result: Tab[] = [{ id: 'settings', type: 'settings', label: 'Settings' }]
    
    if (parsedConfig?.stages) {
      parsedConfig.stages.forEach((stage, index) => {
        result.push({
          id: `stage-${index}`,
          type: 'stage',
          label: stage.label || stage.id || `Stage ${index + 1}`,
          stageIndex: index,
        })
      })
    }
    
    return result
  }, [parsedConfig])


  // Get current editor content based on active tab or hierarchy selection
  const currentEditorContent = useMemo(() => {
    if (parseError) return yamlContent
    
    // In hierarchy mode
    if (hasPhases) {
      // If showing full YAML or no item is selected, show the full config
      if (yamlViewMode === 'full' || selectedHierarchyPath.length === 0) {
        return yamlContent
      }
      // Otherwise show the selected item's YAML (with or without children)
      const includeChildren = yamlViewMode === 'selectedWithChildren'
      const itemYaml = getSelectedItemYaml(includeChildren)
      return itemYaml || yamlContent
    }
    
    if (activeTabId === 'settings') {
      return settingsYaml
    }
    
    const tab = tabs.find((t) => t.id === activeTabId)
    if (tab?.type === 'stage' && tab.stageIndex !== undefined) {
      return stageYamls[tab.stageIndex] || ''
    }
    
    return settingsYaml
  }, [activeTabId, settingsYaml, stageYamls, tabs, parseError, yamlContent, hasPhases, yamlViewMode, selectedHierarchyPath, getSelectedItemYaml])

  // Reassemble full YAML from parts
  const reassembleYaml = useCallback((newSettingsYaml: string, newStageYamls: string[]): string | null => {
    try {
      const settings = yaml.load(newSettingsYaml) as Record<string, unknown> || {}
      const stages = newStageYamls.map((stageYaml) => yaml.load(stageYaml) as Stage).filter(Boolean)
      
      const fullConfig = { ...settings, stages }
      const newYaml = yaml.dump(fullConfig, { indent: 2, lineWidth: -1, noRefs: true })
      
      // Compare parsed versions to avoid unnecessary updates due to formatting differences
      try {
        const currentParsed = JSON.stringify(yaml.load(yamlContent))
        const newParsed = JSON.stringify(fullConfig)
        if (currentParsed === newParsed) {
          return null // No semantic change
        }
      } catch {
        // If comparison fails, proceed with update
      }
      
      return newYaml
    } catch {
      // If parsing fails, return null to prevent update
      return null
    }
  }, [yamlContent])

  // Track the last content we sent to avoid loops
  const lastEditorContentRef = useRef<string>('')
  
  // Local editor content state - this is what the editor displays
  // We update this immediately, but debounce the YAML reassembly
  const [localEditorContent, setLocalEditorContent] = useState<string | null>(null)
  const debounceTimerRef = useRef<number | null>(null)
  
  // Debounce delay in milliseconds
  const DEBOUNCE_DELAY = 500

  // Keep yamlViewMode ref in sync and clear local content when switching view modes
  useEffect(() => {
    yamlViewModeRef.current = yamlViewMode
    // Clear any pending changes when switching view modes to prevent stale data
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    setLocalEditorContent(null)
  }, [yamlViewMode])
  
  // Keep refs in sync with state SYNCHRONOUSLY (not in useEffect)
  // This ensures refs are always up-to-date when blur handlers run
  parsedConfigRef.current = parsedConfig
  selectedHierarchyPathRef.current = selectedHierarchyPath
  selectedHierarchyItemRef.current = selectedHierarchyItem

  // Merge edited item YAML back into the full config
  const mergeItemYamlIntoConfig = useCallback((editedItemYaml: string, includeChildren: boolean): string | null => {
    if (!parsedConfig?.phases || selectedHierarchyPath.length === 0) return null
    
    try {
      const editedItem = yaml.load(editedItemYaml) as Record<string, unknown>
      if (!editedItem) return null
      
      // Deep clone the phases to avoid mutating state
      const phases = JSON.parse(JSON.stringify(parsedConfig.phases)) as Array<{ id: string; [key: string]: unknown }>
      
      // Navigate to the item and replace it
      let current: Array<{ id: string; [key: string]: unknown }> = phases
      let parent: Array<{ id: string; [key: string]: unknown }> | null = null
      let itemIndex = -1
      let existingItem: Record<string, unknown> | null = null
      
      for (let i = 0; i < selectedHierarchyPath.length; i++) {
        const id = selectedHierarchyPath[i]
        const foundIndex = current.findIndex(c => c.id === id)
        if (foundIndex === -1) return null
        
        existingItem = current[foundIndex]
        
        if (i === selectedHierarchyPath.length - 1) {
          // This is the item we're editing
          parent = current
          itemIndex = foundIndex
        } else {
          // Keep traversing
          if (i === 0) current = (existingItem.stages as Array<{ id: string; [key: string]: unknown }>) || []
          else if (i === 1) current = (existingItem.blocks as Array<{ id: string; [key: string]: unknown }>) || []
          else if (i === 2) current = (existingItem.tasks as Array<{ id: string; [key: string]: unknown }>) || []
        }
      }
      
      if (parent && itemIndex >= 0 && existingItem) {
        // Ensure edited item has an id (required by the type)
        const editedItemId = (editedItem.id as string) || existingItem.id
        
        if (includeChildren) {
          // Replace the entire item (user edited item with children)
          parent[itemIndex] = { ...editedItem, id: editedItemId } as { id: string; [key: string]: unknown }
        } else {
          // Only replace the item properties, preserve existing children
          const itemLevel = selectedHierarchyPath.length - 1
          const mergedItem: Record<string, unknown> = { ...editedItem, id: editedItemId }
          
          // Preserve children from the existing item
          if (itemLevel === 0 && existingItem.stages) mergedItem.stages = existingItem.stages
          else if (itemLevel === 1 && existingItem.blocks) mergedItem.blocks = existingItem.blocks
          else if (itemLevel === 2 && existingItem.tasks) mergedItem.tasks = existingItem.tasks
          
          parent[itemIndex] = mergedItem as { id: string; [key: string]: unknown }
        }
      }
      
      // Rebuild full config
      const settings = yaml.load(settingsYaml) as Record<string, unknown> || {}
      const fullConfig: Record<string, unknown> = { ...settings, phases }
      delete fullConfig.stages
      return yaml.dump(fullConfig, { indent: 2, lineWidth: -1, noRefs: true })
    } catch {
      return null
    }
  }, [parsedConfig, selectedHierarchyPath, settingsYaml])

  // Handle editor changes - update local state immediately, debounce YAML reassembly
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!value) return
    
    // Ignore changes during tab switching to prevent race conditions
    if (isTabSwitchingRef.current) {
      return
    }
    
    // Update local content immediately (no parsing)
    setLocalEditorContent(value)
    
    // Clear any existing debounce timer
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current)
    }
    
    // Debounce the YAML reassembly
    debounceTimerRef.current = window.setTimeout(() => {
      // Make sure we're using the current tab (use ref for latest value)
      const currentTabId = activeTabIdRef.current
      const currentViewMode = yamlViewModeRef.current
      
      lastEditorContentRef.current = value

      if (parseError) {
        onChange(value)
        return
      }

      // In hierarchy mode
      if (hasPhases) {
        if (currentViewMode === 'full') {
          // Full config view - pass through directly
          onChange(value)
          setLocalEditorContent(null)
        } else {
          // Selected item view - merge back into full config
          const includeChildren = currentViewMode === 'selectedWithChildren'
          const mergedYaml = mergeItemYamlIntoConfig(value, includeChildren)
          if (mergedYaml) {
            onChange(mergedYaml)
            setLocalEditorContent(null)
          }
        }
        return
      }

      const newStageYamls = [...stageYamls]
      let newSettingsYaml = settingsYaml

      if (currentTabId === 'settings') {
        newSettingsYaml = value
      } else {
        const tab = tabs.find((t) => t.id === currentTabId)
        if (tab?.type === 'stage' && tab.stageIndex !== undefined) {
          newStageYamls[tab.stageIndex] = value
        }
      }

      const newYaml = reassembleYaml(newSettingsYaml, newStageYamls)
      if (newYaml !== null) {
        onChange(newYaml)
        // Clear local content after successful sync
        setLocalEditorContent(null)
      }
    }, DEBOUNCE_DELAY)
  }, [tabs, stageYamls, settingsYaml, parseError, reassembleYaml, onChange, hasPhases, mergeItemYamlIntoConfig])

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Update the ref when the current content changes (from external updates)
  useEffect(() => {
    lastEditorContentRef.current = currentEditorContent
  }, [currentEditorContent])
  
  // Fetch stage templates from API on mount
  useEffect(() => {
    const fetchTemplates = async () => {
      setTemplatesLoading(true)
      try {
        const response = await api.get('/templates')
        setStageTemplates(response.data.templates || [])
      } catch (error) {
        console.error('Failed to fetch stage templates:', error)
        setStageTemplates([])
      } finally {
        setTemplatesLoading(false)
      }
    }
    fetchTemplates()
  }, [])
  
  // The actual content to display in the editor
  // Use local content if we have unsaved changes, otherwise use the parsed content
  const displayedEditorContent = localEditorContent !== null ? localEditorContent : currentEditorContent
  
  // Safe tab switching function
  const handleTabSwitch = useCallback((newTabId: string) => {
    // Use ref to avoid stale closure issues
    if (newTabId === activeTabIdRef.current) return
    
    // Clear any pending debounce timer and local content
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    setLocalEditorContent(null)
    
    // Set flag to ignore editor changes during switch
    isTabSwitchingRef.current = true
    activeTabIdRef.current = newTabId
    setActiveTabId(newTabId)
    
    // Reset the flag after a short delay to allow editor to stabilize
    setTimeout(() => {
      isTabSwitchingRef.current = false
    }, 100)
  }, []) // No dependencies needed since we use refs

  // Helper: collect all IDs from the hierarchy for uniqueness checks
  const collectAllHierarchyIds = useCallback((phases: HierarchyPhase[]): string[] => {
    const ids: string[] = []
    phases.forEach(phase => {
      ids.push(phase.id)
      phase.stages?.forEach(stage => {
        ids.push(stage.id)
        stage.blocks?.forEach(block => {
          ids.push(block.id)
          block.tasks?.forEach(task => {
            ids.push(task.id)
          })
        })
      })
    })
    return ids
  }, [])

  // Helper: ensure ID uniqueness by appending "_copy_N" if needed
  const ensureUniqueId = useCallback((newId: string, existingIds: string[], excludeId?: string): { id: string; wasDuplicate: boolean } => {
    // Filter out the excluded ID (the old ID of the item being renamed)
    const idsToCheck = excludeId ? existingIds.filter(id => id !== excludeId) : existingIds
    
    // If the ID is already unique, return it as is
    if (!idsToCheck.includes(newId)) {
      return { id: newId, wasDuplicate: false }
    }
    
    // Otherwise, append "_copy_N" until we find a unique ID
    let counter = 1
    let uniqueId = `${newId}_copy_${counter}`
    while (idsToCheck.includes(uniqueId)) {
      counter++
      uniqueId = `${newId}_copy_${counter}`
    }
    
    return { id: uniqueId, wasDuplicate: true }
  }, [])

  // Helper: add a task to the hierarchy at the appropriate location
  const addTaskToHierarchy = useCallback((newTask: Stage, targetPath?: string[]): string | null => {
    if (!parsedConfig?.phases) return null
    
    // Deep clone phases
    const phases = JSON.parse(JSON.stringify(parsedConfig.phases)) as HierarchyPhase[]
    
    // Determine where to add the task
    let targetBlock: HierarchyBlock | null = null
    
    if (targetPath && targetPath.length > 0) {
      // We have a selection - navigate to find the target
      const pathLength = targetPath.length
      
      // Find the phase
      const phase = phases.find(p => p.id === targetPath[0])
      if (!phase) return null
      
      if (pathLength === 1) {
        // Phase selected - add to last block of last stage, or create structure
        if (!phase.stages || phase.stages.length === 0) {
          phase.stages = [{ id: `stage_${Date.now()}`, label: 'New Stage', blocks: [] }]
        }
        const lastStage = phase.stages[phase.stages.length - 1]
        if (!lastStage.blocks || lastStage.blocks.length === 0) {
          lastStage.blocks = [{ id: `block_${Date.now()}`, label: 'New Block', tasks: [] }]
        }
        targetBlock = lastStage.blocks[lastStage.blocks.length - 1]
      } else if (pathLength === 2) {
        // Stage selected - add to last block, or create one
        const stage = phase.stages?.find(s => s.id === targetPath[1])
        if (!stage) return null
        if (!stage.blocks || stage.blocks.length === 0) {
          stage.blocks = [{ id: `block_${Date.now()}`, label: 'New Block', tasks: [] }]
        }
        targetBlock = stage.blocks[stage.blocks.length - 1]
      } else if (pathLength === 3) {
        // Block selected - add to this block
        const stage = phase.stages?.find(s => s.id === targetPath[1])
        if (!stage) return null
        targetBlock = stage.blocks?.find(b => b.id === targetPath[2]) || null
      } else if (pathLength === 4) {
        // Task selected - add as sibling (to same block)
        const stage = phase.stages?.find(s => s.id === targetPath[1])
        if (!stage) return null
        targetBlock = stage.blocks?.find(b => b.id === targetPath[2]) || null
      }
    } else {
      // No selection - add to the last block of the hierarchy
      if (phases.length === 0) {
        phases.push({ id: `phase_${Date.now()}`, label: 'New Phase', stages: [] })
      }
      const lastPhase = phases[phases.length - 1]
      if (!lastPhase.stages || lastPhase.stages.length === 0) {
        lastPhase.stages = [{ id: `stage_${Date.now()}`, label: 'New Stage', blocks: [] }]
      }
      const lastStage = lastPhase.stages[lastPhase.stages.length - 1]
      if (!lastStage.blocks || lastStage.blocks.length === 0) {
        lastStage.blocks = [{ id: `block_${Date.now()}`, label: 'New Block', tasks: [] }]
      }
      targetBlock = lastStage.blocks[lastStage.blocks.length - 1]
    }
    
    if (!targetBlock) return null
    
    // Add the task to the target block
    if (!targetBlock.tasks) targetBlock.tasks = []
    targetBlock.tasks.push(newTask)
    
    // Build and return the new YAML
    const settings = yaml.load(settingsYaml) as Record<string, unknown> || {}
    const fullConfig: Record<string, unknown> = { ...settings, phases }
    delete fullConfig.stages
    const newYaml = yaml.dump(fullConfig, { indent: 2, lineWidth: -1, noRefs: true })
    
    return newYaml
  }, [parsedConfig, settingsYaml])

  // Add new stage from basic type
  const handleAddStage = useCallback((stageType: string) => {
    const template = DEFAULT_STAGE_TEMPLATES[stageType] || DEFAULT_STAGE_TEMPLATES.questionnaire
    
    // Check if using hierarchy mode
    if (hasPhases) {
      // In hierarchy mode, templates are added as tasks
      const existingIds = collectAllHierarchyIds(parsedConfig?.phases || [])
      let newId = `new_${stageType}`
      let counter = 1
      while (existingIds.includes(newId)) {
        newId = `new_${stageType}_${counter}`
        counter++
      }
      
      const newTemplate = template.replace(/id: ".*?"/, `id: "${newId}"`)
      
      try {
        const newTask = yaml.load(newTemplate) as Stage
        const newYaml = addTaskToHierarchy(newTask, selectedHierarchyPath.length > 0 ? selectedHierarchyPath : undefined)
        if (newYaml) {
          onChange(newYaml)
        }
      } catch {
        // Ignore errors
      }
      setAddStageMenuView('closed')
      return
    }
    
    // Flat stages mode (legacy)
    const existingIds = parsedConfig?.stages?.map((s) => s.id) || []
    let newId = `new_${stageType}`
    let counter = 1
    while (existingIds.includes(newId)) {
      newId = `new_${stageType}_${counter}`
      counter++
    }
    
    // Update template with unique ID
    const newTemplate = template.replace(/id: ".*?"/, `id: "${newId}"`)
    
    try {
      const settings = yaml.load(settingsYaml) as Record<string, unknown> || {}
      const newStage = yaml.load(newTemplate) as Stage
      const existingStages = stageYamls.map((s) => yaml.load(s) as Stage).filter(Boolean)
      const stages = [...existingStages, newStage]
      
      const fullConfig = { ...settings, stages }
      const newYaml = yaml.dump(fullConfig, { indent: 2, lineWidth: -1, noRefs: true })
      onChange(newYaml)
      
      // Switch to the new tab
      handleTabSwitch(`stage-${stages.length - 1}`)
    } catch {
      // Ignore errors
    }
    setAddStageMenuView('closed')
  }, [parsedConfig, stageYamls, settingsYaml, onChange, handleTabSwitch, hasPhases, collectAllHierarchyIds, addTaskToHierarchy, selectedHierarchyPath])

  // Add new stage from template (fetched from API)
  const handleAddStageFromTemplate = useCallback(async (templateId: string) => {
    // Check cache first
    let templateYaml = templateCacheRef.current[templateId]
    
    if (!templateYaml) {
      // Fetch from API
      try {
        const response = await api.get(`/templates/${templateId}`)
        templateYaml = response.data.yaml
        // Cache for future use
        templateCacheRef.current[templateId] = templateYaml
      } catch (error) {
        console.error('Failed to fetch template:', error)
        setAddStageMenuView('closed')
        return
      }
    }
    
    if (!templateYaml) {
      setAddStageMenuView('closed')
      return
    }
    
    // Helper to replace ID in YAML (handles both quoted and unquoted)
    const replaceIdInYaml = (yamlStr: string, newId: string): string => {
      // Try quoted first: id: "value" or id: 'value'
      let replaced = yamlStr.replace(/^(id:\s*)["'].*?["']/m, `$1"${newId}"`)
      if (replaced === yamlStr) {
        // Try unquoted: id: value
        replaced = yamlStr.replace(/^(id:\s*)\S+/m, `$1"${newId}"`)
      }
      return replaced
    }
    
    // Check if using hierarchy mode
    if (hasPhases) {
      // In hierarchy mode, templates are added as tasks
      const existingIds = collectAllHierarchyIds(parsedConfig?.phases || [])
      
      try {
        const parsedTemplate = yaml.load(templateYaml) as Stage
        let newId = parsedTemplate.id
        let counter = 1
        while (existingIds.includes(newId)) {
          newId = `${parsedTemplate.id}_${counter}`
          counter++
        }
        
        // Update template with unique ID
        if (newId !== parsedTemplate.id) {
          templateYaml = replaceIdInYaml(templateYaml, newId)
        }
        
        const newTask = yaml.load(templateYaml) as Stage
        const newYaml = addTaskToHierarchy(newTask, selectedHierarchyPath.length > 0 ? selectedHierarchyPath : undefined)
        if (newYaml) {
          onChange(newYaml)
        }
      } catch {
        // Ignore errors
      }
      setAddStageMenuView('closed')
      return
    }
    
    // Flat stages mode (legacy)
    const existingIds = parsedConfig?.stages?.map((s) => s.id) || []
    
    // Parse the template to get its ID
    try {
      const parsedTemplate = yaml.load(templateYaml) as Stage
      let newId = parsedTemplate.id
      let counter = 1
      while (existingIds.includes(newId)) {
        newId = `${parsedTemplate.id}_${counter}`
        counter++
      }
      
      // Update template with unique ID
      if (newId !== parsedTemplate.id) {
        templateYaml = replaceIdInYaml(templateYaml, newId)
      }
      
      const settings = yaml.load(settingsYaml) as Record<string, unknown> || {}
      const newStage = yaml.load(templateYaml) as Stage
      const existingStages = stageYamls.map((s) => yaml.load(s) as Stage).filter(Boolean)
      const stages = [...existingStages, newStage]
      
      const fullConfig = { ...settings, stages }
      const newYaml = yaml.dump(fullConfig, { indent: 2, lineWidth: -1, noRefs: true })
      onChange(newYaml)
      
      // Switch to the new tab
      handleTabSwitch(`stage-${stages.length - 1}`)
    } catch {
      // Ignore errors
    }
    setAddStageMenuView('closed')
  }, [parsedConfig, stageYamls, settingsYaml, onChange, handleTabSwitch, hasPhases, collectAllHierarchyIds, addTaskToHierarchy, selectedHierarchyPath])

  // Helper to build full YAML from stages array
  const buildFullYaml = useCallback((stages: Stage[]): string => {
    try {
      const settings = yaml.load(settingsYaml) as Record<string, unknown> || {}
      const fullConfig = { ...settings, stages }
      return yaml.dump(fullConfig, { indent: 2, lineWidth: -1, noRefs: true })
    } catch {
      return yamlContent
    }
  }, [settingsYaml, yamlContent])

  // Move stage up
  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0 || !parsedConfig?.stages) return
    
    const stages = [...parsedConfig.stages]
    const temp = stages[index]
    stages[index] = stages[index - 1]
    stages[index - 1] = temp
    
    const newYaml = buildFullYaml(stages)
    onChange(newYaml)
    
    // Update active tab to follow the moved stage (use ref for current value)
    const currentTabId = activeTabIdRef.current
    if (currentTabId === `stage-${index}`) {
      handleTabSwitch(`stage-${index - 1}`)
    } else if (currentTabId === `stage-${index - 1}`) {
      handleTabSwitch(`stage-${index}`)
    }
  }, [parsedConfig, buildFullYaml, onChange, handleTabSwitch])

  // Move stage down
  const handleMoveDown = useCallback((index: number) => {
    if (!parsedConfig?.stages || index >= parsedConfig.stages.length - 1) return
    
    const stages = [...parsedConfig.stages]
    const temp = stages[index]
    stages[index] = stages[index + 1]
    stages[index + 1] = temp
    
    const newYaml = buildFullYaml(stages)
    onChange(newYaml)
    
    // Update active tab to follow the moved stage (use ref for current value)
    const currentTabId = activeTabIdRef.current
    if (currentTabId === `stage-${index}`) {
      handleTabSwitch(`stage-${index + 1}`)
    } else if (currentTabId === `stage-${index + 1}`) {
      handleTabSwitch(`stage-${index}`)
    }
  }, [parsedConfig, buildFullYaml, onChange, handleTabSwitch])

  // Delete stage
  const handleDeleteStage = useCallback((index: number) => {
    if (!confirm('Are you sure you want to delete this stage?') || !parsedConfig?.stages) return
    
    const stages = parsedConfig.stages.filter((_, i) => i !== index)
    const newYaml = buildFullYaml(stages)
    onChange(newYaml)
    
    // Switch to settings or previous stage (use ref for current value)
    const currentTabId = activeTabIdRef.current
    if (currentTabId === `stage-${index}`) {
      if (stages.length === 0) {
        handleTabSwitch('settings')
      } else if (index >= stages.length) {
        handleTabSwitch(`stage-${stages.length - 1}`)
      } else {
        handleTabSwitch(`stage-${index}`)
      }
    } else {
      // Adjust active tab index if needed
      const activeTab = tabs.find((t) => t.id === currentTabId)
      if (activeTab?.type === 'stage' && activeTab.stageIndex !== undefined && activeTab.stageIndex > index) {
        handleTabSwitch(`stage-${activeTab.stageIndex - 1}`)
      }
    }
  }, [parsedConfig, buildFullYaml, onChange, tabs, handleTabSwitch])

  // Duplicate stage
  const handleDuplicateStage = useCallback((index: number) => {
    if (!parsedConfig?.stages) return
    
    const stage = parsedConfig.stages[index]
    if (!stage) return
    
    const existingIds = parsedConfig.stages.map((s) => s.id)
    const existingLabels = parsedConfig.stages.map((s) => s.label).filter(Boolean) as string[]
    
    // Generate ID with _copy suffix (preserves original numbering for refactoring)
    const newId = generateSmartId(stage.id, existingIds, true)
    
    // Generate label with (Copy) suffix (preserves original text for refactoring)
    const newLabel = generateSmartLabel(stage.label, existingLabels, true)
    
    // Deep clone the stage
    const clonedStage = JSON.parse(JSON.stringify(stage))
    
    const newStage: Stage = {
      ...clonedStage,
      id: newId,
      label: newLabel,
    }
    
    // Track duplication source for visual indication of unchanged values
    const duplicationSource: DuplicationSource = {
      sourceId: stage.id,
      originalValues: clonedStage,
      timestamp: Date.now(),
    }
    
    setDuplicationSources(prev => ({
      ...prev,
      [newId]: duplicationSource,
    }))
    
    const stages = [...parsedConfig.stages]
    stages.splice(index + 1, 0, newStage)
    
    const newYaml = buildFullYaml(stages)
    onChange(newYaml)
    
    // Switch to the duplicated stage
    handleTabSwitch(`stage-${index + 1}`)
    
    // Show toast with refactor option
    toast.success('Stage duplicated', {
      description: `Created: ${newId}`,
      duration: 8000,
      action: {
        label: 'Refactor',
        onClick: () => {
          setRefactorTarget({
            id: newId,
            type: 'stage',
            data: newStage as unknown as Record<string, unknown>, // Use new stage data (with _copy suffixes)
            stageIndex: index + 1,
          })
        },
      },
    })
  }, [parsedConfig, buildFullYaml, onChange, handleTabSwitch])

  // Handle refactor apply for flat stages
  const handleStageRefactorApply = useCallback((rules: RefactorRules) => {
    if (!refactorTarget || !parsedConfig?.stages) return
    
    const stageIndex = refactorTarget.stageIndex
    if (stageIndex === undefined) return
    
    const stage = parsedConfig.stages[stageIndex]
    if (!stage) return
    
    // Apply refactor rules to the stage
    const refactoredStage = applyRefactorRules(stage, rules) as Stage
    
    // Update stages array
    const stages = [...parsedConfig.stages]
    stages[stageIndex] = refactoredStage
    
    // Update duplication source with refactored values (so unchanged labels update correctly)
    const newId = refactoredStage.id
    if (duplicationSources[refactorTarget.id]) {
      setDuplicationSources(prev => {
        const newSources = { ...prev }
        // Remove old entry if ID changed
        if (newId !== refactorTarget.id) {
          delete newSources[refactorTarget.id]
        }
        // Add/update with refactored original values
        newSources[newId] = {
          ...prev[refactorTarget.id],
          originalValues: refactoredStage as unknown as Record<string, unknown>,
        }
        return newSources
      })
    }
    
    const newYaml = buildFullYaml(stages)
    onChange(newYaml)
    
    toast.success('Refactor applied', {
      description: `Updated ${refactorTarget.type}: ${newId}`,
    })
  }, [refactorTarget, parsedConfig, duplicationSources, buildFullYaml, onChange])

  // Handle refactor apply for hierarchy items (phases/blocks/tasks)
  const handleHierarchyRefactorApply = useCallback((rules: RefactorRules) => {
    if (!refactorTarget || !parsedConfig?.phases) return
    
    // Deep clone phases
    const newPhases = JSON.parse(JSON.stringify(parsedConfig.phases)) as HierarchyPhase[]
    
    // Find and update the item by ID
    const findAndUpdate = (items: unknown[]): boolean => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as Record<string, unknown>
        if (item.id === refactorTarget.id) {
          // Apply refactor rules
          items[i] = applyRefactorRules(item, rules)
          return true
        }
        // Check children (stages, blocks, tasks)
        if (item.stages && Array.isArray(item.stages)) {
          if (findAndUpdate(item.stages)) return true
        }
        if (item.blocks && Array.isArray(item.blocks)) {
          if (findAndUpdate(item.blocks)) return true
        }
        if (item.tasks && Array.isArray(item.tasks)) {
          if (findAndUpdate(item.tasks)) return true
        }
      }
      return false
    }
    
    findAndUpdate(newPhases)
    
    // Get the refactored item to get its new ID
    const findItem = (items: unknown[]): Record<string, unknown> | null => {
      for (const item of items) {
        const typedItem = item as Record<string, unknown>
        // Check if this item was the original (now has refactored ID)
        if (typedItem.stages && Array.isArray(typedItem.stages)) {
          const found = findItem(typedItem.stages)
          if (found) return found
        }
        if (typedItem.blocks && Array.isArray(typedItem.blocks)) {
          const found = findItem(typedItem.blocks)
          if (found) return found
        }
        if (typedItem.tasks && Array.isArray(typedItem.tasks)) {
          const found = findItem(typedItem.tasks)
          if (found) return found
        }
      }
      return null
    }
    
    // Find the refactored item by applying rules to the original ID
    const refactoredId = (applyRefactorRules({ id: refactorTarget.id }, rules) as { id: string }).id
    
    // Update duplication source with refactored values
    if (duplicationSources[refactorTarget.id]) {
      const refactoredData = applyRefactorRules(refactorTarget.data, rules) as Record<string, unknown>
      setDuplicationSources(prev => {
        const newSources = { ...prev }
        // Remove old entry if ID changed
        if (refactoredId !== refactorTarget.id) {
          delete newSources[refactorTarget.id]
        }
        // Add/update with refactored original values
        newSources[refactoredId] = {
          ...prev[refactorTarget.id],
          originalValues: refactoredData,
        }
        return newSources
      })
    }
    
    // Build new YAML
    const settingsObj = yaml.load(settingsYaml) as Record<string, unknown>
    const fullConfig = { ...settingsObj, phases: newPhases }
    const newYaml = yaml.dump(fullConfig, { indent: 2, lineWidth: -1, noRefs: true })
    onChange(newYaml)
    
    toast.success('Refactor applied', {
      description: `Updated ${refactorTarget.type}: ${refactoredId}`,
    })
  }, [refactorTarget, parsedConfig, duplicationSources, settingsYaml, onChange])

  // Handle Monaco editor mount
  const handleEditorMount = (editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: Monaco) => {
    monacoRef.current = monacoInstance
    editorInstanceRef.current = editor
    registerBiresYamlSchema(monacoInstance)
  }

  // Clear error highlights
  const clearHighlights = useCallback(() => {
    if (editorInstanceRef.current && decorationsRef.current.length > 0) {
      decorationsRef.current = editorInstanceRef.current.deltaDecorations(decorationsRef.current, [])
    }
  }, [])

  // Jump to error location and highlight the line
  const jumpToError = useCallback((error: ParsedValidationError) => {
    if (!editorInstanceRef.current) return

    // If error has a stage index, switch to that stage tab
    if (error.stageIndex !== null) {
      const targetTabId = `stage-${error.stageIndex}`
      if (activeTabIdRef.current !== targetTabId) {
        handleTabSwitch(targetTabId)
        // Wait for tab switch to complete before highlighting
        setTimeout(() => {
          highlightErrorInEditor(error)
        }, 150)
        return
      }
    } else {
      // Settings error - switch to settings tab
      if (activeTabIdRef.current !== 'settings') {
        handleTabSwitch('settings')
        setTimeout(() => {
          highlightErrorInEditor(error)
        }, 150)
        return
      }
    }

    // Already on the correct tab
    highlightErrorInEditor(error)
  }, [handleTabSwitch])

  // Highlight error line in the editor
  const highlightErrorInEditor = useCallback((error: ParsedValidationError) => {
    const editor = editorInstanceRef.current
    const monacoInstance = monacoRef.current
    if (!editor || !monacoInstance) return

    // Get current content
    const content = editor.getValue()
    
    // Find the line number for this error
    const lineNumber = findLineInYaml(content, error.fieldPath)
    
    if (lineNumber) {
      // Clear existing decorations
      clearHighlights()

      // Scroll to and reveal the line
      editor.revealLineInCenter(lineNumber)
      editor.setPosition({ lineNumber, column: 1 })
      editor.focus()

      // Add error highlight decoration
      decorationsRef.current = editor.deltaDecorations([], [
        {
          range: new monacoInstance.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: true,
            className: 'error-line-highlight',
            glyphMarginClassName: 'error-glyph-margin',
            overviewRuler: {
              color: '#ef4444',
              position: monacoInstance.editor.OverviewRulerLane.Full,
            },
          },
        },
      ])

      // Clear highlight after 5 seconds
      setTimeout(() => {
        clearHighlights()
      }, 5000)
    }
  }, [clearHighlights])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    jumpToError,
    clearHighlights,
  }), [jumpToError, clearHighlights])

  // Update editor options when autocomplete toggle changes
  useEffect(() => {
    if (editorInstanceRef.current) {
      editorInstanceRef.current.updateOptions({
        quickSuggestions: autocompleteEnabled && !isReadOnly ? { other: true, comments: false, strings: false } : false,
        suggest: {
          showSnippets: autocompleteEnabled,
          showKeywords: autocompleteEnabled,
        },
      })
    }
  }, [autocompleteEnabled, isReadOnly])

  // Close add menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setAddStageMenuView('closed')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Get active stage index
  const activeStageIndex = useMemo(() => {
    const tab = tabs.find((t) => t.id === activeTabId)
    return tab?.type === 'stage' ? tab.stageIndex : undefined
  }, [tabs, activeTabId])

  // GUI-YAML sync hook
  const isSettingsTab = activeTabId === 'settings'
  const { currentData: guiData, handleGuiChange, handleBatchGuiChange } = useGuiYamlSync(
    yamlContent,
    onChange,
    isSettingsTab,
    activeStageIndex
  )
  
  // Get current stage ID and its duplication source
  const currentStageId = useMemo(() => {
    if (isSettingsTab || activeStageIndex === undefined || !parsedConfig?.stages) return null
    return parsedConfig.stages[activeStageIndex]?.id ?? null
  }, [isSettingsTab, activeStageIndex, parsedConfig])
  
  const currentDuplicationSource = useMemo(() => {
    if (!currentStageId) return null
    return duplicationSources[currentStageId] ?? null
  }, [currentStageId, duplicationSources])
  
  // Handler to clear the duplication source for the current stage
  const handleClearDuplicationSource = useCallback(() => {
    if (!currentStageId) return
    setDuplicationSources(prev => {
      const { [currentStageId]: _, ...rest } = prev
      return rest
    })
  }, [currentStageId])
  
  // Get hierarchy item's duplication source (for hierarchy mode)
  const hierarchyDuplicationSource = useMemo(() => {
    if (!selectedHierarchyItemId) return null
    return duplicationSources[selectedHierarchyItemId] ?? null
  }, [selectedHierarchyItemId, duplicationSources])
  
  // Handler to clear hierarchy item's duplication source
  const handleClearHierarchyDuplicationSource = useCallback(() => {
    if (!selectedHierarchyItemId) return
    setDuplicationSources(prev => {
      const { [selectedHierarchyItemId]: _, ...rest } = prev
      return rest
    })
  }, [selectedHierarchyItemId])
  
  // Store the item's position indices to find it even when ID changes
  const [itemPositionIndices, setItemPositionIndices] = useState<number[]>([])
  const itemPositionIndicesRef = useRef<number[]>([])
  
  // Update ref when state changes
  useEffect(() => {
    itemPositionIndicesRef.current = itemPositionIndices
  }, [itemPositionIndices])
  
  // Compute GUI data for hierarchy mode
  const hierarchyGuiData = useMemo(() => {
    if (!hasPhases || !selectedHierarchyItem || !parsedConfig?.phases) return null
    
    // Find the actual data for the selected hierarchy item
    const findItemData = (path: string[]): Record<string, unknown> | null => {
      if (path.length === 0) return null
      
      const phases = parsedConfig.phases
      if (!phases) return null
      
      let current: Array<{ id: string; [key: string]: unknown }> = phases as Array<{ id: string; [key: string]: unknown }>
      let item: Record<string, unknown> | null = null
      
      for (let i = 0; i < path.length; i++) {
        const id = path[i]
        let foundIndex = current.findIndex(c => c.id === id)
        
        // If not found by ID, try using stored position indices as fallback
        if (foundIndex === -1 && i < itemPositionIndicesRef.current.length) {
          foundIndex = itemPositionIndicesRef.current[i]
        }
        
        if (foundIndex === -1 || foundIndex >= current.length) {
          return null
        }
        
        item = current[foundIndex] as Record<string, unknown>
        
        if (i < path.length - 1) {
          // Navigate to children based on level
          if (i === 0) current = (item.stages as Array<{ id: string; [key: string]: unknown }>) || []
          else if (i === 1) current = (item.blocks as Array<{ id: string; [key: string]: unknown }>) || []
          else if (i === 2) current = (item.tasks as Array<{ id: string; [key: string]: unknown }>) || []
        }
      }
      
      return item
    }
    
    return findItemData(selectedHierarchyPath)
  }, [hasPhases, selectedHierarchyItem, selectedHierarchyPath, parsedConfig, itemPositionIndices])
  
  // Update position indices when selection changes
  useEffect(() => {
    if (!hasPhases || !parsedConfig?.phases || selectedHierarchyPath.length === 0) {
      setItemPositionIndices([])
      return
    }
    
    // Calculate and store the position indices
    const phases = parsedConfig.phases
    let current: Array<{ id: string; [key: string]: unknown }> = phases as Array<{ id: string; [key: string]: unknown }>
    const indices: number[] = []
    
    for (let i = 0; i < selectedHierarchyPath.length; i++) {
      const id = selectedHierarchyPath[i]
      const foundIndex = current.findIndex(c => c.id === id)
      
      if (foundIndex === -1) {
        // Can't find by ID, use stored position if available
        if (i < itemPositionIndicesRef.current.length) {
          const storedIndex = itemPositionIndicesRef.current[i]
          if (storedIndex >= 0 && storedIndex < current.length) {
            indices.push(storedIndex)
            const item = current[storedIndex] as Record<string, unknown>
            if (i < selectedHierarchyPath.length - 1) {
              if (i === 0) current = (item.stages as Array<{ id: string; [key: string]: unknown }>) || []
              else if (i === 1) current = (item.blocks as Array<{ id: string; [key: string]: unknown }>) || []
              else if (i === 2) current = (item.tasks as Array<{ id: string; [key: string]: unknown }>) || []
            }
            continue
          }
        }
        // If we can't find it and don't have a stored position, clear the indices
        setItemPositionIndices([])
        return
      }
      
      indices.push(foundIndex)
      const item = current[foundIndex] as Record<string, unknown>
      
      if (i < selectedHierarchyPath.length - 1) {
        if (i === 0) current = (item.stages as Array<{ id: string; [key: string]: unknown }>) || []
        else if (i === 1) current = (item.blocks as Array<{ id: string; [key: string]: unknown }>) || []
        else if (i === 2) current = (item.tasks as Array<{ id: string; [key: string]: unknown }>) || []
      }
    }
    
    setItemPositionIndices(indices)
  }, [hasPhases, selectedHierarchyPath, parsedConfig])
  
  // Sync selectedHierarchyPath when the item's ID changes in the parsed config
  useEffect(() => {
    if (!hasPhases || !selectedHierarchyItem || !parsedConfig?.phases || selectedHierarchyPath.length === 0) return
    
    // Find the item by following the path, using position as fallback
    const phases = parsedConfig.phases
    let current: Array<{ id: string; [key: string]: unknown }> = phases as Array<{ id: string; [key: string]: unknown }>
    let item: Record<string, unknown> | null = null
    
    for (let i = 0; i < selectedHierarchyPath.length; i++) {
      const id = selectedHierarchyPath[i]
      let foundIndex = current.findIndex(c => c.id === id)
      
      // If not found by ID, try using stored position
      if (foundIndex === -1 && i < itemPositionIndicesRef.current.length) {
        foundIndex = itemPositionIndicesRef.current[i]
      }
      
      if (foundIndex === -1 || foundIndex >= current.length) {
        return
      }
      
      item = current[foundIndex] as Record<string, unknown>
      
      // If we're at the last level, check if the ID changed
      if (i === selectedHierarchyPath.length - 1) {
        const currentId = (item.id as string) || ''
        if (currentId && currentId !== id) {
          // ID changed, update the path
          const newPath = [...selectedHierarchyPath]
          newPath[i] = currentId
          setSelectedHierarchyPath(newPath)
          
          // Update the selected item
          setSelectedHierarchyItem({
            ...selectedHierarchyItem,
            id: currentId,
          })
        }
      }
      
      if (i < selectedHierarchyPath.length - 1) {
        if (i === 0) current = (item.stages as Array<{ id: string; [key: string]: unknown }>) || []
        else if (i === 1) current = (item.blocks as Array<{ id: string; [key: string]: unknown }>) || []
        else if (i === 2) current = (item.tasks as Array<{ id: string; [key: string]: unknown }>) || []
      }
    }
  }, [hasPhases, selectedHierarchyItem, selectedHierarchyPath, parsedConfig, itemPositionIndices])
  
  // Determine what to show in GUI for hierarchy mode
  const showHierarchySettings = hasPhases && !selectedHierarchyItem
  const showHierarchyItem = hasPhases && selectedHierarchyItem !== null
  const isHierarchyTask = showHierarchyItem && selectedHierarchyItem?.type === 'task'

  // Compute context for hierarchy item editor
  const hierarchyContext = useMemo(() => {
    if (!hasPhases || !selectedHierarchyItem || !parsedConfig?.phases) return null
    
    // Get children of the selected item
    const getChildren = (): HierarchyChild[] => {
      if (!hierarchyGuiData) return []
      
      const itemType = selectedHierarchyItem.type
      let childrenKey: string
      
      switch (itemType) {
        case 'phase':
          childrenKey = 'stages'
          break
        case 'stage':
          childrenKey = 'blocks'
          break
        case 'block':
          childrenKey = 'tasks'
          break
        default:
          return []
      }
      
      const children = hierarchyGuiData[childrenKey] as Array<{ id: string; label?: string; title?: string }> | undefined
      return children?.map(c => ({
        id: c.id,
        label: c.label,
        title: c.title,
      })) || []
    }
    
    // Get available variables for visibility rules
    const availableVariables: VariableInfo[] = extractVariablesBeforeItem(
      parsedConfig.phases,
      selectedHierarchyPath
    )
    
    return {
      children: getChildren(),
      availableVariables,
      parentPath: selectedHierarchyPath,
      itemType: selectedHierarchyItem.type as 'phase' | 'stage' | 'block',
    }
  }, [hasPhases, selectedHierarchyItem, selectedHierarchyPath, hierarchyGuiData, parsedConfig])

  // Handle hierarchy item GUI changes - updates values immediately
  // Note: ID fields are handled separately on blur to avoid update-per-keystroke issues
  const handleHierarchyGuiChange = useCallback((path: string, value: unknown) => {
    if (!hierarchyGuiData || !parsedConfig?.phases) return
    
    // Skip ID fields - they are handled on blur only
    if (path === 'id') {
      return
    }
    
    // Update the item data
    const updatedData = { ...hierarchyGuiData }
    const parts = path.split('.')
    
    // Set nested value
    let current: Record<string, unknown> = updatedData
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (current[part] === undefined || typeof current[part] !== 'object') {
        current[part] = {}
      } else {
        current[part] = { ...(current[part] as Record<string, unknown>) }
      }
      current = current[part] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
    
    // Merge back into full config
    const includeChildren = true // Always preserve children
    const mergedYaml = mergeItemYamlIntoConfig(
      yaml.dump(updatedData, { indent: 2, lineWidth: -1, noRefs: true }),
      !includeChildren
    )
    if (mergedYaml) {
      onChange(mergedYaml)
    }
  }, [hierarchyGuiData, parsedConfig, mergeItemYamlIntoConfig, onChange])

  // Handle hierarchy item GUI blur - ID fields are ONLY updated here (not on keystroke)
  // This validates uniqueness and applies the change
  // Uses refs to get current values since state might change if user clicks on another tree item
  const handleHierarchyGuiBlur = useCallback((path: string, value: unknown) => {
    console.log('[handleHierarchyGuiBlur] CALLED - path:', path, 'value:', value)
    
    // Only handle ID field updates
    if (path !== 'id' || typeof value !== 'string') {
      console.log('[handleHierarchyGuiBlur] SKIPPED - not ID field or not string')
      return
    }
    
    // Use refs to get current values (more reliable than closure state)
    const currentParsedConfig = parsedConfigRef.current
    const currentPath = selectedHierarchyPathRef.current
    const currentHierarchyItem = selectedHierarchyItemRef.current
    
    console.log('[handleHierarchyGuiBlur] currentPath:', currentPath, 'currentParsedConfig exists:', !!currentParsedConfig)
    
    if (!currentParsedConfig?.phases || currentPath.length === 0) {
      console.log('[handleHierarchyGuiBlur] SKIPPED - no config or empty path')
      return
    }
    
    const newId = value.trim()
    const oldId = currentPath[currentPath.length - 1]
    
    console.log('[handleHierarchyGuiBlur] newId:', newId, 'oldId:', oldId)
    
    // Skip if empty or unchanged
    if (!newId || newId === oldId) {
      console.log('[handleHierarchyGuiBlur] SKIPPED - empty or unchanged')
      return
    }
    
    console.log('[handleHierarchyGuiBlur] PROCEEDING with update...')
    
    // Find the current item data from the config (more reliable than hierarchyGuiData which might be stale)
    const findItemData = (): Record<string, unknown> | null => {
      let current: Array<{ id: string; [key: string]: unknown }> = currentParsedConfig.phases as Array<{ id: string; [key: string]: unknown }>
      let item: Record<string, unknown> | null = null
      
      for (let i = 0; i < currentPath.length; i++) {
        const id = currentPath[i]
        const found = current.find(c => c.id === id)
        if (!found) return null
        item = found as Record<string, unknown>
        
        if (i < currentPath.length - 1) {
          if (i === 0) current = (item.stages as Array<{ id: string; [key: string]: unknown }>) || []
          else if (i === 1) current = (item.blocks as Array<{ id: string; [key: string]: unknown }>) || []
          else if (i === 2) current = (item.tasks as Array<{ id: string; [key: string]: unknown }>) || []
        }
      }
      return item
    }
    
    const itemData = findItemData()
    if (!itemData) return
    
    // Collect all existing IDs from the hierarchy
    const allIds = collectAllHierarchyIds(currentParsedConfig.phases)
    
    // Check for uniqueness (excluding the old ID since we're renaming)
    const { id: finalId, wasDuplicate } = ensureUniqueId(newId, allIds, oldId)
    
    // Show warning if ID was modified due to duplicate
    if (wasDuplicate) {
      // Use setTimeout to show alert after state updates (avoid blocking)
      setTimeout(() => {
        alert(`ID "${newId}" already exists. Changed to "${finalId}" to ensure uniqueness.`)
      }, 100)
    }
    
    // Update the item data with the final ID
    const updatedData = { ...itemData }
    updatedData.id = finalId
    
    // Update the path with the final ID
    const newPath = [...currentPath]
    newPath[newPath.length - 1] = finalId
    setSelectedHierarchyPath(newPath)
    
    // Update the selected item with the final ID
    if (currentHierarchyItem) {
      setSelectedHierarchyItem({
        ...currentHierarchyItem,
        id: finalId,
      })
    }
    
    // Directly build the updated config (don't rely on mergeItemYamlIntoConfig which might use stale state)
    const updateItemInPhases = (): HierarchyPhase[] | null => {
      const phases = JSON.parse(JSON.stringify(currentParsedConfig.phases)) as HierarchyPhase[]
      let current: Array<{ id: string; [key: string]: unknown }> = phases as Array<{ id: string; [key: string]: unknown }>
      
      for (let i = 0; i < currentPath.length; i++) {
        const id = currentPath[i]
        const foundIndex = current.findIndex(c => c.id === id)
        if (foundIndex === -1) return null
        
        if (i === currentPath.length - 1) {
          // Replace the item, preserving children
          const existingItem = current[foundIndex]
          const itemLevel = currentPath.length - 1
          const mergedItem: Record<string, unknown> = { ...updatedData }
          
          // Preserve children from the existing item
          if (itemLevel === 0 && existingItem.stages) mergedItem.stages = existingItem.stages
          else if (itemLevel === 1 && existingItem.blocks) mergedItem.blocks = existingItem.blocks
          else if (itemLevel === 2 && existingItem.tasks) mergedItem.tasks = existingItem.tasks
          
          current[foundIndex] = mergedItem as { id: string; [key: string]: unknown }
          return phases
        } else {
          const item = current[foundIndex]
          if (i === 0) current = (item.stages as Array<{ id: string; [key: string]: unknown }>) || []
          else if (i === 1) current = (item.blocks as Array<{ id: string; [key: string]: unknown }>) || []
          else if (i === 2) current = (item.tasks as Array<{ id: string; [key: string]: unknown }>) || []
        }
      }
      return null
    }
    
    const updatedPhases = updateItemInPhases()
    if (!updatedPhases) {
      console.log('[handleHierarchyGuiBlur] FAILED - could not update phases')
      return
    }
    
    // Build and apply the updated config
    const settings = yaml.load(settingsYaml) as Record<string, unknown> || {}
    const fullConfig: Record<string, unknown> = { ...settings, phases: updatedPhases }
    delete fullConfig.stages
    const newYaml = yaml.dump(fullConfig, { indent: 2, lineWidth: -1, noRefs: true })
    console.log('[handleHierarchyGuiBlur] SUCCESS - calling onChange with new YAML')
    onChange(newYaml)
  }, [collectAllHierarchyIds, ensureUniqueId, onChange, settingsYaml])

  return (
    <div className="flex h-full">
      {/* Tabs Sidebar - expands when YAML editor is hidden */}
      <div className={`flex-shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col transition-all duration-300 ${
        !yamlEditorVisible ? 'w-[420px]' : 'w-80'
      }`}>
        {/* Header */}
        <div className="px-3 py-2 border-b border-slate-200 bg-white flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <TreeIcon className="w-4 h-4 text-slate-500" />
            Structure
          </h3>
        </div>

        {/* Tabs List or Hierarchy Tree - always show hierarchy when phases are supported (even if empty) */}
        {supportsPhases ? (
          <div className="flex-1 overflow-hidden">
            <HierarchyTreeEditor
              phases={hierarchyItems}
              onPhasesChange={handleHierarchyChange}
              onItemSelect={handleHierarchyItemSelect}
              selectedItemId={selectedHierarchyItemId}
              onSettingsSelect={() => {
                setSelectedHierarchyItemId(undefined)
                setSelectedHierarchyPath([])
                setSelectedHierarchyItem(null)
              }}
              isSettingsSelected={!selectedHierarchyItemId}
              onItemDuplicated={handleHierarchyItemDuplicated}
            />
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto py-2 stage-tabs-sidebar">
          {tabs.map((tab, _index) => {
            const isActive = tab.id === activeTabId
            const isStage = tab.type === 'stage'
            const stageData = isStage && tab.stageIndex !== undefined 
              ? parsedConfig?.stages?.[tab.stageIndex] 
              : null

            return (
              <div
                key={tab.id}
                className={`group relative mx-2 mb-1 rounded-md transition-colors ${
                  isActive 
                    ? 'bg-indigo-100 border border-indigo-300 ring-1 ring-indigo-400' 
                    : 'hover:bg-slate-100 border border-transparent'
                }`}
              >
                <button
                  onClick={() => handleTabSwitch(tab.id)}
                  className={`w-full text-left px-3 py-2 text-sm ${
                    isActive ? 'text-indigo-800 font-medium' : 'text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isStage ? (
                      <span className="w-5 h-5 flex items-center justify-center text-xs font-medium bg-slate-200 text-slate-600 rounded">
                        {(tab.stageIndex ?? 0) + 1}
                      </span>
                    ) : (
                      <SettingsIcon className="w-4 h-4 text-slate-500" />
                    )}
                    <span className="truncate flex-1">{tab.label}</span>
                  </div>
                  {stageData && (
                    <div className="ml-7 mt-0.5 text-xs text-slate-500 truncate">
                      {stageData.type}
                    </div>
                  )}
                </button>

                {/* Stage Controls - only for stage tabs and not readonly */}
                {isStage && tab.stageIndex !== undefined && !isReadOnly && (
                  <div className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 ${
                    isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  } transition-opacity`}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleMoveUp(tab.stageIndex!); }}
                      disabled={tab.stageIndex === 0}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up"
                    >
                      <ChevronUpIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleMoveDown(tab.stageIndex!); }}
                      disabled={tab.stageIndex === (parsedConfig?.stages?.length ?? 1) - 1}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down"
                    >
                      <ChevronDownIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDuplicateStage(tab.stageIndex!); }}
                      className="p-1 text-slate-400 hover:text-indigo-600"
                      title="Duplicate stage"
                    >
                      <DuplicateIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteStage(tab.stageIndex!); }}
                      className="p-1 text-slate-400 hover:text-red-600"
                      title="Delete stage"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        )}

        {/* Add Stage/Task Button */}
        {!isReadOnly && (
          <div ref={addMenuRef} className="relative p-2 border-t border-slate-200 bg-white">
            <button
              onClick={() => setAddStageMenuView(addStageMenuView === 'closed' ? 'main' : 'closed')}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors shadow-sm"
            >
              <PlusIcon className="w-4 h-4" />
              {hasPhases ? 'Add Task' : 'Add Stage'}
            </button>

            {/* Add Stage/Task Menu - Main View */}
            {addStageMenuView === 'main' && (
              <div className="absolute bottom-full left-2 right-2 mb-1 bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-10 add-stage-menu">
                <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase border-b border-slate-100">
                  {hasPhases ? 'Add New Task' : 'Add New Stage'}
                </div>
                {hasPhases && selectedHierarchyPath.length > 0 && (
                  <div className="px-3 py-1 text-xs text-slate-400 border-b border-slate-100">
                    Adding to: {selectedHierarchyItem?.label || selectedHierarchyItem?.id || 'selected item'}
                  </div>
                )}
                <button
                  onClick={() => setAddStageMenuView('templates')}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center justify-between transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <TemplateIcon className="w-4 h-4" />
                    From Template
                  </span>
                  <ChevronRightIcon className="w-4 h-4 text-slate-400" />
                </button>
                <button
                  onClick={() => setAddStageMenuView('basic')}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center justify-between transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <PlusCircleIcon className="w-4 h-4" />
                    {hasPhases ? 'Empty Task' : 'Empty Stage'}
                  </span>
                  <ChevronRightIcon className="w-4 h-4 text-slate-400" />
                </button>
              </div>
            )}

            {/* Add Stage Menu - Templates View */}
            {addStageMenuView === 'templates' && (
              <div className="absolute bottom-full left-2 right-2 mb-1 bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-10 add-stage-menu max-h-80 overflow-y-auto">
                <button
                  onClick={() => setAddStageMenuView('main')}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 flex items-center gap-1 border-b border-slate-100"
                >
                  <ChevronLeftIcon className="w-3 h-3" />
                  Back
                </button>
                
                {templatesLoading ? (
                  <div className="px-3 py-4 text-sm text-slate-500 text-center">
                    Loading templates...
                  </div>
                ) : stageTemplates.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-slate-500 text-center">
                    No templates available
                  </div>
                ) : (
                  <>
                    {/* Forms Category */}
                    {stageTemplates.some(t => t.category === 'forms') && (
                      <>
                        <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase bg-slate-50">
                          Forms
                        </div>
                        {stageTemplates
                          .filter(t => t.category === 'forms')
                          .map(template => (
                            <button
                              key={template.id}
                              onClick={() => handleAddStageFromTemplate(template.id)}
                              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                            >
                              <div className="font-medium">{template.name}</div>
                              <div className="text-xs text-slate-500">{template.description}</div>
                            </button>
                          ))}
                      </>
                    )}
                    
                    {/* Content Category */}
                    {stageTemplates.some(t => t.category === 'content') && (
                      <>
                        <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase bg-slate-50">
                          Content
                        </div>
                        {stageTemplates
                          .filter(t => t.category === 'content')
                          .map(template => (
                            <button
                              key={template.id}
                              onClick={() => handleAddStageFromTemplate(template.id)}
                              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                            >
                              <div className="font-medium">{template.name}</div>
                              <div className="text-xs text-slate-500">{template.description}</div>
                            </button>
                          ))}
                      </>
                    )}
                    
                    {/* Surveys Category */}
                    {stageTemplates.some(t => t.category === 'surveys') && (
                      <>
                        <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase bg-slate-50">
                          Surveys
                        </div>
                        {stageTemplates
                          .filter(t => t.category === 'surveys')
                          .map(template => (
                            <button
                              key={template.id}
                              onClick={() => handleAddStageFromTemplate(template.id)}
                              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                            >
                              <div className="font-medium">{template.name}</div>
                              <div className="text-xs text-slate-500">{template.description}</div>
                            </button>
                          ))}
                      </>
                    )}
                    
                    {/* Tasks Category */}
                    {stageTemplates.some(t => t.category === 'tasks') && (
                      <>
                        <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase bg-slate-50">
                          Tasks
                        </div>
                        {stageTemplates
                          .filter(t => t.category === 'tasks')
                          .map(template => (
                            <button
                              key={template.id}
                              onClick={() => handleAddStageFromTemplate(template.id)}
                              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                            >
                              <div className="font-medium">{template.name}</div>
                              <div className="text-xs text-slate-500">{template.description}</div>
                            </button>
                          ))}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Add Stage/Task Menu - Basic Types View */}
            {addStageMenuView === 'basic' && (
              <div className="absolute bottom-full left-2 right-2 mb-1 bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-10 add-stage-menu max-h-80 overflow-y-auto">
                <button
                  onClick={() => setAddStageMenuView('main')}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 flex items-center gap-1 border-b border-slate-100"
                >
                  <ChevronLeftIcon className="w-3 h-3" />
                  Back
                </button>
                <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase">
                  {hasPhases ? 'Task Types' : 'Stage Types'}
                </div>
                {STAGE_TYPES.map((type) => (
                  <button
                    key={type}
                    onClick={() => handleAddStage(type)}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                  >
                    {type.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Editor Area - Split View */}
      <div className="flex-1 flex min-w-0">
        {/* YAML Editor Panel - can be hidden */}
        {yamlEditorVisible && (
        <div className={`flex flex-col min-w-0 transition-all duration-300 ${guiEditorVisible ? 'w-1/2 border-r border-slate-200' : 'flex-1'}`}>
          {/* Editor Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <CodeIcon className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">YAML</span>
              {/* Show what content is being displayed */}
              {hasPhases && (
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                  yamlViewMode === 'full' 
                    ? 'bg-slate-200 text-slate-600' 
                    : selectedHierarchyItem 
                      ? 'bg-indigo-100 text-indigo-700' 
                      : 'bg-slate-200 text-slate-600'
                }`}>
                  {yamlViewMode === 'full' 
                    ? 'Full Config' 
                    : selectedHierarchyItem 
                      ? `${selectedHierarchyItem.type}: ${selectedHierarchyItem.label || selectedHierarchyItem.id}${yamlViewMode === 'selectedWithChildren' ? ' + children' : ''}`
                      : 'Settings'
                  }
                </span>
              )}
              {parseError && (
                <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
                  Error
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!hasPhases && activeStageIndex !== undefined && parsedConfig?.stages?.[activeStageIndex] && (
                <span className="text-xs px-2 py-0.5 bg-sky-100 text-sky-700 rounded font-medium">
                  {parsedConfig.stages[activeStageIndex].type}
                </span>
              )}
              {/* YAML View Mode Toggle - only in hierarchy mode */}
              {hasPhases && (
                <div className="flex items-center bg-slate-200 rounded-md p-0.5">
                  <button
                    type="button"
                    onClick={() => setYamlViewMode('full')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      yamlViewMode === 'full' 
                        ? 'bg-white text-slate-700 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                    title="Show full experiment configuration"
                  >
                    Full Config
                  </button>
                  <button
                    type="button"
                    onClick={() => setYamlViewMode('selectedWithChildren')}
                    disabled={selectedHierarchyPath.length === 0}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      yamlViewMode === 'selectedWithChildren' 
                        ? 'bg-white text-slate-700 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-700'
                    } ${selectedHierarchyPath.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={selectedHierarchyPath.length === 0 
                      ? 'Select an item in the structure to view its YAML' 
                      : 'Show selected item and all its children'
                    }
                  >
                    Item + Children
                  </button>
                  <button
                    type="button"
                    onClick={() => setYamlViewMode('selectedOnly')}
                    disabled={selectedHierarchyPath.length === 0}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      yamlViewMode === 'selectedOnly' 
                        ? 'bg-white text-slate-700 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-700'
                    } ${selectedHierarchyPath.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={selectedHierarchyPath.length === 0 
                      ? 'Select an item in the structure to view its YAML' 
                      : 'Show only the selected item (without children)'
                    }
                  >
                    Item Only
                  </button>
                </div>
              )}
              {/* Autocomplete Toggle */}
              {!isReadOnly && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-xs text-slate-500">Autocomplete</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autocompleteEnabled}
                    onClick={() => setAutocompleteEnabled(!autocompleteEnabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      autocompleteEnabled ? 'bg-primary-600' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                        autocompleteEnabled ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </label>
              )}
              {/* Hide YAML Editor button */}
              <button
                type="button"
                onClick={() => setYamlEditorVisible(false)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200"
                title="Hide YAML Editor"
              >
                <EyeOffIcon className="w-3.5 h-3.5" />
                Hide
              </button>
            </div>
          </div>

          {/* Editor Toolbar - for inserting assets, stages, questions, etc. */}
          {!isReadOnly && (
            <EditorToolbar editorRef={editorInstanceRef} />
          )}

          {/* Monaco Editor */}
          <div className="flex-1">
            <Editor
              height="100%"
              defaultLanguage="yaml"
              value={displayedEditorContent}
              onChange={handleEditorChange}
              theme="vs-light"
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                tabSize: 2,
                insertSpaces: true,
                // Autocomplete settings - disabled by default to prevent interference
                quickSuggestions: autocompleteEnabled && !isReadOnly ? { other: true, comments: false, strings: false } : false,
                suggestOnTriggerCharacters: false,
                // Prevent Enter from accepting suggestions - use Tab instead
                acceptSuggestionOnEnter: 'off',
                // Prevent other characters from accepting suggestions
                acceptSuggestionOnCommitCharacter: false,
                // Disable word-based suggestions that might interfere
                wordBasedSuggestions: 'off',
                // Disable parameter hints
                parameterHints: { enabled: false },
                // Suggestion widget settings
                suggest: {
                  insertMode: 'replace',
                  filterGraceful: false,
                  showWords: false,
                  showSnippets: autocompleteEnabled,
                  showKeywords: autocompleteEnabled,
                },
                readOnly: isReadOnly,
                automaticLayout: true,
              }}
            />
          </div>
        </div>
        )}

        {/* GUI Editor Panel - takes more space when YAML is hidden */}
        {guiEditorVisible && (
          <div className={`flex flex-col min-w-0 bg-white transition-all duration-300 ${yamlEditorVisible ? 'w-1/2' : 'flex-1'}`}>
            {/* GUI Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <FormIcon className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium text-slate-700">
                  {hasPhases 
                    ? (selectedHierarchyItem 
                        ? `${selectedHierarchyItem.type.charAt(0).toUpperCase() + selectedHierarchyItem.type.slice(1)}: ${selectedHierarchyItem.label || selectedHierarchyItem.id}`
                        : 'Settings Editor')
                    : (isSettingsTab ? 'Settings Editor' : 'Stage Editor')
                  }
                </span>
              </div>
              <div className="flex items-center gap-2">
                {parseError && (
                  <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded font-medium">
                    Fix YAML errors to enable GUI editing
                  </span>
                )}
                {/* Show YAML Editor button when hidden */}
                {!yamlEditorVisible && (
                  <button
                    type="button"
                    onClick={() => setYamlEditorVisible(true)}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors bg-indigo-100 text-indigo-700 border border-indigo-200 hover:bg-indigo-200"
                    title="Show YAML Editor"
                  >
                    <CodeIcon className="w-3.5 h-3.5" />
                    Show YAML
                  </button>
                )}
                {/* Hide GUI Editor button */}
                <button
                  type="button"
                  onClick={() => setGuiEditorVisible(false)}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200"
                  title="Hide Visual Editor"
                >
                  <EyeOffIcon className="w-3.5 h-3.5" />
                  Hide
                </button>
              </div>
            </div>

            {/* GUI Content */}
            <div className="flex-1 overflow-y-auto">
              {parseError ? (
                <div className="p-6 text-center text-gray-500">
                  <WarningIcon className="w-12 h-12 mx-auto mb-3 text-yellow-400" />
                  <p className="text-sm font-medium">YAML Parse Error</p>
                  <p className="text-xs mt-1 text-gray-400">
                    Fix the YAML syntax error to use the visual editor
                  </p>
                  <pre className="mt-3 p-2 text-xs text-left bg-red-50 text-red-700 rounded overflow-auto max-h-32">
                    {parseError}
                  </pre>
                </div>
              ) : showHierarchySettings ? (
                /* Settings view in hierarchy mode */
                <div className="p-4">
                  <SettingsGuiEditor
                    settings={guiData}
                    onChange={handleGuiChange}
                    disabled={isReadOnly}
                    experimentId={experimentId}
                  />
                </div>
              ) : showHierarchyItem ? (
                /* Hierarchy item view */
                isHierarchyTask && hierarchyGuiData ? (
                  <StageGuiEditor
                    stageData={hierarchyGuiData}
                    onChange={handleHierarchyGuiChange}
                    onBlur={handleHierarchyGuiBlur}
                    disabled={isReadOnly}
                    experimentId={experimentId}
                    duplicationSource={hierarchyDuplicationSource}
                    onClearDuplicationSource={handleClearHierarchyDuplicationSource}
                  />
                ) : (
                  /* Phase/Stage/Block properties view - Full GUI editor */
                  <div className="p-4">
                    {hierarchyGuiData && selectedHierarchyItem && hierarchyContext && (
                      <HierarchyItemEditor
                        itemType={selectedHierarchyItem.type as 'phase' | 'stage' | 'block'}
                        itemData={hierarchyGuiData}
                        onChange={handleHierarchyGuiChange}
                        onBlur={handleHierarchyGuiBlur}
                        disabled={isReadOnly}
                        context={hierarchyContext}
                      />
                    )}
                  </div>
                )
              ) : isSettingsTab ? (
                /* Settings view in flat mode */
                <div className="p-4">
                  <SettingsGuiEditor
                    settings={guiData}
                    onChange={handleGuiChange}
                    disabled={isReadOnly}
                    experimentId={experimentId}
                  />
                </div>
              ) : (
                /* Stage view in flat mode */
                <StageGuiEditor
                  stageData={guiData}
                  onChange={handleGuiChange}
                  onBatchChange={handleBatchGuiChange}
                  disabled={isReadOnly}
                  experimentId={experimentId}
                  duplicationSource={currentDuplicationSource}
                  onClearDuplicationSource={handleClearDuplicationSource}
                />
              )}
            </div>
          </div>
        )}
        
        {/* Fallback panel when both editors are hidden */}
        {!yamlEditorVisible && !guiEditorVisible && (
          <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 p-8">
            <div className="text-center max-w-md">
              <div className="flex justify-center gap-4 mb-6">
                <CodeIcon className="w-12 h-12 text-slate-300" />
                <FormIcon className="w-12 h-12 text-slate-300" />
              </div>
              <h3 className="text-lg font-medium text-slate-600 mb-2">Choose an Editor View</h3>
              <p className="text-sm text-slate-500 mb-6">
                Select which editor you want to use. You can show both for a split view.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setYamlEditorVisible(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors font-medium"
                >
                  <CodeIcon className="w-4 h-4" />
                  Show YAML Editor
                </button>
                <button
                  onClick={() => setGuiEditorVisible(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors font-medium"
                >
                  <FormIcon className="w-4 h-4" />
                  Show Visual Editor
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Refactor Modal */}
      {refactorTarget && (
        <RefactorModal
          isOpen={!!refactorTarget}
          onClose={() => setRefactorTarget(null)}
          onApply={refactorTarget.stageIndex !== undefined ? handleStageRefactorApply : handleHierarchyRefactorApply}
          itemData={refactorTarget.data}
          itemType={refactorTarget.type}
          itemId={refactorTarget.id}
        />
      )}
    </div>
  )
})

// Icons
function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
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

function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  )
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
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

function DuplicateIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  )
}

function TemplateIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
      />
    </svg>
  )
}

function PlusCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
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

function FormIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  )
}

function TreeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6v12M9 10h3M9 14h3" />
    </svg>
  )
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}

