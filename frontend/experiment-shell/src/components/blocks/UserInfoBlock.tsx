import { FieldConfig } from '../../store/sessionStore'
import clsx from 'clsx'

interface UserInfoBlockProps {
  fields: FieldConfig[]
  data: Record<string, unknown>
  errors: Record<string, string>
  onFieldChange: (fieldId: string, value: unknown) => void
  readOnly?: boolean
  // When true, only show required star for fields with required === true (for participant_identity)
  // When false (default), show required star for all fields unless required === false
  requireExplicitRequired?: boolean
}

// Group fields by row number
function groupFieldsByRow(fields: FieldConfig[]): FieldConfig[][] {
  const rowMap = new Map<number, FieldConfig[]>()
  let autoRowCounter = 1000 // Start high for fields without explicit row

  fields.forEach((field) => {
    const rowNum = field.row ?? autoRowCounter++
    if (!rowMap.has(rowNum)) {
      rowMap.set(rowNum, [])
    }
    rowMap.get(rowNum)!.push(field)
  })

  // Sort by row number and return grouped arrays
  return Array.from(rowMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, fieldGroup]) => fieldGroup)
}

// Get Tailwind classes for field width
function getWidthClasses(width?: FieldConfig['width']): string {
  switch (width) {
    case 'quarter':
      return 'w-full sm:w-1/4'
    case 'third':
      return 'w-full sm:w-1/3'
    case 'half':
      return 'w-full sm:w-1/2'
    case 'two-thirds':
      return 'w-full sm:w-2/3'
    case 'full':
    default:
      return 'w-full'
  }
}

export default function UserInfoBlock({
  fields,
  data,
  errors,
  onFieldChange,
  readOnly = false,
  requireExplicitRequired = false,
}: UserInfoBlockProps) {
  const groupedFields = groupFieldsByRow(fields)

  return (
    <div className="space-y-6">
      {groupedFields.map((rowFields, rowIndex) => (
        <div
          key={rowIndex}
          className={clsx(
            'flex flex-wrap gap-4',
            rowFields.length === 1 && !rowFields[0].width && 'flex-col'
          )}
        >
          {rowFields.map((field) => (
            <div
              key={field.field}
              className={clsx(getWidthClasses(field.width), 'min-w-0 flex-shrink-0')}
              style={
                field.width
                  ? { flex: `0 0 calc(${getFlexBasis(field.width)} - 1rem)` }
                  : undefined
              }
            >
              <UserInfoField
                field={field}
                value={data[field.field]}
                error={errors[field.field]}
                onChange={(value) => onFieldChange(field.field, value)}
                readOnly={readOnly}
                requireExplicitRequired={requireExplicitRequired}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function getFlexBasis(width?: FieldConfig['width']): string {
  switch (width) {
    case 'quarter':
      return '25%'
    case 'third':
      return '33.333%'
    case 'half':
      return '50%'
    case 'two-thirds':
      return '66.666%'
    case 'full':
    default:
      return '100%'
  }
}

interface UserInfoFieldProps {
  field: FieldConfig
  value: unknown
  error?: string
  onChange: (value: unknown) => void
  readOnly?: boolean
  requireExplicitRequired?: boolean
}

function UserInfoField({ field, value, error, onChange, readOnly = false, requireExplicitRequired = false }: UserInfoFieldProps) {
  const disabledClass = readOnly ? 'opacity-70 cursor-not-allowed' : ''
  
  // Get margin from field config (CSS value like "10px", "20px 0 10px 0")
  const inputMargin = (field as Record<string, unknown>).margin as string | undefined
  const inputStyle = inputMargin ? { margin: inputMargin } : undefined
  
  const renderInput = () => {
    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            placeholder={field.placeholder}
            className={clsx('input', error && 'input-error', disabledClass)}
            disabled={readOnly}
            style={inputStyle}
          />
        )

      case 'email':
        return (
          <input
            type="email"
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            placeholder={field.placeholder}
            className={clsx('input', error && 'input-error', disabledClass)}
            disabled={readOnly}
            style={inputStyle}
          />
        )

      case 'number':
        return (
          <input
            type="number"
            value={(value as number) ?? ''}
            onChange={(e) => !readOnly && onChange(e.target.valueAsNumber)}
            min={field.min}
            max={field.max}
            placeholder={field.placeholder}
            className={clsx('input', error && 'input-error', disabledClass)}
            disabled={readOnly}
            style={inputStyle}
          />
        )

      case 'date':
        return (
          <input
            type="date"
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            className={clsx('input', error && 'input-error', disabledClass)}
            disabled={readOnly}
            style={inputStyle}
          />
        )

      case 'select':
        return (
          <select
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            className={clsx('input', error && 'input-error', disabledClass)}
            disabled={readOnly}
            style={inputStyle}
          >
            <option value="">{field.placeholder || 'Select an option...'}</option>
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )

      case 'radio':
        return (
          <div className="space-y-2" style={inputStyle}>
            {field.options?.map((option) => (
              <label
                key={option.value}
                className={clsx(
                  'flex items-center gap-3 p-3 rounded-lg border border-border transition-colors',
                  readOnly ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-surface-elevated'
                )}
              >
                <input
                  type="radio"
                  name={field.field}
                  value={option.value}
                  checked={value === option.value}
                  onChange={() => !readOnly && onChange(option.value)}
                  className="w-4 h-4 text-primary focus:ring-primary"
                  disabled={readOnly}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        )

      case 'checkbox':
        const selectedValues = (value as string[]) || []
        return (
          <div className="space-y-2" style={inputStyle}>
            {field.options?.map((option) => (
              <label
                key={option.value}
                className={clsx(
                  'flex items-center gap-3 p-3 rounded-lg border border-border transition-colors',
                  readOnly ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-surface-elevated'
                )}
              >
                <input
                  type="checkbox"
                  value={option.value}
                  checked={selectedValues.includes(option.value)}
                  onChange={(e) => {
                    if (readOnly) return
                    if (e.target.checked) {
                      onChange([...selectedValues, option.value])
                    } else {
                      onChange(selectedValues.filter((v) => v !== option.value))
                    }
                  }}
                  className="w-4 h-4 rounded text-primary focus:ring-primary"
                  disabled={readOnly}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        )

      case 'consent':
        return (
          <div className={clsx('flex items-start gap-3', readOnly && 'opacity-70')} style={inputStyle}>
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => !readOnly && onChange(e.target.checked)}
              className={clsx(
                'mt-1.5 w-4 h-4 rounded text-primary focus:ring-primary flex-shrink-0',
                error && 'ring-2 ring-error',
                readOnly && 'cursor-not-allowed'
              )}
              disabled={readOnly}
            />
            <span className="text-text-primary leading-relaxed">
              {field.consentUrl ? (
                <>
                  {field.label.split(field.consentLinkText || 'consent form')[0]}
                  <a
                    href={field.consentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary-hover"
                  >
                    {field.consentLinkText || 'consent form'}
                  </a>
                  {field.label.split(field.consentLinkText || 'consent form')[1]}
                </>
              ) : (
                field.label
              )}
            </span>
          </div>
        )

      case 'phone':
        return (
          <input
            type="tel"
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            className={clsx('input', error && 'input-error', disabledClass)}
            placeholder={field.placeholder || '+1 (555) 123-4567'}
            disabled={readOnly}
            style={inputStyle}
          />
        )

      case 'textarea':
        return (
          <textarea
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            placeholder={field.placeholder}
            className={clsx('input min-h-[100px]', error && 'input-error', disabledClass)}
            disabled={readOnly}
            style={inputStyle}
          />
        )

      case 'header':
        // Display-only header/text, no input
        return null

      default:
        return (
          <input
            type="text"
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            placeholder={field.placeholder}
            className={clsx('input', error && 'input-error', disabledClass)}
            disabled={readOnly}
            style={inputStyle}
          />
        )
    }
  }

  // For consent type, we render differently (no label above)
  if (field.type === 'consent') {
    return (
      <div className="space-y-2">
        {renderInput()}
        {error && <p className="text-sm text-error">{error}</p>}
      </div>
    )
  }

  // For header type, just render the header text
  if (field.type === 'header') {
    return (
      <div className="py-2">
        {field.headerText && (
          <h6 className="text-text-primary font-semibold">
            <span dangerouslySetInnerHTML={{ __html: field.headerText }} />
          </h6>
        )}
        {field.helpText && (
          <p className="text-sm text-text-secondary mt-1">{field.helpText}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Header text above the field (optional) */}
      {field.headerText && (
        <h6 className="text-text-secondary text-sm font-medium">{field.headerText}</h6>
      )}

      {/* Label for the field */}
      {field.label && field.type !== 'consent' && (
        <label className="block">
          <span className="text-text-primary font-medium">
            {field.label}
            {/* Show red star: if requireExplicitRequired, only when required===true; otherwise when required!==false */}
            {(requireExplicitRequired ? field.required === true : field.required !== false) && (
              <span className="text-error ml-1">*</span>
            )}
          </span>
        </label>
      )}

      {renderInput()}

      {/* Helper text below the field */}
      {field.helpText && (
        <p className="text-sm text-text-secondary">{field.helpText}</p>
      )}

      {/* Error message */}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  )
}
