import { StageConfig } from '../store/sessionStore'
import { TopBarStatus } from './TopBar'
import QuestionnaireBlock from './blocks/QuestionnaireBlock'
import UserInfoBlock from './blocks/UserInfoBlock'
import ContentDisplayBlock from './blocks/ContentDisplayBlock'
import VideoPlayerBlock from './blocks/VideoPlayerBlock'
import LikertScaleBlock from './blocks/LikertScaleBlock'
import IframeSandboxBlock from './blocks/IframeSandboxBlock'
import AttentionCheckBlock from './blocks/AttentionCheckBlock'
import ExternalTaskBlock from './blocks/ExternalTaskBlock'
import MultipleChoiceBlock from './blocks/MultipleChoiceBlock'

interface StageRendererProps {
  stage: StageConfig
  data: Record<string, unknown>
  errors: Record<string, string>
  onFieldChange: (fieldId: string, value: unknown) => void
  onAutoComplete?: () => void
  onStatusChange?: (status: TopBarStatus | null) => void
  readOnly?: boolean
}

export default function StageRenderer({
  stage,
  data,
  errors,
  onFieldChange,
  onAutoComplete,
  onStatusChange,
  readOnly = false,
}: StageRendererProps) {
  switch (stage.type) {
    case 'questionnaire':
      return (
        <QuestionnaireBlock
          questions={stage.questions || []}
          data={data}
          errors={errors}
          onFieldChange={onFieldChange}
          readOnly={readOnly}
        />
      )

    case 'user_info':
      return (
        <UserInfoBlock
          fields={stage.fields || []}
          data={data}
          errors={errors}
          onFieldChange={onFieldChange}
          readOnly={readOnly}
        />
      )

    case 'participant_identity': {
      // Filter out disabled fields for participant identity stage
      const enabledFields = (stage.fields || []).filter(
        (field) => field.enabled !== false
      )
      const fieldsDescription = stage.fields_description as string | undefined
      return (
        <div className="space-y-4">
          {/* Description text above the fields */}
          {fieldsDescription && (
            <p className="text-text-secondary text-sm">
              {fieldsDescription}
            </p>
          )}
          <UserInfoBlock
            fields={enabledFields}
            data={data}
            errors={errors}
            onFieldChange={onFieldChange}
            readOnly={readOnly}
            requireExplicitRequired={true}
          />
        </div>
      )
    }

    case 'content_display':
      return (
        <ContentDisplayBlock
          content={stage.content}
          contentType={stage.content_type}
          config={stage.config}
        />
      )

    case 'video_player':
      return (
        <VideoPlayerBlock
          source={stage.source || ''}
          config={stage.config}
          stageId={stage.id}
          onStatusChange={onStatusChange}
          onFieldChange={onFieldChange}
          errors={errors}
        />
      )

    case 'likert_scale':
      // Parse range (for backward compatibility)
      const likertRange = stage.range
      const validRange: [number, number] | undefined = 
        Array.isArray(likertRange) && likertRange.length === 2 && typeof likertRange[0] === 'number' && typeof likertRange[1] === 'number'
          ? [likertRange[0], likertRange[1]]
          : undefined
      
      // Parse question text
      const likertQuestionText = stage.question_text as string | undefined
      
      // Parse new likert options
      const likertOptions = stage.likert_options as Array<{ label: string; score: number }> | undefined
      const showFacesLikert = stage.show_faces !== false // default true
      const showScoreLikert = stage.show_score === true // default false
      const likertStyleConfig = stage.likert_style_config as {
        option_gap?: number
        margin_top?: number
        margin_bottom?: number
        option_padding?: number
      } | undefined
      
      // Convert snake_case to camelCase for style config
      const styleConfigCamel = likertStyleConfig ? {
        optionGap: likertStyleConfig.option_gap,
        marginTop: likertStyleConfig.margin_top,
        marginBottom: likertStyleConfig.margin_bottom,
        optionPadding: likertStyleConfig.option_padding,
      } : undefined
      
      // Check if stage is mandatory
      const likertMandatory = stage.mandatory !== false
      
      return (
        <div className="space-y-4">
          {likertQuestionText && (
            <p className="text-lg font-medium text-text-primary">
              {likertQuestionText}
              {likertMandatory && <span className="text-error ml-1">*</span>}
            </p>
          )}
          <LikertScaleBlock
            range={validRange}
            options={likertOptions}
            value={data.response as number}
            onChange={(value) => onFieldChange('response', value)}
            error={errors.response}
            showFaces={showFacesLikert}
            showScore={showScoreLikert}
            styleConfig={styleConfigCamel}
            readOnly={readOnly}
          />
        </div>
      )

    case 'consent_form':
      return (
        <div className="space-y-4">
          <ContentDisplayBlock
            content={stage.content}
            contentType={stage.content_type}
            config={stage.config}
          />
          <label className={`flex items-start gap-3 ${readOnly ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={!!data.consent}
              onChange={(e) => !readOnly && onFieldChange('consent', e.target.checked)}
              disabled={readOnly}
              className="mt-1 w-5 h-5 rounded border-border text-primary focus:ring-primary disabled:opacity-50"
            />
            <span className="text-sm">
              I have read and understood the information above and agree to participate in this study.
            </span>
          </label>
          {errors.consent && (
            <p className="text-sm text-error">{errors.consent}</p>
          )}
        </div>
      )

    case 'iframe_sandbox':
      return (
        <IframeSandboxBlock
          source={stage.source || ''}
          config={stage.config}
          stageId={stage.id}
          data={data}
          errors={errors}
          onFieldChange={onFieldChange}
          onComplete={onAutoComplete}
          onStatusChange={onStatusChange}
        />
      )

    case 'attention_check': {
      const attentionOptions: Array<{ value: string; label: string; isCorrect?: boolean }> = 
        Array.isArray(stage.options) 
          ? (stage.options as Array<{ value: string; label: string; isCorrect?: boolean }>)
          : []
      return (
        <AttentionCheckBlock
          question={(stage.question as string) || 'Please select the correct answer:'}
          options={attentionOptions}
          correctAnswer={stage.correct_answer as string || ''}
          config={stage.config as {
            allowRetry?: boolean
            maxAttempts?: number
            showFeedback?: boolean
            failureAction?: 'flag' | 'disqualify' | 'warn'
            feedbackDuration?: number
            randomizeOptions?: boolean
          }}
          stageId={stage.id}
          data={data}
          onFieldChange={onFieldChange}
          readOnly={readOnly}
        />
      )
    }

    case 'external_task':
      return (
        <ExternalTaskBlock
          targetUrl={(stage.target_url as string) || ''}
          config={stage.config as Record<string, unknown>}
          stageId={stage.id}
          data={data}
          errors={errors}
          onFieldChange={onFieldChange}
          onComplete={onAutoComplete}
          onStatusChange={onStatusChange}
          readOnly={readOnly}
        />
      )

    case 'multiple_choice': {
      // Parse question object from stage
      const mcQuestion = (stage.question as {
        type?: 'text' | 'image' | 'video' | 'html'
        content?: string
        subtext?: string
        image_url?: string
        video_url?: string
      }) || { type: 'text', content: '' }

      // Parse answers array from stage
      const mcAnswers = (stage.answers as Array<{
        id: string
        type?: 'text' | 'image' | 'text_with_image' | 'html' | 'free_text'
        content: string
        subtext?: string
        explanation?: string
        label?: string
        badges?: Array<{ text: string; color: 'green' | 'blue' | 'yellow' | 'red' | 'gray' }>
        image_url?: string
        placeholder?: string
      }>) || []

      // Parse config
      const mcConfig = (stage.config as {
        layout?: 'single_column' | '2x2' | '2x3' | '3x2' | 'auto'
        correct_answer?: string | string[]
        allow_multiple_selection?: boolean
        show_correct_after_submit?: boolean
        show_explanation_after_submit?: boolean
        show_answer_explanations?: boolean
        show_answer_labels?: boolean
        label_style?: 'letter' | 'number' | 'none'
        randomize_order?: boolean
        track_score?: boolean
        show_score_to_participant?: boolean
        score_format?: string
      }) || {}

      return (
        <MultipleChoiceBlock
          question={{
            type: mcQuestion.type || 'text',
            content: mcQuestion.content || '',
            subtext: mcQuestion.subtext,
            image_url: mcQuestion.image_url,
            video_url: mcQuestion.video_url,
          }}
          answers={mcAnswers.map((answer) => ({
            id: answer.id,
            type: answer.type || 'text',
            content: answer.content,
            subtext: answer.subtext,
            explanation: answer.explanation,
            label: answer.label,
            badges: answer.badges,
            image_url: answer.image_url,
            placeholder: answer.placeholder,
          }))}
          config={mcConfig}
          explanationBeforeSubmit={stage.explanation_before_submit as string}
          explanationAfterSubmit={stage.explanation_after_submit as string}
          stageId={stage.id}
          data={data}
          errors={errors}
          onFieldChange={onFieldChange}
          readOnly={readOnly}
        />
      )
    }

    default:
      return (
        <div className="p-4 bg-warning-light rounded-lg text-warning">
          Unknown stage type: {stage.type}
        </div>
      )
  }
}

