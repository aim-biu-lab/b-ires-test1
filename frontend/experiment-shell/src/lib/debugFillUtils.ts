/**
 * Utility functions for debug mode - generating random/default values for stage fields
 */

import { StageConfig, QuestionConfig, FieldConfig } from '../store/sessionStore'

// Random data generators
const RANDOM_NAMES = ['John', 'Jane', 'Alex', 'Sam', 'Chris', 'Pat', 'Morgan', 'Taylor']
const RANDOM_EMAILS = ['test@example.com', 'user@test.org', 'debug@demo.com']
const RANDOM_TEXTS = [
  'Debug test response',
  'Sample answer for testing',
  'This is a test value',
  'Lorem ipsum dolor sit amet',
]

/**
 * Generate a random integer between min and max (inclusive)
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Pick a random element from an array
 */
function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Generate a value for a questionnaire question based on its type
 */
function generateQuestionValue(question: QuestionConfig): unknown {
  const type = question.type

  switch (type) {
    case 'text':
    case 'textarea':
      return randomPick(RANDOM_TEXTS)

    case 'number': {
      const min = typeof question.min === 'number' ? question.min : 1
      const max = typeof question.max === 'number' ? question.max : 100
      return randomInt(min, max)
    }

    case 'email':
      return randomPick(RANDOM_EMAILS)

    case 'radio':
    case 'select':
      if (question.options && question.options.length > 0) {
        return question.options[0].value
      }
      return null

    case 'checkbox':
      // Select first option for checkbox
      if (question.options && question.options.length > 0) {
        return [question.options[0].value]
      }
      return []

    case 'likert_scale': {
      const range = question.range || [1, 5]
      // Pick the middle value
      return Math.ceil((range[0] + range[1]) / 2)
    }

    default:
      return randomPick(RANDOM_TEXTS)
  }
}

/**
 * Generate a value for a user_info or participant_identity field based on its type
 */
function generateFieldValue(field: FieldConfig): unknown {
  const type = field.type
  const fieldName = field.field.toLowerCase()

  // Special handling based on field name
  if (fieldName.includes('name') || fieldName.includes('first_name')) {
    return randomPick(RANDOM_NAMES)
  }
  if (fieldName.includes('last_name') || fieldName.includes('surname')) {
    return randomPick(['Smith', 'Johnson', 'Williams', 'Brown', 'Jones'])
  }
  if (fieldName.includes('email')) {
    return randomPick(RANDOM_EMAILS)
  }
  if (fieldName.includes('age')) {
    const min = field.min ?? 18
    const max = field.max ?? 65
    return randomInt(min, max)
  }

  switch (type) {
    case 'text':
      return randomPick(RANDOM_TEXTS)

    case 'textarea':
      return randomPick(RANDOM_TEXTS)

    case 'number': {
      const min = field.min ?? 1
      const max = field.max ?? 100
      return randomInt(min, max)
    }

    case 'email':
      return randomPick(RANDOM_EMAILS)

    case 'select':
    case 'radio':
      if (field.options && field.options.length > 0) {
        return field.options[0].value
      }
      return null

    case 'checkbox':
      // Select first option for checkbox
      if (field.options && field.options.length > 0) {
        return [field.options[0].value]
      }
      return []

    case 'consent_checkbox':
      return true

    default:
      return randomPick(RANDOM_TEXTS)
  }
}

/**
 * Generate debug fill data for a stage based on its type
 */
export function generateDebugFillData(stage: StageConfig): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  switch (stage.type) {
    case 'questionnaire':
      // Fill all questions
      if (stage.questions) {
        for (const question of stage.questions) {
          data[question.id] = generateQuestionValue(question)
        }
      }
      break

    case 'user_info':
      // Fill all fields
      if (stage.fields) {
        for (const field of stage.fields) {
          data[field.field] = generateFieldValue(field)
        }
      }
      break

    case 'participant_identity':
      // Fill all enabled fields
      if (stage.fields) {
        for (const field of stage.fields) {
          if (field.enabled !== false) {
            data[field.field] = generateFieldValue(field)
          }
        }
      }
      break

    case 'consent_form':
      // Accept consent
      data.consent = true
      break

    case 'likert_scale': {
      // Select middle value or first option
      if (stage.likert_options && Array.isArray(stage.likert_options)) {
        const options = stage.likert_options as Array<{ label: string; score: number }>
        // Pick middle option
        const middleIndex = Math.floor(options.length / 2)
        data.response = options[middleIndex]?.score ?? options[0]?.score
      } else if (stage.range && Array.isArray(stage.range)) {
        const range = stage.range as [number, number]
        // Pick middle value
        data.response = Math.ceil((range[0] + range[1]) / 2)
      } else {
        // Default to 3 (middle of 1-5)
        data.response = 3
      }
      break
    }

    case 'multiple_choice': {
      // Select first answer
      const answers = stage.answers as Array<{ id: string }> | undefined
      if (answers && answers.length > 0) {
        const config = stage.config as { allow_multiple_selection?: boolean } | undefined
        if (config?.allow_multiple_selection) {
          data.selected_answers = [answers[0].id]
        } else {
          data.selected_answers = [answers[0].id]
        }
      }
      break
    }

    case 'attention_check': {
      // Try to find and select the correct answer, otherwise select first
      const options = stage.options as Array<{ value: string; isCorrect?: boolean }> | undefined
      const correctAnswer = stage.correct_answer as string | undefined
      
      if (correctAnswer) {
        data.selected_answer = correctAnswer
      } else if (options) {
        const correctOption = options.find(o => o.isCorrect)
        data.selected_answer = correctOption?.value ?? options[0]?.value
      }
      break
    }

    case 'video_player':
      // Mark video as completed
      data._video_completed = true
      break

    case 'iframe_sandbox':
      // Mark iframe task as completed
      data._iframe_completed = true
      break

    case 'content_display':
      // No data needed for content display
      break

    case 'external_task':
      // External tasks usually require completion callback
      // For debug, we just mark it as if the callback was received
      data._external_completed = true
      break

    default:
      // Unknown stage type - no data to fill
      break
  }

  return data
}
