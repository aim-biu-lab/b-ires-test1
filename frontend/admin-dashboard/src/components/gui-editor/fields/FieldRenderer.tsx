/**
 * Field Renderer Component
 * Renders the appropriate field component based on field type
 */

import { GuiFieldDefinition } from '../../../lib/gui-schema'
import { ToggleField } from './ToggleField'
import { SelectField } from './SelectField'
import { InputField } from './InputField'
import { NumberField } from './NumberField'
import { TextareaField } from './TextareaField'
import { RangeField } from './RangeField'
import { ArrayField } from './ArrayField'
import { AssetField } from './AssetField'
import { CodeField } from './CodeField'
import { WeightsField } from './WeightsField'
import { LatinSquareField } from './LatinSquareField'
import { VisibilityRuleField } from './VisibilityRuleField'
import { PickAssignsField } from './PickAssignsField'
import { PickConditionsField } from './PickConditionsField'

// Context for hierarchy-aware fields
interface FieldContext {
  children?: Array<{ id: string; label?: string; title?: string }>
  orderingMode?: string
  availableVariables?: Array<{
    path: string
    label: string
    type: 'string' | 'number' | 'boolean' | 'array'
    source: 'stage' | 'participant' | 'environment' | 'assignment'
  }>
  // For pick_assigns field - existing variable names used in the experiment
  existingVariables?: string[]
  // For pick_conditions field - variables defined via pick_assigns
  pickAssignsVariables?: Array<{
    name: string
    possibleValues: string[]
  }>
}

interface FieldRendererProps {
  field: GuiFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  onBlur?: (value: unknown) => void
  disabled?: boolean
  experimentId?: string
  context?: FieldContext
}

export function FieldRenderer({ field, value, onChange, onBlur, disabled, experimentId, context }: FieldRendererProps) {
  switch (field.type) {
    case 'boolean':
      return (
        <ToggleField
          field={field}
          value={value as boolean | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      )

    case 'select':
      return (
        <SelectField
          field={field}
          value={value as string | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      )

    case 'text':
      return (
        <InputField
          field={field}
          value={value as string | undefined}
          onChange={onChange}
          onBlur={onBlur}
          disabled={disabled}
        />
      )

    case 'number':
      return (
        <NumberField
          field={field}
          value={value as number | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      )

    case 'textarea':
      return (
        <TextareaField
          field={field}
          value={value as string | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      )

    case 'range':
      return (
        <RangeField
          field={field}
          value={value as [number, number] | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      )

    case 'array':
      return (
        <ArrayField
          field={field}
          value={value as unknown[] | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      )

    case 'asset':
      return (
        <AssetField
          field={field}
          value={value as string | undefined}
          onChange={onChange}
          disabled={disabled}
          experimentId={experimentId}
        />
      )

    case 'code':
      return (
        <CodeField
          field={field}
          value={value as string | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      )

    case 'weights':
      return (
        <WeightsField
          field={field}
          value={value as Array<{ id: string; value: number }> | undefined}
          onChange={onChange}
          disabled={disabled}
          context={{
            children: context?.children || [],
            orderingMode: context?.orderingMode,
          }}
        />
      )

    case 'latin_square':
      return (
        <LatinSquareField
          field={field}
          disabled={disabled}
          context={{
            children: context?.children || [],
            orderingMode: context?.orderingMode,
          }}
        />
      )

    case 'visibility_rule':
      return (
        <VisibilityRuleField
          field={field}
          value={value as string | undefined}
          onChange={onChange}
          disabled={disabled}
          context={{
            availableVariables: context?.availableVariables || [],
          }}
        />
      )

    case 'pick_assigns':
      return (
        <PickAssignsField
          field={field}
          value={value as Record<string, string> | undefined}
          onChange={onChange}
          disabled={disabled}
          context={{
            existingVariables: context?.existingVariables || [],
          }}
        />
      )

    case 'pick_conditions':
      return (
        <PickConditionsField
          field={field}
          value={value as Array<{ variable: string; operator: string }> | undefined}
          onChange={onChange}
          disabled={disabled}
          context={{
            pickAssignsVariables: context?.pickAssignsVariables || [],
          }}
        />
      )

    case 'object':
      // Object fields are rendered as nested field groups
      if (field.properties) {
        return (
          <div className="space-y-3 pl-3 border-l-2 border-gray-200">
            <label className="block text-sm font-medium text-gray-700">{field.label}</label>
            {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
            {field.properties.map((prop) => (
              <FieldRenderer
                key={prop.key}
                field={prop}
                value={(value as Record<string, unknown>)?.[prop.key]}
                onChange={(v) => {
                  const obj = (value || {}) as Record<string, unknown>
                  onChange({ ...obj, [prop.key]: v })
                }}
                disabled={disabled}
                experimentId={experimentId}
                context={context}
              />
            ))}
          </div>
        )
      }
      return null

    default:
      // Fallback to text input for unknown types
      return (
        <InputField
          field={field}
          value={value as string | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      )
  }
}
