/**
 * Stage GUI Editor
 * Main entry point for the visual stage editor
 * Routes to appropriate editor based on stage type
 */

import { useMemo } from 'react'
import { STAGE_TYPES } from '../../lib/yaml-schema'
import { GenericStageEditor } from './stage-editors'
import { DuplicationSource } from '../../lib/duplication-utils'
import { DuplicationProvider } from '../../lib/duplication-context'

interface StageGuiEditorProps {
  stageData: Record<string, unknown>
  onChange: (path: string, value: unknown) => void
  onBlur?: (path: string, value: unknown) => void
  onBatchChange?: (updates: Record<string, unknown>) => void
  disabled?: boolean
  experimentId?: string
  /** Duplication source for visual indication of unchanged values */
  duplicationSource?: DuplicationSource | null
  /** Callback to clear duplication source */
  onClearDuplicationSource?: () => void
}

export function StageGuiEditor({
  stageData,
  onChange,
  onBlur,
  onBatchChange,
  disabled,
  experimentId,
  duplicationSource,
  onClearDuplicationSource,
}: StageGuiEditorProps) {
  const stageType = (stageData?.type as string) || ''
  const isValidType = STAGE_TYPES.includes(stageType as typeof STAGE_TYPES[number])

  // Get stage label/title for display
  const stageTitle = useMemo(() => {
    const label = stageData?.label as string
    const id = stageData?.id as string
    return label || id || 'Stage'
  }, [stageData])

  if (!stageType) {
    return (
      <div className="p-6 text-center text-gray-500">
        <NoStageIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
        <p className="text-sm">Select a stage type to configure</p>
      </div>
    )
  }

  if (!isValidType) {
    return (
      <div className="p-6 text-center">
        <WarningIcon className="w-12 h-12 mx-auto mb-3 text-yellow-400" />
        <p className="text-sm text-gray-700 font-medium">Unknown stage type: {stageType}</p>
        <p className="text-xs text-gray-500 mt-1">
          This stage type is not recognized. You can still edit it in the YAML editor.
        </p>
      </div>
    )
  }

  return (
    <DuplicationProvider 
      source={duplicationSource} 
      onClearSource={onClearDuplicationSource}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <StageTypeIcon type={stageType} />
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{stageTitle}</h3>
              <p className="text-xs text-gray-500">{formatStageType(stageType)}</p>
            </div>
          </div>
          {duplicationSource && (
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded flex items-center gap-1">
                <CopyIndicatorIcon className="w-3 h-3" />
                Duplicated from {duplicationSource.sourceId}
              </span>
              <button
                onClick={onClearDuplicationSource}
                className="text-gray-400 hover:text-gray-600"
                title="Dismiss duplication tracking"
              >
                <DismissIcon className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Editor Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <GenericStageEditor
            stageType={stageType}
            stageData={stageData}
            onChange={onChange}
            onBlur={onBlur}
            onBatchChange={onBatchChange}
            disabled={disabled}
            experimentId={experimentId}
          />
        </div>
      </div>
    </DuplicationProvider>
  )
}

// Format stage type for display
function formatStageType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Stage type icon
function StageTypeIcon({ type }: { type: string }) {
  const iconClass = 'w-6 h-6'
  const bgClass = 'w-8 h-8 rounded-lg flex items-center justify-center'

  switch (type) {
    case 'questionnaire':
      return (
        <div className={`${bgClass} bg-blue-100`}>
          <QuestionnaireIcon className={`${iconClass} text-blue-600`} />
        </div>
      )
    case 'user_info':
      return (
        <div className={`${bgClass} bg-purple-100`}>
          <UserIcon className={`${iconClass} text-purple-600`} />
        </div>
      )
    case 'consent_form':
      return (
        <div className={`${bgClass} bg-green-100`}>
          <DocumentIcon className={`${iconClass} text-green-600`} />
        </div>
      )
    case 'content_display':
      return (
        <div className={`${bgClass} bg-gray-100`}>
          <ContentIcon className={`${iconClass} text-gray-600`} />
        </div>
      )
    case 'video_player':
      return (
        <div className={`${bgClass} bg-red-100`}>
          <VideoIcon className={`${iconClass} text-red-600`} />
        </div>
      )
    case 'multiple_choice':
      return (
        <div className={`${bgClass} bg-indigo-100`}>
          <MultipleChoiceIcon className={`${iconClass} text-indigo-600`} />
        </div>
      )
    case 'iframe_sandbox':
      return (
        <div className={`${bgClass} bg-cyan-100`}>
          <IframeIcon className={`${iconClass} text-cyan-600`} />
        </div>
      )
    case 'external_task':
      return (
        <div className={`${bgClass} bg-orange-100`}>
          <ExternalIcon className={`${iconClass} text-orange-600`} />
        </div>
      )
    case 'likert_scale':
      return (
        <div className={`${bgClass} bg-yellow-100`}>
          <LikertIcon className={`${iconClass} text-yellow-600`} />
        </div>
      )
    case 'attention_check':
      return (
        <div className={`${bgClass} bg-pink-100`}>
          <AttentionIcon className={`${iconClass} text-pink-600`} />
        </div>
      )
    default:
      return (
        <div className={`${bgClass} bg-gray-100`}>
          <DefaultIcon className={`${iconClass} text-gray-600`} />
        </div>
      )
  }
}

// Icons
function NoStageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
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
        strokeWidth={1.5}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  )
}

function QuestionnaireIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  )
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  )
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  )
}

function ContentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h7"
      />
    </svg>
  )
}

function VideoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  )
}

function MultipleChoiceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 10h16M4 14h16M4 18h16"
      />
      <circle cx="4" cy="6" r="1" fill="currentColor" />
      <circle cx="4" cy="10" r="1" fill="currentColor" />
      <circle cx="4" cy="14" r="1" fill="currentColor" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
    </svg>
  )
}

function IframeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
      />
    </svg>
  )
}

function ExternalIcon({ className }: { className?: string }) {
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

function LikertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
      />
    </svg>
  )
}

function AttentionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  )
}

function DefaultIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
      />
    </svg>
  )
}

function CopyIndicatorIcon({ className }: { className?: string }) {
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

function DismissIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  )
}

