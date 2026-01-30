/**
 * Variable Context Utility
 * 
 * Extracts available variables from experiment configuration
 * for use in visibility rules and conditional logic.
 */

export interface VariableInfo {
  path: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'array'
  source: 'stage' | 'participant' | 'environment' | 'assignment'
}

export interface ExperimentContext {
  stages: StageInfo[]
  phases?: PhaseInfo[]
}

interface StageInfo {
  id: string
  type?: string
  label?: string
  questions?: QuestionInfo[]
  fields?: FieldInfo[]
}

interface PhaseInfo {
  id: string
  label?: string
  stages?: StageInfo[]
}

interface QuestionInfo {
  id: string
  text?: string
  type?: string
  options?: { value: string; label: string }[]
}

interface FieldInfo {
  field: string
  label?: string
  type?: string
}

// Environment variables always available
const ENVIRONMENT_VARIABLES: VariableInfo[] = [
  { path: 'environment.device', label: 'Device Type', type: 'string', source: 'environment' },
  { path: 'environment.browser', label: 'Browser', type: 'string', source: 'environment' },
  { path: 'environment.platform', label: 'Platform (OS)', type: 'string', source: 'environment' },
  { path: 'environment.screen_width', label: 'Screen Width', type: 'number', source: 'environment' },
  { path: 'environment.screen_height', label: 'Screen Height', type: 'number', source: 'environment' },
  { path: 'environment.is_mobile', label: 'Is Mobile Device', type: 'boolean', source: 'environment' },
  { path: 'environment.language', label: 'Browser Language', type: 'string', source: 'environment' },
]

// Participant variables
const PARTICIPANT_VARIABLES: VariableInfo[] = [
  { path: 'participant.session_id', label: 'Session ID', type: 'string', source: 'participant' },
  { path: 'participant.started_at', label: 'Session Start Time', type: 'string', source: 'participant' },
]

/**
 * Extract variables from a questionnaire stage
 */
function extractQuestionnaireVariables(stage: StageInfo): VariableInfo[] {
  const variables: VariableInfo[] = []
  
  if (stage.questions) {
    for (const question of stage.questions) {
      const varType = getVariableTypeFromQuestionType(question.type)
      variables.push({
        path: `${stage.id}.${question.id}`,
        label: `${stage.label || stage.id}: ${question.text || question.id}`,
        type: varType,
        source: 'stage',
      })
    }
  }
  
  return variables
}

/**
 * Extract variables from a user_info stage
 */
function extractUserInfoVariables(stage: StageInfo): VariableInfo[] {
  const variables: VariableInfo[] = []
  
  if (stage.fields) {
    for (const field of stage.fields) {
      const varType = getVariableTypeFromFieldType(field.type)
      variables.push({
        path: `${stage.id}.${field.field}`,
        label: `${stage.label || stage.id}: ${field.label || field.field}`,
        type: varType,
        source: 'stage',
      })
    }
  }
  
  return variables
}

/**
 * Extract variables from a multiple_choice stage
 */
function extractMultipleChoiceVariables(stage: StageInfo): VariableInfo[] {
  return [{
    path: `${stage.id}.selected`,
    label: `${stage.label || stage.id}: Selected Answer`,
    type: 'string',
    source: 'stage',
  }, {
    path: `${stage.id}.is_correct`,
    label: `${stage.label || stage.id}: Is Correct`,
    type: 'boolean',
    source: 'stage',
  }]
}

/**
 * Extract variables from a consent_form stage
 */
function extractConsentFormVariables(stage: StageInfo): VariableInfo[] {
  return [{
    path: `${stage.id}.agreed`,
    label: `${stage.label || stage.id}: Agreed`,
    type: 'boolean',
    source: 'stage',
  }]
}

/**
 * Extract variables from a likert_scale stage
 */
function extractLikertScaleVariables(stage: StageInfo): VariableInfo[] {
  return [{
    path: `${stage.id}.value`,
    label: `${stage.label || stage.id}: Rating Value`,
    type: 'number',
    source: 'stage',
  }]
}

/**
 * Extract all variables from a single stage
 */
function extractStageVariables(stage: StageInfo): VariableInfo[] {
  switch (stage.type) {
    case 'questionnaire':
      return extractQuestionnaireVariables(stage)
    case 'user_info':
    case 'participant_identity':
      return extractUserInfoVariables(stage)
    case 'multiple_choice':
      return extractMultipleChoiceVariables(stage)
    case 'consent_form':
      return extractConsentFormVariables(stage)
    case 'likert_scale':
      return extractLikertScaleVariables(stage)
    case 'video_player':
      return [{
        path: `${stage.id}.watched`,
        label: `${stage.label || stage.id}: Watched`,
        type: 'boolean',
        source: 'stage',
      }, {
        path: `${stage.id}.watch_percentage`,
        label: `${stage.label || stage.id}: Watch Percentage`,
        type: 'number',
        source: 'stage',
      }]
    case 'iframe_sandbox':
    case 'external_task':
      return [{
        path: `${stage.id}.completed`,
        label: `${stage.label || stage.id}: Completed`,
        type: 'boolean',
        source: 'stage',
      }, {
        path: `${stage.id}.data`,
        label: `${stage.label || stage.id}: Response Data`,
        type: 'string',
        source: 'stage',
      }]
    default:
      return [{
        path: `${stage.id}.completed`,
        label: `${stage.label || stage.id}: Completed`,
        type: 'boolean',
        source: 'stage',
      }]
  }
}

/**
 * Get TypeScript type from question type
 */
function getVariableTypeFromQuestionType(questionType?: string): 'string' | 'number' | 'boolean' | 'array' {
  switch (questionType) {
    case 'number':
    case 'slider':
    case 'likert_scale':
      return 'number'
    case 'checkbox':
      return 'array'
    default:
      return 'string'
  }
}

/**
 * Get TypeScript type from field type
 */
function getVariableTypeFromFieldType(fieldType?: string): 'string' | 'number' | 'boolean' | 'array' {
  switch (fieldType) {
    case 'number':
      return 'number'
    case 'checkbox':
      return 'boolean'
    default:
      return 'string'
  }
}

/**
 * Extract all available variables from experiment context
 */
export function extractAvailableVariables(
  context: ExperimentContext,
  currentPath: string[] = []
): VariableInfo[] {
  const variables: VariableInfo[] = []
  
  // Always include environment variables
  variables.push(...ENVIRONMENT_VARIABLES)
  
  // Always include participant variables
  variables.push(...PARTICIPANT_VARIABLES)
  
  // Collect all stages (from flat structure or hierarchy)
  const allStages: StageInfo[] = []
  
  if (context.stages) {
    allStages.push(...context.stages)
  }
  
  if (context.phases) {
    for (const phase of context.phases) {
      if (phase.stages) {
        allStages.push(...phase.stages)
      }
    }
  }
  
  // Extract variables from stages that come BEFORE the current item
  // (can only reference previously collected data)
  const currentId = currentPath[currentPath.length - 1]
  
  for (const stage of allStages) {
    // Skip the current stage and stages after it
    if (stage.id === currentId) break
    
    // Add assignment variable for this stage if it has children (balanced/weighted)
    variables.push({
      path: `assignments.${stage.id}`,
      label: `Assignment: ${stage.label || stage.id}`,
      type: 'string',
      source: 'assignment',
    })
    
    // Extract stage-specific variables
    variables.push(...extractStageVariables(stage))
  }
  
  return variables
}

/**
 * Extract variables available before a specific item in the hierarchy
 */
export function extractVariablesBeforeItem(
  phases: Array<{ id: string; label?: string; stages?: StageInfo[] }>,
  targetPath: string[]
): VariableInfo[] {
  const variables: VariableInfo[] = []
  
  // Always include environment and participant variables
  variables.push(...ENVIRONMENT_VARIABLES)
  variables.push(...PARTICIPANT_VARIABLES)
  
  if (targetPath.length === 0 || !phases) {
    return variables
  }
  
  const targetPhaseId = targetPath[0]
  const targetStageId = targetPath[1]
  // const targetBlockId = targetPath[2] // Reserved for future block-level variable extraction
  
  for (const phase of phases) {
    // Add assignment for this phase
    variables.push({
      path: `assignments.${phase.id}`,
      label: `Assignment: ${phase.label || phase.id}`,
      type: 'string',
      source: 'assignment',
    })
    
    // Stop if we've reached the target phase and no deeper target
    if (phase.id === targetPhaseId && targetPath.length === 1) {
      break
    }
    
    // Process stages in this phase
    if (phase.stages) {
      for (const stage of phase.stages) {
        // Stop if we've reached the target
        if (phase.id === targetPhaseId && stage.id === targetStageId) {
          break
        }
        
        // Add assignment for this stage
        variables.push({
          path: `assignments.${stage.id}`,
          label: `Assignment: ${stage.label || stage.id}`,
          type: 'string',
          source: 'assignment',
        })
        
        // Extract stage variables
        variables.push(...extractStageVariables(stage))
      }
    }
    
    // Stop after processing target phase
    if (phase.id === targetPhaseId) {
      break
    }
  }
  
  return variables
}

export default {
  extractAvailableVariables,
  extractVariablesBeforeItem,
  ENVIRONMENT_VARIABLES,
  PARTICIPANT_VARIABLES,
}

