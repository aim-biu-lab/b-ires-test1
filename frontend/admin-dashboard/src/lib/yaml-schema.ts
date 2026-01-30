/**
 * B-IRES YAML Schema for Monaco Editor Autocomplete
 * Provides IntelliSense-style completion for experiment configuration
 */

import * as monaco from 'monaco-editor'

// Stage types available in B-IRES
export const STAGE_TYPES = [
  'questionnaire',
  'user_info',
  'participant_identity',
  'consent_form',
  'content_display',
  'video_player',
  'likert_scale',
  'iframe_sandbox',
  'attention_check',
  'external_task',
  'multiple_choice',
] as const

// Question types for questionnaire blocks
export const QUESTION_TYPES = [
  'text',
  'textarea',
  'number',
  'select',
  'radio',
  'checkbox',
  'likert_scale',
  'slider',
  'date',
  'time',
  'email',
  'hidden',
] as const

// Field types for user_info blocks
export const FIELD_TYPES = [
  'text',
  'number',
  'select',
  'radio',
  'date',
  'email',
] as const

// Timeout actions
export const TIMEOUT_ACTIONS = [
  'auto_submit',
  'skip_stage',
  'lock_interface',
  'prompt',
] as const

// Horizontal alignment options
export const HORIZONTAL_ALIGNMENTS = [
  'left',
  'center',
  'right',
] as const

// Vertical alignment options
export const VERTICAL_ALIGNMENTS = [
  'top',
  'upper-third',
  'middle',
  'lower-third',
  'bottom',
] as const

// Navigation bar position options
export const NAVIGATION_BAR_POSITIONS = [
  'top',
  'bottom',
] as const

// Quota strategies
export const QUOTA_STRATEGIES = [
  'skip_if_full',
  'wait_for_slot',
  'show_alternative',
] as const

// Themes
export const THEMES = [
  'clinical_blue',
  'dark_research',
  'high_contrast',
  'minimal_white',
] as const

// Content types
export const CONTENT_TYPES = [
  'html',
  'markdown',
  'plain',
] as const

// Multiple choice question types
export const MC_QUESTION_TYPES = [
  'text',
  'image',
  'video',
  'html',
] as const

// Multiple choice answer types
export const MC_ANSWER_TYPES = [
  'text',
  'image',
  'text_with_image',
  'html',
  'free_text',
] as const

// Multiple choice layout options
export const MC_LAYOUTS = [
  'single_column',
  '2x2',
  '2x3',
  '3x2',
  '3x3',
  '3x4',
  '4x3',
  '4x4',
  '5x5',
  'auto',
] as const

// Multiple choice label styles
export const MC_LABEL_STYLES = [
  'letter',
  'number',
  'none',
] as const

// Badge/tag colors for answer options
export const MC_BADGE_COLORS = [
  'green',
  'blue',
  'yellow',
  'red',
  'gray',
] as const

// ============================================================================
// 4-Level Hierarchy Constants
// ============================================================================

// Ordering modes for children at any hierarchy level
export const ORDERING_MODES = [
  'sequential',     // Fixed order (1, 2, 3...)
  'randomized',     // Seeded shuffle per participant
  'balanced',       // Least-filled algorithm for equal groups
  'weighted',       // Probability-based assignment
  'latin_square',   // Order counterbalancing
] as const

// When to count for balanced distribution
export const BALANCE_ON_OPTIONS = [
  'started',    // Count when participant enters
  'completed',  // Count when participant finishes
] as const

// Pick strategies for selecting X out of N children
export const PICK_STRATEGIES = [
  'random',          // Pick X children randomly using participant's seed
  'round_robin',     // Rotate through children combinations across participants
  'weighted_random', // Pick based on probability weights
] as const

// Pick condition operators for filtering candidates
export const PICK_CONDITION_OPERATORS = [
  'not_in',  // Child's value must NOT be in accumulated values (alias: !=)
  'in',      // Child's value must BE in accumulated values (alias: ==)
  '!=',      // Alias for not_in
  '==',      // Alias for in
] as const

// Schema structure for autocomplete
export interface SchemaNode {
  description?: string
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean'
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  enum?: readonly string[]
  required?: string[]
  default?: unknown
}

export const BIRES_SCHEMA: SchemaNode = {
  type: 'object',
  properties: {
    meta: {
      description: 'Experiment metadata',
      type: 'object',
      properties: {
        id: {
          description: 'Unique experiment identifier (snake_case)',
          type: 'string',
        },
        version: {
          description: 'Semantic version (e.g., "1.0.0")',
          type: 'string',
          default: '1.0.0',
        },
        name: {
          description: 'Human-readable experiment name',
          type: 'string',
        },
        description: {
          description: 'Experiment description',
          type: 'string',
        },
        author: {
          description: 'Experiment author name',
          type: 'string',
        },
        extends: {
          description: 'Parent template ID to inherit from',
          type: 'string',
        },
      },
      required: ['id', 'version'],
    },
    shell_config: {
      description: 'Shell appearance and behavior configuration',
      type: 'object',
      properties: {
        theme: {
          description: 'Visual theme for the experiment shell',
          type: 'string',
          enum: THEMES,
          default: 'clinical_blue',
        },
        progress: {
          description: 'Progress indicator configuration',
          type: 'object',
          properties: {
            show_progress_bar: {
              description: 'Show progress bar at top',
              type: 'boolean',
              default: true,
            },
            show_counter: {
              description: 'Show "Step X of Y" counter',
              type: 'boolean',
              default: true,
            },
            show_percentage: {
              description: 'Show completion percentage',
              type: 'boolean',
              default: false,
            },
          },
        },
        sidebar: {
          description: 'Sidebar navigation configuration',
          type: 'object',
          properties: {
            enabled: {
              description: 'Show sidebar navigation',
              type: 'boolean',
              default: true,
            },
            allow_navigation: {
              description: 'Allow clicking on completed stages',
              type: 'boolean',
              default: true,
            },
          },
        },
        navigation_bar: {
          description: 'Navigation bar (with prev/next buttons) configuration',
          type: 'object',
          properties: {
            position: {
              description: 'Position of the navigation bar: top (default) or bottom',
              type: 'string',
              enum: NAVIGATION_BAR_POSITIONS,
              default: 'top',
            },
            show_header_placeholder: {
              description: 'When navigation is at bottom, show a header placeholder with title/description (default: true)',
              type: 'boolean',
              default: true,
            },
          },
        },
        logo_url: {
          description: 'URL to custom logo image',
          type: 'string',
        },
        custom_css: {
          description: 'Custom CSS to inject',
          type: 'string',
        },
      },
    },
    stages: {
      description: 'Array of experiment stages',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            description: 'Unique stage identifier (snake_case)',
            type: 'string',
          },
          type: {
            description: 'Stage type (determines rendering component)',
            type: 'string',
            enum: STAGE_TYPES,
          },
          label: {
            description: 'Display label shown in progress/sidebar',
            type: 'string',
          },
          title: {
            description: 'Main title shown in the top bar (falls back to label if not set)',
            type: 'string',
          },
          description: {
            description: 'Short instruction/description shown below the title in the top bar',
            type: 'string',
          },
          mandatory: {
            description: 'Whether stage must be completed',
            type: 'boolean',
            default: true,
          },
          visibility_rule: {
            description: 'JsonLogic rule for conditional display',
            type: 'string',
          },
          timing: {
            description: 'Timing constraints for the stage',
            type: 'object',
            properties: {
              min_duration_ms: {
                description: 'Minimum time before allowing progression (ms)',
                type: 'number',
              },
              max_duration_ms: {
                description: 'Maximum time allowed - timeout (ms). Only active on first visit, not when returning to completed stage.',
                type: 'number',
              },
              show_timer: {
                description: 'Show countdown timer (only active on first visit)',
                type: 'boolean',
                default: false,
              },
              show_elapsed_time: {
                description: 'Show elapsed time spent on this step (always visible)',
                type: 'boolean',
                default: false,
              },
              on_timeout: {
                description: 'Action when max_duration is reached',
                type: 'string',
                enum: TIMEOUT_ACTIONS,
                default: 'auto_submit',
              },
            },
          },
          quota: {
            description: 'Quota/capacity limit for this stage',
            type: 'object',
            properties: {
              limit: {
                description: 'Maximum number of completions allowed',
                type: 'number',
              },
              strategy: {
                description: 'What to do when quota is reached',
                type: 'string',
                enum: QUOTA_STRATEGIES,
                default: 'skip_if_full',
              },
              fallback_stage: {
                description: 'Stage ID to jump to if quota full',
                type: 'string',
              },
            },
          },
          layout: {
            description: 'Layout and positioning settings for the stage content',
            type: 'object',
            properties: {
              width: {
                description: 'Content width (e.g., "600px", "80%")',
                type: 'string',
              },
              max_width: {
                description: 'Maximum content width (e.g., "800px")',
                type: 'string',
              },
              min_width: {
                description: 'Minimum content width (e.g., "300px")',
                type: 'string',
              },
              align_horizontal: {
                description: 'Horizontal alignment of content',
                type: 'string',
                enum: HORIZONTAL_ALIGNMENTS,
                default: 'center',
              },
              align_vertical: {
                description: 'Vertical alignment of content',
                type: 'string',
                enum: VERTICAL_ALIGNMENTS,
                default: 'top',
              },
              margin_top: {
                description: 'Top margin (e.g., "20px", "2rem")',
                type: 'string',
              },
              padding: {
                description: 'Content padding (e.g., "20px", "1rem 2rem")',
                type: 'string',
              },
            },
          },
          // Type-specific properties
          questions: {
            description: 'Questions array (for questionnaire type)',
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: {
                  description: 'Unique question identifier',
                  type: 'string',
                },
                text: {
                  description: 'Question text to display',
                  type: 'string',
                },
                type: {
                  description: 'Input type for the question',
                  type: 'string',
                  enum: QUESTION_TYPES,
                },
                required: {
                  description: 'Whether answer is required',
                  type: 'boolean',
                  default: true,
                },
                options: {
                  description: 'Options for select/radio/checkbox types',
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      value: { type: 'string', description: 'Option value' },
                      label: { type: 'string', description: 'Display label' },
                    },
                  },
                },
                validation: {
                  description: 'Regex validation pattern',
                  type: 'string',
                },
                validation_message: {
                  description: 'Custom validation error message',
                  type: 'string',
                },
                range: {
                  description: 'Min/max range for likert_scale [min, max]',
                  type: 'array',
                },
                placeholder: {
                  description: 'Placeholder text for input',
                  type: 'string',
                },
              },
              required: ['id', 'text', 'type'],
            },
          },
          fields: {
            description: 'Fields array (for user_info type)',
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: {
                  description: 'Field identifier (used in data)',
                  type: 'string',
                },
                label: {
                  description: 'Display label',
                  type: 'string',
                },
                type: {
                  description: 'Input type',
                  type: 'string',
                  enum: FIELD_TYPES,
                },
                required: {
                  description: 'Whether field is required',
                  type: 'boolean',
                  default: true,
                },
                options: {
                  description: 'Options for select/radio types',
                  type: 'array',
                },
                min: {
                  description: 'Minimum value (for number)',
                  type: 'number',
                },
                max: {
                  description: 'Maximum value (for number)',
                  type: 'number',
                },
              },
              required: ['field', 'label', 'type'],
            },
          },
          content: {
            description: 'Content string (for content_display, consent_form)',
            type: 'string',
          },
          content_type: {
            description: 'Format of content',
            type: 'string',
            enum: CONTENT_TYPES,
            default: 'html',
          },
          source: {
            description: 'URL/path to media or iframe source',
            type: 'string',
          },
          config: {
            description: 'Type-specific configuration object',
            type: 'object',
            properties: {
              // Video config
              autoplay: { type: 'boolean', description: 'Auto-play video' },
              controls: { type: 'boolean', description: 'Show video controls' },
              allow_seek: { type: 'boolean', description: 'Allow seeking' },
              allow_pause: { type: 'boolean', description: 'Allow pausing' },
              // Iframe config
              height: { type: 'string', description: 'Iframe height (e.g., "600px", "100%")' },
              width: { type: 'string', description: 'Iframe width (e.g., "800px", "100%" for full available width)' },
              allow_fullscreen: { type: 'boolean', description: 'Allow fullscreen' },
              allow_clipboard: { type: 'boolean', description: 'Allow clipboard access' },
              timeout_ms: { type: 'number', description: 'Task timeout in milliseconds' },
              auto_complete: { type: 'boolean', description: 'Auto-advance on completion' },
              completion_trigger: { type: 'string', description: 'postMessage type for completion' },
            },
          },
          range: {
            description: 'Value range for likert_scale [min, max]',
            type: 'array',
          },
        },
        required: ['id', 'type'],
      },
    },
  },
  required: ['meta', 'stages'],
}

// Completion item snippets for common patterns
// Range is added dynamically at runtime based on cursor position
export const YAML_SNIPPETS: Omit<monaco.languages.CompletionItem, 'range'>[] = [
  {
    label: 'stage-questionnaire',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:stage_id}"
  type: "questionnaire"
  label: "\${2:Stage Label}"
  title: "\${3:Title}"
  description: "\${4:Please answer the following questions}"
  questions:
    - id: "\${5:q1}"
      text: "\${6:Question text?}"
      type: "\${7|text,textarea,number,select,radio,likert_scale|}"
      required: true`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a questionnaire stage with a question',
    detail: 'Questionnaire Stage',
  },
  {
    label: 'stage-user-info',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:demographics}"
  type: "user_info"
  label: "\${2:Demographics}"
  title: "\${3:About You}"
  description: "\${4:Please provide your information}"
  fields:
    - field: "\${5:age}"
      label: "\${6:Age}"
      type: "number"
      required: true
      min: 18
      max: 120`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a user info collection stage',
    detail: 'User Info Stage',
  },
  {
    label: 'stage-participant-identity',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:participant_identity}"
  type: "participant_identity"
  label: "\${2:Your Identity}"
  title: "\${3:Participant Identification}"
  description: "\${4:Please enter your details}"
  mandatory: true
  fields_description: "\${5:Please fill in the fields below. Fields marked with * are required.}"
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
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a participant identity stage that updates the participant label',
    detail: 'Participant Identity Stage',
  },
  {
    label: 'stage-consent',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:consent}"
  type: "consent_form"
  label: "\${2:Consent}"
  title: "\${3:Informed Consent}"
  description: "\${4:Please read and agree to participate}"
  content_type: "html"
  content: |
    <h2>Informed Consent</h2>
    <p>\${5:Please read and agree to participate.}</p>`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a consent form stage',
    detail: 'Consent Form Stage',
  },
  {
    label: 'stage-video',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:video_stage}"
  type: "video_player"
  label: "\${2:Watch Video}"
  title: "\${3:Video}"
  description: "\${4:Please watch the following video}"
  source: "\${5:/assets/video.mp4}"
  config:
    autoplay: false
    controls: true
    allow_seek: \${6|true,false|}
    allow_pause: true`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a video player stage',
    detail: 'Video Player Stage',
  },
  {
    label: 'stage-iframe',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:task}"
  type: "iframe_sandbox"
  label: "\${2:Interactive Task}"
  title: "\${3:Task}"
  description: "\${4:Please complete the following task}"
  source: "\${5:/tasks/task.html}"
  config:
    height: "\${6:600px}"
    width: "\${7:100%}"
    allow_fullscreen: true
    completion_trigger: "TASK_COMPLETE"`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert an iframe sandbox stage for external tasks',
    detail: 'Iframe Sandbox Stage',
  },
  {
    label: 'stage-content',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:instructions}"
  type: "content_display"
  label: "\${2:Instructions}"
  title: "\${3:Instructions}"
  description: "\${4:Please read the following}"
  content_type: "html"
  content: |
    <h2>\${5:Title}</h2>
    <p>\${6:Content goes here...}</p>`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a content display stage',
    detail: 'Content Display Stage',
  },
  {
    label: 'stage-likert',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:rating}"
  type: "likert_scale"
  label: "\${2:Rating}"
  title: "\${3:Rating}"
  description: "\${4:Please rate on the scale below}"
  range: [1, \${5:7}]`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a likert scale stage',
    detail: 'Likert Scale Stage',
  },
  {
    label: 'stage-external-task',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:external_task}"
  type: "external_task"
  label: "\${2:External Task}"
  title: "\${3:Complete External Task}"
  description: "\${4:Please complete the task in the external application}"
  mandatory: true
  target_url: "\${5:https://external-app.example.com/task}"
  config:
    completion_mode: "\${6|required,optional,manual|}"
    window_mode: "\${7|popup,fullscreen,tab|}"
    window_width: 1200
    window_height: 800`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert an external task stage (opens in new window)',
    detail: 'External Task Stage',
  },
  {
    label: 'stage-multiple-choice',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:quiz_q1}"
  type: "multiple_choice"
  label: "\${2:Question 1}"
  title: "\${3:Knowledge Check}"
  description: "\${4:Select the best answer}"
  mandatory: true
  
  question:
    type: "text"
    content: "\${5:What is the correct answer?}"
  
  answers:
    - id: "a"
      type: "text"
      content: "\${6:Answer A}"
    - id: "b"
      type: "text"
      content: "\${7:Answer B}"
    - id: "c"
      type: "text"
      content: "\${8:Answer C}"
    - id: "d"
      type: "text"
      content: "\${9:Answer D}"
  
  config:
    layout: "\${10|single_column,2x2,2x3,3x2,3x3,3x4,4x3,4x4,5x5,auto|}"
    correct_answer: "a"
    lock_after_submit: true
    show_correct_after_submit: true
    feedback_delay: \${11:1.5}  # seconds (0 = manual advance)
    show_answer_labels: true
    label_style: "letter"`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a multiple choice question stage with answers',
    detail: 'Multiple Choice Stage',
  },
  {
    label: 'question',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:q_id}"
  text: "\${2:Question text?}"
  type: "\${3|text,textarea,number,select,radio,checkbox,likert_scale|}"
  required: \${4|true,false|}`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a question',
    detail: 'Question',
  },
  {
    label: 'question-select',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- id: "\${1:q_select}"
  text: "\${2:Select an option:}"
  type: "select"
  required: true
  options:
    - value: "\${3:opt1}"
      label: "\${4:Option 1}"
    - value: "\${5:opt2}"
      label: "\${6:Option 2}"`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a select question with options',
    detail: 'Select Question',
  },
  {
    label: 'field',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `- field: "\${1:field_name}"
  label: "\${2:Field Label}"
  type: "\${3|text,number,select,radio,date,email|}"
  required: \${4|true,false|}`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a user info field',
    detail: 'User Info Field',
  },
  {
    label: 'timing',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `timing:
  min_duration_ms: \${1:5000}
  max_duration_ms: \${2:60000}
  show_timer: \${3|true,false|}
  show_elapsed_time: \${4|false,true|}
  on_timeout: "\${5|auto_submit,skip_stage,lock_interface,prompt|}"`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert timing configuration with countdown timer, elapsed time display, and timeout actions',
    detail: 'Timing Config',
  },
  {
    label: 'layout',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `layout:
  max_width: "\${1:600px}"
  align_horizontal: "\${2|center,left,right|}"
  align_vertical: "\${3|top,upper-third,middle,lower-third,bottom|}"
  margin_top: "\${4:2rem}"`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert layout configuration for content positioning',
    detail: 'Layout Config',
  },
  {
    label: 'quota',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `quota:
  limit: \${1:20}
  strategy: "\${2|skip_if_full,wait_for_slot,show_alternative|}"
  fallback_stage: "\${3:alternative_stage}"`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert quota configuration',
    detail: 'Quota Config',
  },
  {
    label: 'visibility-rule',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `visibility_rule: "\${1:stage_id}.\${2:field} == '\${3:value}'"`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert a visibility rule',
    detail: 'Visibility Rule',
  },
  {
    label: 'options',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: `options:
  - value: "\${1:value1}"
    label: "\${2:Label 1}"
  - value: "\${3:value2}"
    label: "\${4:Label 2}"`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Insert options array',
    detail: 'Options Array',
  },
]

/**
 * Register B-IRES YAML language features with Monaco
 */
export function registerBiresYamlSchema(monacoInstance: typeof monaco) {
  // Register completion provider
  // Note: Removed problematic trigger characters (':', '-', '\n') that were causing
  // cursor jumping issues. Users can still invoke autocomplete manually with Ctrl+Space.
  monacoInstance.languages.registerCompletionItemProvider('yaml', {
    triggerCharacters: [],
    provideCompletionItems: (model, position) => {
      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })

      const lineContent = model.getLineContent(position.lineNumber)
      const lineUntilPosition = lineContent.substring(0, position.column - 1)

      const suggestions: monaco.languages.CompletionItem[] = []
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }

      // Context detection
      const isInStages = /stages:\s*\n/m.test(textUntilPosition)
      const isInQuestions = /questions:\s*$/m.test(textUntilPosition) || /questions:\s*\n\s+-/m.test(textUntilPosition)
      const isInFields = /fields:\s*$/m.test(textUntilPosition) || /fields:\s*\n\s+-/m.test(textUntilPosition)
      const isAfterType = /type:\s*["']?$/.test(lineUntilPosition)
      const isAfterQuestionType = /type:\s*["']?$/.test(lineUntilPosition) && isInQuestions
      const isAfterTheme = /theme:\s*["']?$/.test(lineUntilPosition)
      const isAfterContentType = /content_type:\s*["']?$/.test(lineUntilPosition)
      const isAfterOnTimeout = /on_timeout:\s*["']?$/.test(lineUntilPosition)
      const isAfterStrategy = /strategy:\s*["']?$/.test(lineUntilPosition)
      const isNewLine = lineUntilPosition.trim() === '' || lineUntilPosition.trim() === '-'
      const indentLevel = lineUntilPosition.search(/\S|$/)

      // Type-specific completions
      if (isAfterType && !isInQuestions && !isInFields) {
        STAGE_TYPES.forEach((type) => {
          suggestions.push({
            label: type,
            kind: monacoInstance.languages.CompletionItemKind.EnumMember,
            insertText: `"${type}"`,
            range,
            detail: 'Stage type',
          })
        })
      }

      if (isAfterQuestionType) {
        QUESTION_TYPES.forEach((type) => {
          suggestions.push({
            label: type,
            kind: monacoInstance.languages.CompletionItemKind.EnumMember,
            insertText: `"${type}"`,
            range,
            detail: 'Question type',
          })
        })
      }

      if (isAfterTheme) {
        THEMES.forEach((theme) => {
          suggestions.push({
            label: theme,
            kind: monacoInstance.languages.CompletionItemKind.EnumMember,
            insertText: `"${theme}"`,
            range,
            detail: 'Theme',
          })
        })
      }

      if (isAfterContentType) {
        CONTENT_TYPES.forEach((ct) => {
          suggestions.push({
            label: ct,
            kind: monacoInstance.languages.CompletionItemKind.EnumMember,
            insertText: `"${ct}"`,
            range,
            detail: 'Content type',
          })
        })
      }

      if (isAfterOnTimeout) {
        TIMEOUT_ACTIONS.forEach((action) => {
          suggestions.push({
            label: action,
            kind: monacoInstance.languages.CompletionItemKind.EnumMember,
            insertText: `"${action}"`,
            range,
            detail: 'Timeout action',
          })
        })
      }

      if (isAfterStrategy) {
        QUOTA_STRATEGIES.forEach((strategy) => {
          suggestions.push({
            label: strategy,
            kind: monacoInstance.languages.CompletionItemKind.EnumMember,
            insertText: `"${strategy}"`,
            range,
            detail: 'Quota strategy',
          })
        })
      }

      // Property completions based on context
      if (isNewLine || lineUntilPosition.endsWith(' ')) {
        // Root level
        if (indentLevel === 0 && !isInStages) {
          ;['meta:', 'shell_config:', 'stages:'].forEach((prop) => {
            suggestions.push({
              label: prop,
              kind: monacoInstance.languages.CompletionItemKind.Property,
              insertText: prop,
              range,
              detail: 'Root property',
            })
          })
        }

        // Stage properties
        if (isInStages && !isInQuestions && !isInFields) {
          ;[
            'id:',
            'type:',
            'label:',
            'title:',
            'description:',
            'mandatory:',
            'visibility_rule:',
            'timing:',
            'quota:',
            'layout:',
            'questions:',
            'fields:',
            'content:',
            'content_type:',
            'source:',
            'config:',
            'range:',
          ].forEach((prop) => {
            suggestions.push({
              label: prop,
              kind: monacoInstance.languages.CompletionItemKind.Property,
              insertText: prop + ' ',
              range,
              detail: 'Stage property',
            })
          })
        }

        // Question properties
        if (isInQuestions) {
          ;['id:', 'text:', 'type:', 'required:', 'options:', 'validation:', 'validation_message:', 'range:', 'placeholder:'].forEach(
            (prop) => {
              suggestions.push({
                label: prop,
                kind: monacoInstance.languages.CompletionItemKind.Property,
                insertText: prop + ' ',
                range,
                detail: 'Question property',
              })
            }
          )
        }

        // Field properties
        if (isInFields) {
          ;['field:', 'label:', 'type:', 'required:', 'options:', 'min:', 'max:'].forEach((prop) => {
            suggestions.push({
              label: prop,
              kind: monacoInstance.languages.CompletionItemKind.Property,
              insertText: prop + ' ',
              range,
              detail: 'Field property',
            })
          })
        }
      }

      // Add snippets
      YAML_SNIPPETS.forEach((snippet) => {
        suggestions.push({
          ...snippet,
          range,
        })
      })

      return { suggestions }
    },
  })

  // Register hover provider for documentation
  monacoInstance.languages.registerHoverProvider('yaml', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position)
      if (!word) return null

      const key = word.word.replace(':', '')

      const docs: Record<string, string> = {
        meta: 'Experiment metadata including ID, version, and name.',
        stages: 'Array of experiment stages that define the flow.',
        shell_config: 'Configuration for the experiment shell appearance.',
        id: 'Unique identifier for this element (use snake_case).',
        type: 'The type of stage or input field.',
        label: 'Human-readable label displayed in sidebar/progress.',
        title: 'Main title displayed in the top bar (falls back to label if not set).',
        description: 'Short instruction or description shown below the title in the top bar.',
        mandatory: 'Whether this stage must be completed to finish.',
        visibility_rule: 'JsonLogic expression for conditional visibility.',
        timing: 'Timing constraints (min/max duration, timeout behavior).',
        quota: 'Capacity limits for this stage.',
        questions: 'Array of questions for questionnaire stages.',
        fields: 'Array of fields for user_info stages.',
        content: 'HTML/Markdown content to display.',
        content_type: 'Format of the content (html, markdown, plain).',
        source: 'URL or path to media/iframe source.',
        config: 'Type-specific configuration options.',
        width: 'Width of iframe (e.g., "800px", "100%" for full available width).',
        height: 'Height of iframe (e.g., "600px", "100%" for full viewport height).',
        range: 'Value range for likert scales [min, max].',
        required: 'Whether this input is required.',
        options: 'Array of options for select/radio/checkbox inputs.',
        theme: 'Visual theme for the experiment shell.',
        min_duration_ms: 'Minimum time (ms) before allowing progression.',
        max_duration_ms: 'Maximum time (ms) before timeout action.',
        on_timeout: 'Action to take when max_duration is reached.',
        limit: 'Maximum number of completions allowed.',
        strategy: 'How to handle when quota is reached.',
        fallback_stage: 'Stage to redirect to when quota is full.',
        // External task properties
        target_url: 'URL of the external application (task_token appended automatically).',
        completion_mode: 'How completion is determined: required | optional | manual.',
        window_mode: 'How to open external window: popup | fullscreen | tab.',
        window_width: 'Popup window width in pixels (for popup mode).',
        window_height: 'Popup window height in pixels (for popup mode).',
        timeout_ms: 'Maximum time before timeout (ms), 0 = no timeout.',
        timeout_action: 'Action on timeout: prompt | skip | retry | fail.',
        allow_retry_on_timeout: 'Show "Try Again" button when timeout occurs.',
        max_retries: 'Maximum retry attempts (0 = unlimited).',
        try_close_on_complete: 'Attempt to close external window when task completes.',
        enable_reverse_control: 'Enable sending commands to external app via WebSocket.',
        reverse_commands: 'List of commands external app should handle (restart, close, pause, resume).',
        // Multiple choice properties
        question: 'Question configuration object with type and content.',
        answers: 'Array of answer options for multiple choice questions.',
        correct_answer: 'ID of correct answer (string) or array of IDs for multiple correct.',
        layout: 'Answer layout: single_column | 2x2 | 2x3 | 3x2 | 3x3 | 3x4 | 4x3 | 4x4 | 5x5 | auto.',
        allow_multiple_selection: 'Allow selecting multiple answers.',
        lock_after_submit: 'Prevent changing the answer after submission (default: true).',
        show_correct_after_submit: 'Highlight correct answer after submission.',
        feedback_delay: 'Seconds to show feedback before auto-advancing (1-30). Set to 0 for manual advance (user clicks Next).',
        show_explanation_after_submit: 'Show main explanation text after submission.',
        show_answer_explanations: 'Show per-answer explanations after submission.',
        explanation_before_submit: 'HTML explanation shown before participant submits.',
        explanation_after_submit: 'HTML explanation shown after participant submits.',
        explanation: 'Per-answer explanation text shown after submission.',
        show_answer_labels: 'Show A, B, C, D labels on answers.',
        label_style: 'Label format: letter (A,B,C) | number (1,2,3) | none.',
        badges: 'Array of badge/tag objects with text and color for answer options.',
        subtext: 'Secondary text shown below main content.',
        track_score: 'Track correct/incorrect answers for scoring.',
        show_score_to_participant: 'Display running score to participant.',
        score_format: 'Score display format template (e.g., "Correct: {{correct}} of {{total}}").',
        free_text: 'Allow participant to enter custom text answer.',
        placeholder: 'Placeholder text for free text input.',
        randomize_order: 'Randomize the order of answer options.',
          // Participant identity properties
          enabled: 'Whether the field is shown/enabled (default: true).',
          include_in_label: 'Include this field value in the participant label (concatenated with underscore).',
          fields_description: 'Short description text displayed above the identity fields.',
        // Layout properties (note: 'layout' key is also used for MC answer layout above)
        align_horizontal: 'Horizontal alignment: left | center | right.',
        align_vertical: 'Vertical alignment: top | upper-third | middle | lower-third | bottom.',
        margin_top: 'Top margin for content (e.g., "20px", "2rem").',
        max_width: 'Maximum width of content area (e.g., "600px", "80%").',
        min_width: 'Minimum width of content area (e.g., "300px").',
        // Navigation bar properties
        navigation_bar: 'Configuration for the navigation bar with prev/next buttons.',
        position: 'Position of the navigation bar: top (default) or bottom.',
        show_header_placeholder: 'When navigation is at bottom, show a header placeholder with title/description.',
      }

      if (docs[key]) {
        return {
          contents: [{ value: `**${key}**\n\n${docs[key]}` }],
        }
      }

      return null
    },
  })
}

