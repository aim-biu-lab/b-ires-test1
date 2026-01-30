/**
 * GUI Schema for Visual Stage Editor
 * Provides complete metadata for generating form controls
 */

import {
  STAGE_TYPES,
  QUESTION_TYPES,
  FIELD_TYPES,
  TIMEOUT_ACTIONS,
  QUOTA_STRATEGIES,
  THEMES,
  CONTENT_TYPES,
  MC_QUESTION_TYPES,
  MC_ANSWER_TYPES,
  MC_LAYOUTS,
  MC_LABEL_STYLES,
  MC_BADGE_COLORS,
  NAVIGATION_BAR_POSITIONS,
  ORDERING_MODES,
  BALANCE_ON_OPTIONS,
  PICK_STRATEGIES,
} from './yaml-schema'

// ============================================================================
// GUI Field Types
// ============================================================================

export type GuiFieldType = 
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'range'
  | 'array'
  | 'object'
  | 'asset'
  | 'code'
  | 'weights'           // Context-aware weight editor for weighted distribution
  | 'visibility_rule'   // Visibility rule builder with variable picker
  | 'latin_square'      // Latin Square sequence preview (read-only)
  | 'pick_assigns'      // Key-value pairs for assigning variables when picked
  | 'pick_conditions'   // Conditions for filtering candidates based on pick_assigns

export interface SelectOption {
  value: string
  label: string
  description?: string
}

export interface GuiFieldDefinition {
  key: string
  label: string
  description: string
  type: GuiFieldType
  required?: boolean
  default?: unknown
  placeholder?: string
  // For select fields
  options?: SelectOption[]
  // For number fields
  min?: number
  max?: number
  step?: number
  // For array fields
  itemSchema?: GuiFieldDefinition[]
  itemLabel?: string
  minItems?: number
  maxItems?: number
  // For object fields (nested)
  properties?: GuiFieldDefinition[]
  // For asset fields
  assetTypes?: ('image' | 'video' | 'audio' | 'html' | 'any')[]
  // For textarea/code fields
  rows?: number
  language?: string
  // Conditional visibility
  showWhen?: {
    field: string
    value: unknown
    operator?: '==' | '!=' | 'in' | 'notIn'
  }
  // Section grouping
  section?: string
  // Grid row grouping (for array item fields)
  // Fields with the same gridRow number will be rendered in the same row
  gridRow?: number
  // Context requirements for special field types
  // 'children' - field needs info about child items (for weights, latin_square)
  // 'variables' - field needs available variables (for visibility_rule)
  contextRequired?: 'children' | 'variables'
}

export interface GuiSection {
  id: string
  label: string
  description?: string
  collapsible?: boolean
  defaultExpanded?: boolean
}

// ============================================================================
// Helper to create select options from const arrays
// ============================================================================

function createSelectOptions(values: readonly string[], labelFormatter?: (v: string) => string): SelectOption[] {
  return values.map(v => ({
    value: v,
    label: labelFormatter ? labelFormatter(v) : v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }))
}

// ============================================================================
// Common Field Definitions (shared across stage types)
// ============================================================================

export const COMMON_STAGE_FIELDS: GuiFieldDefinition[] = [
  {
    key: 'id',
    label: 'Stage ID',
    description: 'Unique identifier for this stage (use snake_case)',
    type: 'text',
    required: true,
    placeholder: 'my_stage_id',
    section: 'basic',
  },
  {
    key: 'type',
    label: 'Stage Type',
    description: 'The type of stage determines its behavior and appearance',
    type: 'select',
    required: true,
    options: createSelectOptions(STAGE_TYPES),
    section: 'basic',
  },
  {
    key: 'label',
    label: 'Display Label',
    description: 'Short label shown in sidebar and progress bar',
    type: 'text',
    placeholder: 'Stage Label',
    section: 'basic',
  },
  {
    key: 'title',
    label: 'Title',
    description: 'Main title shown in the top bar',
    type: 'text',
    placeholder: 'Stage Title',
    section: 'basic',
  },
  {
    key: 'description',
    label: 'Description',
    description: 'Short instruction shown below the title',
    type: 'textarea',
    rows: 2,
    placeholder: 'Instructions for this stage...',
    section: 'basic',
  },
  {
    key: 'mandatory',
    label: 'Mandatory',
    description: 'Whether this stage must be completed',
    type: 'boolean',
    default: true,
    section: 'behavior',
  },
  {
    key: 'visibility_rule',
    label: 'Visibility Rule',
    description: 'JsonLogic expression for conditional display (e.g., "demographics.age > 18")',
    type: 'text',
    placeholder: 'stage_id.field == "value"',
    section: 'behavior',
  },
  {
    key: 'pick_assigns',
    label: 'Pick Assigns',
    description: 'Variables to assign when this item is picked (used with pick_conditions)',
    type: 'pick_assigns',
    section: 'behavior',
  },
]

export const TIMING_FIELDS: GuiFieldDefinition[] = [
  {
    key: 'timing.min_duration_ms',
    label: 'Minimum Duration (ms)',
    description: 'Minimum time before allowing progression (disables Next button)',
    type: 'number',
    min: 0,
    step: 1000,
    placeholder: '5000',
  },
  {
    key: 'timing.max_duration_ms',
    label: 'Maximum Duration (ms)',
    description: 'Maximum time allowed before timeout (only on first visit, not when returning)',
    type: 'number',
    min: 0,
    step: 1000,
    placeholder: '60000',
  },
  {
    key: 'timing.show_timer',
    label: 'Show Countdown Timer',
    description: 'Display countdown timer showing remaining time (only active on first visit)',
    type: 'boolean',
    default: false,
  },
  {
    key: 'timing.show_elapsed_time',
    label: 'Show Elapsed Time',
    description: 'Display time spent on this step (always visible, independent of countdown)',
    type: 'boolean',
    default: false,
  },
  {
    key: 'timing.on_timeout',
    label: 'Timeout Action',
    description: 'Action when maximum duration is reached',
    type: 'select',
    options: createSelectOptions(TIMEOUT_ACTIONS),
    default: 'auto_submit',
  },
]

export const QUOTA_FIELDS: GuiFieldDefinition[] = [
  {
    key: 'quota.limit',
    label: 'Quota Limit',
    description: 'Maximum number of completions allowed',
    type: 'number',
    min: 1,
    placeholder: '20',
  },
  {
    key: 'quota.strategy',
    label: 'Quota Strategy',
    description: 'What to do when quota is reached',
    type: 'select',
    options: createSelectOptions(QUOTA_STRATEGIES),
    default: 'skip_if_full',
  },
  {
    key: 'quota.fallback_stage',
    label: 'Fallback Stage',
    description: 'Stage ID to jump to if quota is full',
    type: 'text',
    placeholder: 'alternative_stage',
    showWhen: { field: 'quota.strategy', value: 'show_alternative' },
  },
]

// ============================================================================
// 4-Level Hierarchy Field Definitions
// ============================================================================

// Weight configuration for weighted distribution
export const WEIGHT_ITEM_SCHEMA: GuiFieldDefinition[] = [
  {
    key: 'id',
    label: 'Child ID',
    description: 'ID of the child to assign weight to',
    type: 'text',
    required: true,
    placeholder: 'child_id',
  },
  {
    key: 'value',
    label: 'Weight Value',
    description: 'Weight value (higher = more likely)',
    type: 'number',
    min: 1,
    default: 1,
  },
]

// Rules configuration for any hierarchy level
export const RULES_FIELDS: GuiFieldDefinition[] = [
  {
    key: 'rules.ordering',
    label: 'Ordering Mode',
    description: 'How children are ordered for participants',
    type: 'select',
    options: createSelectOptions(ORDERING_MODES),
    default: 'sequential',
  },
  {
    key: 'rules.visibility',
    label: 'Visibility Rule',
    description: 'Condition for when this item should be shown to participants',
    type: 'visibility_rule',
    placeholder: 'participant.group == "treatment"',
    contextRequired: 'variables',
  },
  {
    key: 'rules.balance_on',
    label: 'Balance On',
    description: 'When to count for balanced distribution',
    type: 'select',
    options: createSelectOptions(BALANCE_ON_OPTIONS),
    default: 'started',
    showWhen: { field: 'rules.ordering', value: 'balanced' },
  },
  {
    key: 'rules.weights',
    label: 'Weight Distribution',
    description: 'Configure probability weights for each child variant',
    type: 'weights',
    contextRequired: 'children',
    showWhen: { field: 'rules.ordering', value: 'weighted' },
  },
  {
    key: 'rules.latin_square_preview',
    label: 'Latin Square Sequences',
    description: 'Auto-generated orderings for counterbalancing',
    type: 'latin_square',
    contextRequired: 'children',
    showWhen: { field: 'rules.ordering', value: 'latin_square' },
  },
  {
    key: 'rules.quota',
    label: 'Branch Quota',
    description: 'Maximum participants for this branch',
    type: 'number',
    min: 1,
    placeholder: '50',
  },
  // Pick N children fields
  {
    key: 'rules.pick_count',
    label: 'Pick Count',
    description: 'Show only this many children (leave empty to show all). Applied before visibility rules and ordering.',
    type: 'number',
    min: 1,
    placeholder: 'Show all',
  },
  {
    key: 'rules.pick_strategy',
    label: 'Pick Strategy',
    description: 'How to select which children to show',
    type: 'select',
    options: createSelectOptions(PICK_STRATEGIES),
    default: 'random',
    showWhen: { field: 'rules.pick_count', value: undefined, operator: '!=' },
  },
  {
    key: 'rules.pick_weights',
    label: 'Pick Weights',
    description: 'Configure probability weights for weighted random picking',
    type: 'weights',
    contextRequired: 'children',
    showWhen: { field: 'rules.pick_strategy', value: 'weighted_random' },
  },
  {
    key: 'rules.pick_conditions',
    label: 'Pick Conditions',
    description: 'Filter candidates based on variables assigned by previously picked children',
    type: 'pick_conditions',
    showWhen: { field: 'rules.pick_count', value: undefined, operator: '!=' },
  },
]

// UI settings for hierarchy levels
export const UI_SETTINGS_FIELDS: GuiFieldDefinition[] = [
  {
    key: 'ui_settings.visible_to_participant',
    label: 'Visible to Participant',
    description: 'Show in sidebar and progress indicators',
    type: 'boolean',
    default: true,
  },
  {
    key: 'ui_settings.show_in_sidebar',
    label: 'Show in Sidebar',
    description: 'Explicitly show/hide in sidebar',
    type: 'boolean',
    default: true,
  },
  {
    key: 'ui_settings.label',
    label: 'Display Label Override',
    description: 'Override the default label',
    type: 'text',
    placeholder: 'Custom Label',
  },
  {
    key: 'ui_settings.collapsed_by_default',
    label: 'Collapsed by Default',
    description: 'Start with this section collapsed',
    type: 'boolean',
    default: false,
  },
]

// Common navigation lock field - can be applied at any hierarchy level
export const ALLOW_JUMP_TO_COMPLETED_FIELD: GuiFieldDefinition = {
  key: 'allow_jump_to_completed',
  label: 'Allow Return After Completion',
  description: 'If disabled, participant cannot return to this item (or items within) after completing and moving forward',
  type: 'boolean',
  default: true,
  section: 'behavior',
}

// Phase-level fields
export const PHASE_FIELDS: GuiFieldDefinition[] = [
  {
    key: 'id',
    label: 'Phase ID',
    description: 'Unique identifier for this phase (snake_case)',
    type: 'text',
    required: true,
    placeholder: 'onboarding',
    section: 'basic',
  },
  {
    key: 'label',
    label: 'Display Label',
    description: 'Label shown in sidebar and progress',
    type: 'text',
    placeholder: 'Onboarding',
    section: 'basic',
  },
  {
    key: 'title',
    label: 'Title',
    description: 'Title shown to participants',
    type: 'text',
    placeholder: 'Getting Started',
    section: 'basic',
  },
  {
    key: 'description',
    label: 'Description',
    description: 'Brief description of this phase',
    type: 'textarea',
    rows: 2,
    placeholder: 'Complete the initial setup steps',
    section: 'basic',
  },
  { ...ALLOW_JUMP_TO_COMPLETED_FIELD, section: 'behavior' },
  {
    key: 'pick_assigns',
    label: 'Pick Assigns',
    description: 'Variables to assign when this phase is picked (used with pick_conditions)',
    type: 'pick_assigns',
    section: 'behavior',
  },
  ...RULES_FIELDS.map(f => ({ ...f, section: 'rules' })),
  ...UI_SETTINGS_FIELDS.map(f => ({ ...f, section: 'ui' })),
]

// Block-level fields
export const BLOCK_FIELDS: GuiFieldDefinition[] = [
  {
    key: 'id',
    label: 'Block ID',
    description: 'Unique identifier for this block (snake_case)',
    type: 'text',
    required: true,
    placeholder: 'consent_block',
    section: 'basic',
  },
  {
    key: 'label',
    label: 'Display Label',
    description: 'Label shown in sidebar',
    type: 'text',
    placeholder: 'Consent',
    section: 'basic',
  },
  {
    key: 'title',
    label: 'Title',
    description: 'Title shown to participants',
    type: 'text',
    placeholder: 'Informed Consent',
    section: 'basic',
  },
  {
    key: 'description',
    label: 'Description',
    description: 'Brief description of this block',
    type: 'textarea',
    rows: 2,
    section: 'basic',
  },
  { ...ALLOW_JUMP_TO_COMPLETED_FIELD, section: 'behavior' },
  {
    key: 'pick_assigns',
    label: 'Pick Assigns',
    description: 'Variables to assign when this block is picked (used with pick_conditions)',
    type: 'pick_assigns',
    section: 'behavior',
  },
  ...RULES_FIELDS.map(f => ({ ...f, section: 'rules' })),
  ...UI_SETTINGS_FIELDS.map(f => ({ ...f, section: 'ui' })),
]

// Hierarchy sections for editors
export const HIERARCHY_SECTIONS: GuiSection[] = [
  { id: 'basic', label: 'Basic Information', defaultExpanded: true },
  { id: 'behavior', label: 'Behavior', collapsible: true, defaultExpanded: false },
  { id: 'rules', label: 'Rules & Distribution', collapsible: true, defaultExpanded: false },
  { id: 'ui', label: 'UI Settings', collapsible: true, defaultExpanded: false },
]

// Layout/positioning fields for form-based stages
export const LAYOUT_FIELDS: GuiFieldDefinition[] = [
  {
    key: 'layout.max_width',
    label: 'Max Width',
    description: 'Maximum width of the content area (e.g., "600px", "80%")',
    type: 'text',
    placeholder: '600px',
  },
  {
    key: 'layout.width',
    label: 'Width',
    description: 'Explicit width of the content area (e.g., "500px", "100%")',
    type: 'text',
    default: '100%',
    placeholder: '100%',
  },
  {
    key: 'layout.align_horizontal',
    label: 'Horizontal Alignment',
    description: 'How to align content horizontally',
    type: 'select',
    options: [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
    ],
    default: 'center',
  },
  {
    key: 'layout.align_vertical',
    label: 'Vertical Alignment',
    description: 'How to align content vertically',
    type: 'select',
    options: [
      { value: 'top', label: 'Top' },
      { value: 'upper-third', label: 'Upper Third (1/3 from top)' },
      { value: 'middle', label: 'Middle' },
      { value: 'lower-third', label: 'Lower Third (1/3 from bottom)' },
      { value: 'bottom', label: 'Bottom' },
    ],
    default: 'top',
  },
  {
    key: 'layout.margin_top',
    label: 'Top Margin',
    description: 'Space from the top (e.g., "20px", "2rem")',
    type: 'text',
    placeholder: '2rem',
  },
  {
    key: 'layout.padding',
    label: 'Padding',
    description: 'Inner padding (e.g., "20px", "1rem 2rem")',
    type: 'text',
    placeholder: '0',
  },
]

// ============================================================================
// Stage-Specific Field Definitions
// ============================================================================

// Questionnaire Question Schema
export const QUESTION_ITEM_SCHEMA: GuiFieldDefinition[] = [
  {
    key: 'id',
    label: 'Question ID',
    description: 'Unique identifier for this question',
    type: 'text',
    required: true,
    placeholder: 'q1',
  },
  {
    key: 'text',
    label: 'Question Text',
    description: 'The question to display',
    type: 'textarea',
    required: true,
    rows: 2,
    placeholder: 'Enter your question here...',
  },
  {
    key: 'type',
    label: 'Input Type',
    description: 'Type of input for the answer',
    type: 'select',
    required: true,
    options: createSelectOptions(QUESTION_TYPES),
    default: 'text',
  },
  {
    key: 'required',
    label: 'Required',
    description: 'Whether an answer is required',
    type: 'boolean',
    default: true,
  },
  {
    key: 'placeholder',
    label: 'Placeholder',
    description: 'Placeholder text for the input',
    type: 'text',
  },
  {
    key: 'margin',
    label: 'Margin',
    description: 'CSS margin for the input element (e.g., "20px", "50px 0 40px 0")',
    type: 'text',
    placeholder: '0',
  },
  {
    key: 'options',
    label: 'Options',
    description: 'Options for select/radio/checkbox types',
    type: 'array',
    showWhen: { field: 'type', value: ['select', 'radio', 'checkbox'], operator: 'in' },
    itemLabel: 'Option',
    itemSchema: [
      { key: 'value', label: 'Value', type: 'text', required: true, description: 'Option value (stored in data)' },
      { key: 'label', label: 'Label', type: 'text', required: true, description: 'Display label' },
    ],
  },
  {
    key: 'range',
    label: 'Scale Range',
    description: 'Min and max values for simple numeric likert scale (ignored if custom options provided)',
    type: 'range',
    showWhen: { field: 'type', value: 'likert_scale' },
    default: [1, 5],
  },
  {
    key: 'likert_options',
    label: 'Custom Answer Options',
    description: 'Custom labels and scores for each answer option (overrides range)',
    type: 'array',
    showWhen: { field: 'type', value: 'likert_scale' },
    itemLabel: 'Option',
    itemSchema: [
      { key: 'label', label: 'Label', type: 'text', required: true, description: 'Visible label (e.g., "Strongly Agree")' },
      { key: 'score', label: 'Score', type: 'number', required: true, description: 'Hidden score value (e.g., 5)' },
    ],
  },
  {
    key: 'show_faces',
    label: 'Show Face Images',
    description: 'Display face images for each option (auto-disabled if more than 5 options)',
    type: 'boolean',
    default: true,
    showWhen: { field: 'type', value: 'likert_scale' },
  },
  {
    key: 'show_score',
    label: 'Show Numeric Score',
    description: 'Display the numeric score value alongside the label',
    type: 'boolean',
    default: false,
    showWhen: { field: 'type', value: 'likert_scale' },
  },
  {
    key: 'style_config.option_gap',
    label: 'Option Gap (px)',
    description: 'Gap between answer options in pixels',
    type: 'number',
    min: 0,
    max: 50,
    default: 8,
    showWhen: { field: 'type', value: 'likert_scale' },
  },
  {
    key: 'style_config.option_padding',
    label: 'Option Padding (px)',
    description: 'Padding inside each answer option in pixels',
    type: 'number',
    min: 0,
    max: 50,
    default: 16,
    showWhen: { field: 'type', value: 'likert_scale' },
  },
  {
    key: 'style_config.margin_top',
    label: 'Top Margin (px)',
    description: 'Margin from top of question block in pixels',
    type: 'number',
    min: 0,
    max: 100,
    showWhen: { field: 'type', value: 'likert_scale' },
  },
  {
    key: 'style_config.margin_bottom',
    label: 'Bottom Margin (px)',
    description: 'Margin from bottom of options row in pixels',
    type: 'number',
    min: 0,
    max: 100,
    showWhen: { field: 'type', value: 'likert_scale' },
  },
  {
    key: 'validation',
    label: 'Validation Pattern',
    description: 'Regex pattern for validation',
    type: 'text',
    placeholder: '^[A-Za-z]+$',
  },
  {
    key: 'validation_message',
    label: 'Validation Message',
    description: 'Error message for invalid input',
    type: 'text',
  },
]

// User Info Field Schema
export const USER_INFO_FIELD_SCHEMA: GuiFieldDefinition[] = [
  {
    key: 'field',
    label: 'Field ID',
    description: 'Unique identifier for this field',
    type: 'text',
    required: true,
    placeholder: 'field_name',
  },
  {
    key: 'label',
    label: 'Label',
    description: 'Display label for the field',
    type: 'text',
    required: true,
    placeholder: 'Field Label',
  },
  {
    key: 'type',
    label: 'Input Type',
    description: 'Type of input field',
    type: 'select',
    required: true,
    options: [
      ...createSelectOptions(FIELD_TYPES),
      { value: 'header', label: 'Header (display only)' },
      { value: 'consent', label: 'Consent Checkbox' },
    ],
    default: 'text',
  },
  {
    key: 'required',
    label: 'Required',
    description: 'Whether this field is required',
    type: 'boolean',
    default: true,
  },
  {
    key: 'placeholder',
    label: 'Placeholder',
    description: 'Placeholder text',
    type: 'text',
  },
  {
    key: 'margin',
    label: 'Margin',
    description: 'CSS margin for the input element (e.g., "20px", "50px 0 40px 0")',
    type: 'text',
    placeholder: '0',
  },
  {
    key: 'helpText',
    label: 'Help Text',
    description: 'Helper text shown below the field',
    type: 'text',
  },
  {
    key: 'headerText',
    label: 'Header Text',
    description: 'Text for header type or above field',
    type: 'textarea',
    rows: 2,
  },
  {
    key: 'row',
    label: 'Row Number',
    description: 'Row for layout grouping',
    type: 'number',
    min: 1,
  },
  {
    key: 'width',
    label: 'Width',
    description: 'Field width in row',
    type: 'select',
    options: [
      { value: 'full', label: 'Full Width' },
      { value: 'half', label: 'Half (1/2)' },
      { value: 'third', label: 'Third (1/3)' },
      { value: 'quarter', label: 'Quarter (1/4)' },
      { value: 'two-thirds', label: 'Two Thirds (2/3)' },
    ],
    default: 'full',
  },
  {
    key: 'options',
    label: 'Options',
    description: 'Options for select/radio types',
    type: 'array',
    showWhen: { field: 'type', value: ['select', 'radio'], operator: 'in' },
    itemLabel: 'Option',
    itemSchema: [
      { key: 'value', label: 'Value', type: 'text', required: true, description: 'Option value' },
      { key: 'label', label: 'Label', type: 'text', required: true, description: 'Display label' },
    ],
  },
  {
    key: 'min',
    label: 'Minimum Value',
    description: 'Minimum value for number fields',
    type: 'number',
    showWhen: { field: 'type', value: 'number' },
  },
  {
    key: 'max',
    label: 'Maximum Value',
    description: 'Maximum value for number fields',
    type: 'number',
    showWhen: { field: 'type', value: 'number' },
  },
  {
    key: 'validation',
    label: 'Validation Pattern',
    description: 'Regex validation pattern',
    type: 'text',
  },
  {
    key: 'validation_message',
    label: 'Validation Message',
    description: 'Error message for validation failure',
    type: 'text',
  },
  {
    key: 'consentUrl',
    label: 'Consent URL',
    description: 'Link to consent form document',
    type: 'text',
    showWhen: { field: 'type', value: 'consent' },
  },
  {
    key: 'consentLinkText',
    label: 'Consent Link Text',
    description: 'Text for the consent form link',
    type: 'text',
    showWhen: { field: 'type', value: 'consent' },
    default: 'consent form',
  },
]

// Participant Identity Field Schema (extends User Info with enabled/include_in_label)
export const PARTICIPANT_IDENTITY_FIELD_SCHEMA: GuiFieldDefinition[] = [
  {
    key: 'field',
    label: 'Field ID',
    description: 'Unique identifier for this field',
    type: 'text',
    required: true,
    placeholder: 'field_name',
  },
  {
    key: 'label',
    label: 'Label',
    description: 'Display label for the field (leave empty for placeholder-only)',
    type: 'text',
    placeholder: 'Field Label',
  },
  {
    key: 'type',
    label: 'Input Type',
    description: 'Type of input field',
    type: 'select',
    required: true,
    options: [
      { value: 'text', label: 'Text' },
      { value: 'email', label: 'Email' },
      { value: 'number', label: 'Number' },
      { value: 'select', label: 'Select/Dropdown' },
    ],
    default: 'text',
  },
  {
    key: 'enabled',
    label: 'Enabled',
    description: 'Show this field in the form',
    type: 'boolean',
    default: true,
  },
  {
    key: 'required',
    label: 'Required',
    description: 'Whether this field is mandatory',
    type: 'boolean',
    default: false,
  },
  {
    key: 'include_in_label',
    label: 'Include in Participant Label',
    description: 'Include this field value in the participant label (concatenated with underscore)',
    type: 'boolean',
    default: false,
  },
  {
    key: 'placeholder',
    label: 'Placeholder',
    description: 'Placeholder text',
    type: 'text',
  },
  {
    key: 'margin',
    label: 'Margin',
    description: 'CSS margin for the input element (e.g., "20px", "50px 0 40px 0")',
    type: 'text',
    placeholder: '0',
  },
  {
    key: 'validation',
    label: 'Validation Pattern',
    description: 'Regex pattern for validation',
    type: 'text',
    placeholder: '^[A-Za-z\\s]+$',
  },
  {
    key: 'validation_message',
    label: 'Validation Message',
    description: 'Error message when validation fails',
    type: 'text',
    placeholder: 'Please enter a valid value',
  },
  {
    key: 'row',
    label: 'Row Number',
    description: 'Row for layout grouping',
    type: 'number',
    min: 1,
  },
  {
    key: 'width',
    label: 'Width',
    description: 'Field width in row',
    type: 'select',
    options: [
      { value: 'full', label: 'Full Width' },
      { value: 'half', label: 'Half (1/2)' },
      { value: 'third', label: 'Third (1/3)' },
      { value: 'quarter', label: 'Quarter (1/4)' },
      { value: 'two-thirds', label: 'Two Thirds (2/3)' },
    ],
    default: 'half',
  },
  {
    key: 'options',
    label: 'Options',
    description: 'Options for select type',
    type: 'array',
    showWhen: { field: 'type', value: 'select' },
    itemLabel: 'Option',
    itemSchema: [
      { key: 'value', label: 'Value', type: 'text', required: true, description: 'Option value' },
      { key: 'label', label: 'Label', type: 'text', required: true, description: 'Display label' },
    ],
  },
]

// Multiple Choice Answer Schema
export const MC_ANSWER_SCHEMA: GuiFieldDefinition[] = [
  {
    key: 'id',
    label: 'Answer ID',
    description: 'Unique identifier (e.g., a, b, c, d)',
    type: 'text',
    required: true,
    placeholder: 'a',
    gridRow: 1,
  },
  {
    key: 'type',
    label: 'Answer Type',
    description: 'Type of answer content',
    type: 'select',
    required: true,
    options: createSelectOptions(MC_ANSWER_TYPES),
    default: 'text',
    gridRow: 1,
  },
  {
    key: 'content',
    label: 'Content',
    description: 'Answer text or HTML content',
    type: 'textarea',
    required: true,
    rows: 2,
  },
  {
    key: 'image_url',
    label: 'Image URL',
    description: 'URL for image answers',
    type: 'asset',
    assetTypes: ['image'],
    showWhen: { field: 'type', value: ['image', 'text_with_image'], operator: 'in' },
  },
  {
    key: 'subtext',
    label: 'Subtext',
    description: 'Secondary text below main content',
    type: 'text',
  },
  {
    key: 'explanation',
    label: 'Explanation',
    description: 'Per-answer explanation shown after submission',
    type: 'textarea',
    rows: 2,
  },
  {
    key: 'placeholder',
    label: 'Placeholder',
    description: 'Placeholder for free text input',
    type: 'text',
    showWhen: { field: 'type', value: 'free_text' },
  },
  {
    key: 'badges',
    label: 'Badges',
    description: 'Badge/tag indicators for this answer',
    type: 'array',
    itemLabel: 'Badge',
    itemSchema: [
      { key: 'text', label: 'Badge Text', type: 'text', required: true, description: 'Badge label (e.g., "AI CHOICE")' },
      {
        key: 'color',
        label: 'Color',
        type: 'select',
        options: createSelectOptions(MC_BADGE_COLORS),
        default: 'blue',
        description: 'Badge color',
      },
    ],
  },
]

// ============================================================================
// Stage Type Configurations
// ============================================================================

export interface StageTypeConfig {
  type: typeof STAGE_TYPES[number]
  label: string
  description: string
  sections: GuiSection[]
  fields: GuiFieldDefinition[]
}

export const QUESTIONNAIRE_CONFIG: StageTypeConfig = {
  type: 'questionnaire',
  label: 'Questionnaire',
  description: 'A survey with multiple questions',
  sections: [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'questions', label: 'Questions', defaultExpanded: true },
    { id: 'layout', label: 'Layout', collapsible: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
    { id: 'timing', label: 'Timing', collapsible: true },
  ],
  fields: [
    ...COMMON_STAGE_FIELDS,
    {
      key: 'questions',
      label: 'Questions',
      description: 'List of questions in this questionnaire',
      type: 'array',
      required: true,
      itemLabel: 'Question',
      itemSchema: QUESTION_ITEM_SCHEMA,
      section: 'questions',
    },
    { ...ALLOW_JUMP_TO_COMPLETED_FIELD },
    ...LAYOUT_FIELDS.map(f => ({ ...f, section: 'layout' })),
    ...TIMING_FIELDS.map(f => ({ ...f, section: 'timing' })),
  ],
}

export const USER_INFO_CONFIG: StageTypeConfig = {
  type: 'user_info',
  label: 'User Info',
  description: 'Collect participant demographics and information',
  sections: [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'fields', label: 'Fields', defaultExpanded: true },
    { id: 'layout', label: 'Layout', collapsible: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
    { id: 'timing', label: 'Timing', collapsible: true },
  ],
  fields: [
    ...COMMON_STAGE_FIELDS,
    {
      key: 'editable_after_submit',
      label: 'Editable After Submit',
      description: 'Allow participant to edit after submission',
      type: 'boolean',
      default: false,
      section: 'behavior',
    },
    {
      key: 'invalidates_dependents',
      label: 'Invalidates Dependents',
      description: 'Re-validate dependent stages when edited',
      type: 'boolean',
      default: false,
      section: 'behavior',
    },
    { ...ALLOW_JUMP_TO_COMPLETED_FIELD },
    {
      key: 'fields',
      label: 'Fields',
      description: 'Information fields to collect',
      type: 'array',
      required: true,
      itemLabel: 'Field',
      itemSchema: USER_INFO_FIELD_SCHEMA,
      section: 'fields',
    },
    ...LAYOUT_FIELDS.map(f => ({ ...f, section: 'layout' })),
    ...TIMING_FIELDS.map(f => ({ ...f, section: 'timing' })),
  ],
}

export const PARTICIPANT_IDENTITY_CONFIG: StageTypeConfig = {
  type: 'participant_identity',
  label: 'Participant Identity',
  description: 'Collect participant identity to create a visible label (replaces P1, P2, etc.)',
  sections: [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'fields', label: 'Identity Fields', defaultExpanded: true },
    { id: 'layout', label: 'Layout', collapsible: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
    { id: 'timing', label: 'Timing', collapsible: true },
  ],
  fields: [
    ...COMMON_STAGE_FIELDS,
    {
      key: 'editable_after_submit',
      label: 'Editable After Submit',
      description: 'Allow participant to edit identity after submission',
      type: 'boolean',
      default: false,
      section: 'behavior',
    },
    { ...ALLOW_JUMP_TO_COMPLETED_FIELD },
    {
      key: 'fields_description',
      label: 'Fields Description',
      description: 'Short description text displayed above the identity fields',
      type: 'textarea',
      rows: 2,
      placeholder: 'Please enter your details below to identify yourself.',
      section: 'fields',
    },
    {
      key: 'fields',
      label: 'Identity Fields',
      description: 'Fields to collect for participant identity. Fields with "Include in Label" checked will be concatenated with underscores to form the participant label.',
      type: 'array',
      required: true,
      itemLabel: 'Field',
      itemSchema: PARTICIPANT_IDENTITY_FIELD_SCHEMA,
      section: 'fields',
    },
    ...LAYOUT_FIELDS.map(f => ({ ...f, section: 'layout' })),
    ...TIMING_FIELDS.map(f => ({ ...f, section: 'timing' })),
  ],
}

export const CONSENT_FORM_CONFIG: StageTypeConfig = {
  type: 'consent_form',
  label: 'Consent Form',
  description: 'Informed consent with agreement checkbox',
  sections: [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'content', label: 'Content', defaultExpanded: true },
    { id: 'layout', label: 'Layout', collapsible: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
    { id: 'timing', label: 'Timing', collapsible: true },
  ],
  fields: [
    ...COMMON_STAGE_FIELDS,
    {
      key: 'content_type',
      label: 'Content Type',
      description: 'Format of the consent content',
      type: 'select',
      options: createSelectOptions(CONTENT_TYPES),
      default: 'html',
      section: 'content',
    },
    {
      key: 'content',
      label: 'Content',
      description: 'The consent form content (HTML/Markdown)',
      type: 'code',
      language: 'html',
      rows: 15,
      section: 'content',
    },
    {
      key: 'editable_after_submit',
      label: 'Editable After Submit',
      description: 'Allow participant to withdraw consent',
      type: 'boolean',
      default: false,
      section: 'behavior',
    },
    { ...ALLOW_JUMP_TO_COMPLETED_FIELD },
    ...LAYOUT_FIELDS.map(f => ({ ...f, section: 'layout' })),
    ...TIMING_FIELDS.map(f => ({ ...f, section: 'timing' })),
  ],
}

export const CONTENT_DISPLAY_CONFIG: StageTypeConfig = {
  type: 'content_display',
  label: 'Content Display',
  description: 'Display static content (instructions, information)',
  sections: [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'content', label: 'Content', defaultExpanded: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
    { id: 'timing', label: 'Timing', collapsible: true },
  ],
  fields: [
    ...COMMON_STAGE_FIELDS,
    {
      key: 'content_type',
      label: 'Content Type',
      description: 'Format of the content',
      type: 'select',
      options: createSelectOptions(CONTENT_TYPES),
      default: 'html',
      section: 'content',
    },
    {
      key: 'content',
      label: 'Content',
      description: 'Content to display (HTML/Markdown)',
      type: 'code',
      language: 'html',
      rows: 15,
      section: 'content',
    },
    {
      key: 'reference',
      label: 'Allow Reference',
      description: 'Allow returning to view this content later',
      type: 'boolean',
      default: false,
      section: 'behavior',
    },
    {
      key: 'reference_label',
      label: 'Reference Button Label',
      description: 'Label for the reference button',
      type: 'text',
      placeholder: 'View Instructions',
      showWhen: { field: 'reference', value: true },
      section: 'behavior',
    },
    { ...ALLOW_JUMP_TO_COMPLETED_FIELD },
    ...TIMING_FIELDS.map(f => ({ ...f, section: 'timing' })),
  ],
}

export const VIDEO_PLAYER_CONFIG: StageTypeConfig = {
  type: 'video_player',
  label: 'Video Player',
  description: 'Play a video with optional controls',
  sections: [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'video', label: 'Video Settings', defaultExpanded: true },
    { id: 'controls', label: 'Player Controls', defaultExpanded: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
    { id: 'timing', label: 'Timing', collapsible: true },
  ],
  fields: [
    ...COMMON_STAGE_FIELDS,
    {
      key: 'source',
      label: 'Video Source',
      description: 'URL or asset path to the video file',
      type: 'asset',
      assetTypes: ['video'],
      required: true,
      section: 'video',
    },
    {
      key: 'config.autoplay',
      label: 'Autoplay',
      description: 'Start playing automatically',
      type: 'boolean',
      default: false,
      section: 'controls',
    },
    {
      key: 'config.controls',
      label: 'Show Controls',
      description: 'Show video player controls',
      type: 'boolean',
      default: true,
      section: 'controls',
    },
    {
      key: 'config.allow_seek',
      label: 'Allow Seeking',
      description: 'Allow skipping forward/backward',
      type: 'boolean',
      default: true,
      section: 'controls',
    },
    {
      key: 'config.allow_pause',
      label: 'Allow Pause',
      description: 'Allow pausing the video',
      type: 'boolean',
      default: true,
      section: 'controls',
    },
    {
      key: 'config.require_complete',
      label: 'Require Full Watch',
      description: 'Must watch entire video to continue',
      type: 'boolean',
      default: false,
      section: 'behavior',
    },
    {
      key: 'completion_trigger',
      label: 'Completion Trigger',
      description: 'When the stage is considered complete',
      type: 'select',
      options: [
        { value: 'media_ended', label: 'Video Ended' },
        { value: 'manual', label: 'Manual (Continue button)' },
      ],
      default: 'media_ended',
      section: 'behavior',
    },
    { ...ALLOW_JUMP_TO_COMPLETED_FIELD },
    ...TIMING_FIELDS.map(f => ({ ...f, section: 'timing' })),
  ],
}

export const IFRAME_SANDBOX_CONFIG: StageTypeConfig = {
  type: 'iframe_sandbox',
  label: 'Iframe Sandbox',
  description: 'Embed an external task in an iframe',
  sections: [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'iframe', label: 'Iframe Settings', defaultExpanded: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
    { id: 'timing', label: 'Timing', collapsible: true },
  ],
  fields: [
    ...COMMON_STAGE_FIELDS,
    {
      key: 'source',
      label: 'Source URL',
      description: 'URL of the iframe content',
      type: 'asset',
      assetTypes: ['html', 'any'],
      required: true,
      section: 'iframe',
    },
    {
      key: 'config.height',
      label: 'Height',
      description: 'Iframe height (e.g., "600px", "100%")',
      type: 'text',
      default: '600px',
      placeholder: '600px',
      section: 'iframe',
    },
    {
      key: 'config.width',
      label: 'Width',
      description: 'Iframe width (e.g., "100%", "800px")',
      type: 'text',
      default: '100%',
      placeholder: '100%',
      section: 'iframe',
    },
    {
      key: 'config.allow_fullscreen',
      label: 'Allow Fullscreen',
      description: 'Allow the iframe to go fullscreen',
      type: 'boolean',
      default: false,
      section: 'iframe',
    },
    {
      key: 'config.allow_clipboard',
      label: 'Allow Clipboard',
      description: 'Allow clipboard access in iframe',
      type: 'boolean',
      default: false,
      section: 'iframe',
    },
    {
      key: 'config.completion_trigger',
      label: 'Completion Message',
      description: 'postMessage type for task completion',
      type: 'text',
      default: 'TASK_COMPLETE',
      placeholder: 'TASK_COMPLETE',
      section: 'behavior',
    },
    {
      key: 'config.auto_complete',
      label: 'Auto-Advance',
      description: 'Automatically advance when task completes',
      type: 'boolean',
      default: false,
      section: 'behavior',
    },
    { ...ALLOW_JUMP_TO_COMPLETED_FIELD },
    ...TIMING_FIELDS.map(f => ({ ...f, section: 'timing' })),
  ],
}

export const LIKERT_SCALE_CONFIG: StageTypeConfig = {
  type: 'likert_scale',
  label: 'Likert Scale',
  description: 'Single likert scale rating with customizable labels and face images',
  sections: [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'question', label: 'Question', defaultExpanded: true },
    { id: 'scale', label: 'Scale Settings', defaultExpanded: true },
    { id: 'appearance', label: 'Appearance', defaultExpanded: true },
    { id: 'style', label: 'Styling', collapsible: true },
    { id: 'layout', label: 'Layout', collapsible: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
    { id: 'timing', label: 'Timing', collapsible: true },
  ],
  fields: [
    ...COMMON_STAGE_FIELDS,
    {
      key: 'question_text',
      label: 'Question Text',
      description: 'The question text displayed above the scale options',
      type: 'textarea',
      placeholder: 'Enter your question here...',
      section: 'question',
    },
    {
      key: 'range',
      label: 'Scale Range',
      description: 'Minimum and maximum values (ignored if custom options provided)',
      type: 'range',
      default: [1, 5],
      section: 'scale',
    },
    {
      key: 'likert_options',
      label: 'Custom Answer Options',
      description: 'Define custom labels and scores for each answer option',
      type: 'array',
      itemLabel: 'Option',
      itemSchema: [
        { key: 'label', label: 'Label', type: 'text', required: true, description: 'Visible label (e.g., "Strongly Agree")' },
        { key: 'score', label: 'Score', type: 'number', required: true, description: 'Hidden score value (e.g., 5)' },
      ],
      section: 'scale',
    },
    {
      key: 'show_faces',
      label: 'Show Face Images',
      description: 'Display face images for each option (auto-disabled if more than 5 options)',
      type: 'boolean',
      default: true,
      section: 'appearance',
    },
    {
      key: 'show_score',
      label: 'Show Numeric Score',
      description: 'Display the numeric score value alongside the label',
      type: 'boolean',
      default: false,
      section: 'appearance',
    },
    {
      key: 'likert_style_config.option_gap',
      label: 'Option Gap (px)',
      description: 'Gap between answer options in pixels',
      type: 'number',
      min: 0,
      max: 50,
      default: 8,
      section: 'style',
    },
    {
      key: 'likert_style_config.option_padding',
      label: 'Option Padding (px)',
      description: 'Padding inside each answer option in pixels',
      type: 'number',
      min: 0,
      max: 50,
      default: 16,
      section: 'style',
    },
    {
      key: 'likert_style_config.margin_top',
      label: 'Top Margin (px)',
      description: 'Margin from top of question block in pixels',
      type: 'number',
      min: 0,
      max: 100,
      section: 'style',
    },
    {
      key: 'likert_style_config.margin_bottom',
      label: 'Bottom Margin (px)',
      description: 'Margin from bottom of options row in pixels',
      type: 'number',
      min: 0,
      max: 100,
      section: 'style',
    },
    { ...ALLOW_JUMP_TO_COMPLETED_FIELD },
    ...LAYOUT_FIELDS.map(f => ({ ...f, section: 'layout' })),
    ...TIMING_FIELDS.map(f => ({ ...f, section: 'timing' })),
  ],
}

export const ATTENTION_CHECK_CONFIG: StageTypeConfig = {
  type: 'attention_check',
  label: 'Attention Check',
  description: 'Verify participant is paying attention',
  sections: [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'questions', label: 'Questions', defaultExpanded: true },
    { id: 'validation', label: 'Validation', defaultExpanded: true },
    { id: 'layout', label: 'Layout', collapsible: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
    { id: 'timing', label: 'Timing', collapsible: true },
  ],
  fields: [
    ...COMMON_STAGE_FIELDS,
    {
      key: 'questions',
      label: 'Questions',
      description: 'Attention check questions',
      type: 'array',
      itemLabel: 'Question',
      itemSchema: QUESTION_ITEM_SCHEMA,
      section: 'questions',
    },
    {
      key: 'expected_answer',
      label: 'Expected Answer',
      description: 'The correct answer value',
      type: 'text',
      required: true,
      section: 'validation',
    },
    {
      key: 'failure_message',
      label: 'Failure Message',
      description: 'Message shown if attention check fails',
      type: 'textarea',
      rows: 2,
      section: 'validation',
    },
    { ...ALLOW_JUMP_TO_COMPLETED_FIELD },
    ...LAYOUT_FIELDS.map(f => ({ ...f, section: 'layout' })),
    ...TIMING_FIELDS.map(f => ({ ...f, section: 'timing' })),
  ],
}

export const EXTERNAL_TASK_CONFIG: StageTypeConfig = {
  type: 'external_task',
  label: 'External Task',
  description: 'Task in external application (opens in new window)',
  sections: [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'url', label: 'External URL', defaultExpanded: true },
    { id: 'window', label: 'Window Settings', defaultExpanded: true },
    { id: 'completion', label: 'Completion', defaultExpanded: true },
    { id: 'timeout', label: 'Timeout', collapsible: true },
    { id: 'ui', label: 'UI Messages', collapsible: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
  ],
  fields: [
    ...COMMON_STAGE_FIELDS,
    {
      key: 'target_url',
      label: 'Target URL',
      description: 'URL of the external application (task_token appended automatically)',
      type: 'text',
      required: true,
      placeholder: 'https://external-app.example.com/task',
      section: 'url',
    },
    {
      key: 'config.window_mode',
      label: 'Window Mode',
      description: 'How to open the external window',
      type: 'select',
      options: [
        { value: 'popup', label: 'Popup Window' },
        { value: 'fullscreen', label: 'Fullscreen' },
        { value: 'tab', label: 'New Tab' },
      ],
      default: 'popup',
      section: 'window',
    },
    {
      key: 'config.window_width',
      label: 'Window Width',
      description: 'Popup window width in pixels',
      type: 'number',
      min: 400,
      max: 2560,
      default: 1200,
      showWhen: { field: 'config.window_mode', value: 'popup' },
      section: 'window',
    },
    {
      key: 'config.window_height',
      label: 'Window Height',
      description: 'Popup window height in pixels',
      type: 'number',
      min: 300,
      max: 1440,
      default: 800,
      showWhen: { field: 'config.window_mode', value: 'popup' },
      section: 'window',
    },
    {
      key: 'config.completion_mode',
      label: 'Completion Mode',
      description: 'How task completion is determined',
      type: 'select',
      options: [
        { value: 'required', label: 'Required - Must receive completion signal' },
        { value: 'optional', label: 'Optional - Can skip without completion' },
        { value: 'manual', label: 'Manual - User clicks "Mark as Done"' },
      ],
      default: 'required',
      section: 'completion',
    },
    {
      key: 'config.try_close_on_complete',
      label: 'Close Window on Complete',
      description: 'Attempt to close external window when task completes',
      type: 'boolean',
      default: true,
      section: 'completion',
    },
    {
      key: 'config.timeout_ms',
      label: 'Timeout (ms)',
      description: 'Maximum time before timeout (0 = no timeout)',
      type: 'number',
      min: 0,
      step: 1000,
      default: 0,
      placeholder: '600000',
      section: 'timeout',
    },
    {
      key: 'config.timeout_action',
      label: 'Timeout Action',
      description: 'What happens when timeout occurs',
      type: 'select',
      options: [
        { value: 'prompt', label: 'Prompt - Show dialog with options' },
        { value: 'skip', label: 'Skip - Auto-skip if not mandatory' },
        { value: 'retry', label: 'Retry - Auto-restart the task' },
        { value: 'fail', label: 'Fail - Block progress' },
      ],
      default: 'prompt',
      section: 'timeout',
    },
    {
      key: 'config.allow_retry_on_timeout',
      label: 'Allow Retry on Timeout',
      description: 'Show "Try Again" button when timeout occurs',
      type: 'boolean',
      default: true,
      section: 'timeout',
    },
    {
      key: 'config.max_retries',
      label: 'Max Retries',
      description: 'Maximum retry attempts (0 = unlimited)',
      type: 'number',
      min: 0,
      default: 3,
      section: 'timeout',
    },
    {
      key: 'config.button_text',
      label: 'Button Text',
      description: 'Text on the launch button',
      type: 'text',
      default: 'Open Task',
      section: 'ui',
    },
    {
      key: 'config.waiting_message',
      label: 'Waiting Message',
      description: 'Message shown while waiting for completion',
      type: 'text',
      default: 'Waiting for task completion...',
      section: 'ui',
    },
    {
      key: 'config.completed_message',
      label: 'Completed Message',
      description: 'Message shown when task completes',
      type: 'text',
      default: 'Task completed successfully!',
      section: 'ui',
    },
    {
      key: 'config.ready_text',
      label: 'Ready Text',
      description: 'Status text shown when task is ready to start',
      type: 'text',
      default: 'Ready to start',
      section: 'ui',
    },
    {
      key: 'config.ready_description',
      label: 'Ready Description',
      description: 'Optional description shown above the button when ready to start',
      type: 'textarea',
      rows: 2,
      placeholder: 'Enter a short description to help participants understand the task...',
      section: 'ui',
    },
    {
      key: 'config.block_width',
      label: 'Block Width',
      description: 'Width of the task block container (e.g., 40%, 500px)',
      type: 'text',
      default: '40%',
      placeholder: '40%',
      section: 'ui',
    },
    {
      key: 'config.enable_reverse_control',
      label: 'Enable Reverse Control',
      description: 'Allow sending commands to external app',
      type: 'boolean',
      default: false,
      section: 'behavior',
    },
    { ...ALLOW_JUMP_TO_COMPLETED_FIELD },
  ],
}

export const MULTIPLE_CHOICE_CONFIG: StageTypeConfig = {
  type: 'multiple_choice',
  label: 'Multiple Choice',
  description: 'Question with selectable answer options',
  sections: [
    { id: 'basic', label: 'Basic Settings', defaultExpanded: true },
    { id: 'question', label: 'Question', defaultExpanded: true },
    { id: 'answers', label: 'Answers', defaultExpanded: true },
    { id: 'scoring', label: 'Scoring', collapsible: true },
    { id: 'answer_layout', label: 'Answer Layout & Labels', defaultExpanded: true },
    { id: 'positioning', label: 'Content Positioning', collapsible: true },
    { id: 'feedback', label: 'Feedback', collapsible: true },
    { id: 'behavior', label: 'Behavior', collapsible: true },
    { id: 'timing', label: 'Timing', collapsible: true },
  ],
  fields: [
    ...COMMON_STAGE_FIELDS,
    // Question section
    {
      key: 'question.type',
      label: 'Question Type',
      description: 'Type of question content',
      type: 'select',
      options: createSelectOptions(MC_QUESTION_TYPES),
      default: 'text',
      section: 'question',
    },
    {
      key: 'question.content',
      label: 'Question Content',
      description: 'The question text or HTML',
      type: 'textarea',
      required: true,
      rows: 3,
      section: 'question',
    },
    {
      key: 'question.subtext',
      label: 'Question Subtext',
      description: 'Secondary text below the question',
      type: 'text',
      section: 'question',
    },
    {
      key: 'question.image_url',
      label: 'Question Image',
      description: 'Image for image-type questions',
      type: 'asset',
      assetTypes: ['image'],
      showWhen: { field: 'question.type', value: 'image' },
      section: 'question',
    },
    {
      key: 'question.video_url',
      label: 'Question Video',
      description: 'Video for video-type questions',
      type: 'asset',
      assetTypes: ['video'],
      showWhen: { field: 'question.type', value: 'video' },
      section: 'question',
    },
    // Answers section
    {
      key: 'answers',
      label: 'Answers',
      description: 'Answer options',
      type: 'array',
      required: true,
      itemLabel: 'Answer',
      itemSchema: MC_ANSWER_SCHEMA,
      minItems: 2,
      section: 'answers',
    },
    // Answer Layout section
    {
      key: 'config.layout',
      label: 'Answer Layout',
      description: 'How answers are arranged',
      type: 'select',
      options: createSelectOptions(MC_LAYOUTS),
      default: 'single_column',
      section: 'answer_layout',
    },
    {
      key: 'config.show_answer_labels',
      label: 'Show Answer Labels',
      description: 'Show A, B, C, D labels on answers',
      type: 'boolean',
      default: true,
      section: 'answer_layout',
    },
    {
      key: 'config.label_style',
      label: 'Label Style',
      description: 'Format of answer labels',
      type: 'select',
      options: createSelectOptions(MC_LABEL_STYLES),
      default: 'letter',
      showWhen: { field: 'config.show_answer_labels', value: true },
      section: 'answer_layout',
    },
    {
      key: 'config.randomize_order',
      label: 'Randomize Order',
      description: 'Randomize the order of answer options',
      type: 'boolean',
      default: false,
      section: 'answer_layout',
    },
    // Content Positioning section
    ...LAYOUT_FIELDS.map(f => ({ ...f, section: 'positioning' })),
    // Scoring section
    {
      key: 'config.correct_answer',
      label: 'Correct Answer(s)',
      description: 'Answer ID(s) that are correct (comma-separated for multiple)',
      type: 'text',
      placeholder: 'a',
      section: 'scoring',
    },
    {
      key: 'config.allow_multiple_selection',
      label: 'Allow Multiple Selection',
      description: 'Allow selecting more than one answer',
      type: 'boolean',
      default: false,
      section: 'scoring',
    },
    {
      key: 'config.track_score',
      label: 'Track Score',
      description: 'Track correct/incorrect for scoring',
      type: 'boolean',
      default: false,
      section: 'scoring',
    },
    {
      key: 'config.show_score_to_participant',
      label: 'Show Score to Participant',
      description: 'Display running score to participant',
      type: 'boolean',
      default: false,
      showWhen: { field: 'config.track_score', value: true },
      section: 'scoring',
    },
    {
      key: 'config.score_format',
      label: 'Score Format',
      description: 'Score display template (use {{correct}} and {{total}})',
      type: 'text',
      default: 'Correct: {{correct}} of {{total}}',
      showWhen: { field: 'config.show_score_to_participant', value: true },
      section: 'scoring',
    },
    // Feedback section
    {
      key: 'config.show_correct_after_submit',
      label: 'Show Correct After Submit',
      description: 'Highlight correct answer after submission',
      type: 'boolean',
      default: true,
      section: 'feedback',
    },
    {
      key: 'config.feedback_delay',
      label: 'Feedback Delay (seconds)',
      description: 'Time to show feedback before auto-advancing. Set to 0 for manual advance (user clicks Next)',
      type: 'number',
      default: 1.5,
      min: 0,
      max: 30,
      step: 0.5,
      showWhen: { field: 'config.show_correct_after_submit', value: true },
      section: 'feedback',
    },
    {
      key: 'config.show_explanation_after_submit',
      label: 'Show Explanation After Submit',
      description: 'Show main explanation after submission',
      type: 'boolean',
      default: false,
      section: 'feedback',
    },
    {
      key: 'explanation_before_submit',
      label: 'Explanation Before Submit',
      description: 'HTML shown before participant submits (hint)',
      type: 'code',
      language: 'html',
      rows: 3,
      section: 'feedback',
    },
    {
      key: 'explanation_after_submit',
      label: 'Explanation After Submit',
      description: 'HTML shown after participant submits',
      type: 'code',
      language: 'html',
      rows: 3,
      section: 'feedback',
    },
    {
      key: 'config.show_answer_explanations',
      label: 'Show Answer Explanations',
      description: 'Show per-answer explanations after submission',
      type: 'boolean',
      default: false,
      section: 'feedback',
    },
    // Behavior section
    {
      key: 'config.lock_after_submit',
      label: 'Lock After Submit',
      description: 'Prevent changing answer after submission',
      type: 'boolean',
      default: true,
      section: 'behavior',
    },
    { ...ALLOW_JUMP_TO_COMPLETED_FIELD },
    ...TIMING_FIELDS.map(f => ({ ...f, section: 'timing' })),
  ],
}

// ============================================================================
// Settings (Meta & Shell Config) Schema
// ============================================================================

export const META_FIELDS: GuiFieldDefinition[] = [
  {
    key: 'meta.id',
    label: 'Experiment ID',
    description: 'Unique identifier for this experiment (snake_case)',
    type: 'text',
    required: true,
    placeholder: 'my_experiment_v1',
  },
  {
    key: 'meta.version',
    label: 'Version',
    description: 'Semantic version (e.g., "1.0.0")',
    type: 'text',
    required: true,
    default: '1.0.0',
    placeholder: '1.0.0',
  },
  {
    key: 'meta.name',
    label: 'Name',
    description: 'Human-readable experiment name',
    type: 'text',
    placeholder: 'My Experiment',
  },
  {
    key: 'meta.description',
    label: 'Description',
    description: 'Brief description of the experiment',
    type: 'textarea',
    rows: 3,
  },
  {
    key: 'meta.author',
    label: 'Author',
    description: 'Experiment author name',
    type: 'text',
  },
  {
    key: 'meta.extends',
    label: 'Extends',
    description: 'Parent template ID to inherit from',
    type: 'text',
    placeholder: 'base_template',
  },
  {
    key: 'meta.debug_mode',
    label: 'Debug Mode',
    description: 'Enable debug mode to show a "Debug Fill" button for participants, allowing quick form filling with random/default values for testing purposes',
    type: 'boolean',
    default: false,
  },
]

export const SHELL_CONFIG_FIELDS: GuiFieldDefinition[] = [
  {
    key: 'shell_config.theme',
    label: 'Theme',
    description: 'Visual theme for the experiment shell',
    type: 'select',
    options: createSelectOptions(THEMES),
    default: 'clinical_blue',
  },
  {
    key: 'shell_config.logo_url',
    label: 'Logo URL',
    description: 'URL to custom logo image',
    type: 'asset',
    assetTypes: ['image'],
  },
  // Progress settings
  {
    key: 'shell_config.progress.show_progress_bar',
    label: 'Show Progress Bar',
    description: 'Display progress bar at top',
    type: 'boolean',
    default: true,
  },
  {
    key: 'shell_config.progress.show_counter',
    label: 'Show Step Counter',
    description: 'Show "Step X of Y" counter',
    type: 'boolean',
    default: true,
  },
  {
    key: 'shell_config.progress.show_percentage',
    label: 'Show Percentage',
    description: 'Show completion percentage',
    type: 'boolean',
    default: false,
  },
  // Sidebar settings
  {
    key: 'shell_config.sidebar.enabled',
    label: 'Enable Sidebar',
    description: 'Show sidebar navigation',
    type: 'boolean',
    default: true,
  },
  {
    key: 'shell_config.sidebar.allow_navigation',
    label: 'Allow Navigation',
    description: 'Allow clicking on completed stages',
    type: 'boolean',
    default: true,
  },
  // Navigation bar settings
  {
    key: 'shell_config.navigation_bar.position',
    label: 'Position',
    description: 'Where to display the navigation bar with prev/next buttons',
    type: 'select',
    options: createSelectOptions(NAVIGATION_BAR_POSITIONS),
    default: 'top',
  },
  {
    key: 'shell_config.navigation_bar.show_header_placeholder',
    label: 'Show Header Placeholder',
    description: 'When navigation is at bottom, show a header with title/description at the top',
    type: 'boolean',
    default: true,
  },
  // Custom CSS
  {
    key: 'shell_config.custom_css',
    label: 'Custom CSS',
    description: 'Custom CSS to inject',
    type: 'code',
    language: 'css',
    rows: 8,
  },
]

export const SETTINGS_SECTIONS: GuiSection[] = [
  { id: 'meta', label: 'Experiment Metadata', defaultExpanded: true },
  { id: 'theme', label: 'Theme & Appearance', defaultExpanded: true },
  { id: 'progress', label: 'Progress Indicators', collapsible: true, defaultExpanded: true },
  { id: 'sidebar', label: 'Sidebar Navigation', collapsible: true },
  { id: 'navigation_bar', label: 'Navigation Bar', collapsible: true },
  { id: 'custom', label: 'Custom Styling', collapsible: true },
]

// ============================================================================
// Stage Type Config Registry
// ============================================================================

export const STAGE_TYPE_CONFIGS: Record<string, StageTypeConfig> = {
  questionnaire: QUESTIONNAIRE_CONFIG,
  user_info: USER_INFO_CONFIG,
  participant_identity: PARTICIPANT_IDENTITY_CONFIG,
  consent_form: CONSENT_FORM_CONFIG,
  content_display: CONTENT_DISPLAY_CONFIG,
  video_player: VIDEO_PLAYER_CONFIG,
  likert_scale: LIKERT_SCALE_CONFIG,
  iframe_sandbox: IFRAME_SANDBOX_CONFIG,
  attention_check: ATTENTION_CHECK_CONFIG,
  external_task: EXTERNAL_TASK_CONFIG,
  multiple_choice: MULTIPLE_CHOICE_CONFIG,
}

export function getStageTypeConfig(stageType: string): StageTypeConfig | undefined {
  return STAGE_TYPE_CONFIGS[stageType]
}

