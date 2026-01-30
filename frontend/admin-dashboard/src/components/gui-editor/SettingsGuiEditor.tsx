/**
 * Settings GUI Editor
 * Visual editor for experiment meta and shell_config settings
 */

import { useState } from 'react'
import { META_FIELDS, SHELL_CONFIG_FIELDS, SETTINGS_SECTIONS, GuiSection } from '../../lib/gui-schema'
import { FieldRenderer } from './fields'

interface SettingsGuiEditorProps {
  settings: Record<string, unknown>
  onChange: (path: string, value: unknown) => void
  disabled?: boolean
  experimentId?: string
}

export function SettingsGuiEditor({ settings, onChange, disabled, experimentId }: SettingsGuiEditorProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(SETTINGS_SECTIONS.filter((s) => s.defaultExpanded !== false).map((s) => s.id))
  )

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }

  // Get value from nested path like "meta.id" or "shell_config.progress.show_progress_bar"
  const getValue = (path: string): unknown => {
    const parts = path.split('.')
    let current: unknown = settings
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  // Group fields by section
  const metaFields = META_FIELDS
  const themeFields = SHELL_CONFIG_FIELDS.filter((f) => f.key === 'shell_config.theme' || f.key === 'shell_config.logo_url')
  const progressFields = SHELL_CONFIG_FIELDS.filter((f) => f.key.includes('.progress.'))
  const sidebarFields = SHELL_CONFIG_FIELDS.filter((f) => f.key.includes('.sidebar.'))
  const navigationBarFields = SHELL_CONFIG_FIELDS.filter((f) => f.key.includes('.navigation_bar.'))
  const customFields = SHELL_CONFIG_FIELDS.filter((f) => f.key === 'shell_config.custom_css')

  return (
    <div className="space-y-4">
      {/* Meta Section */}
      <Section
        section={SETTINGS_SECTIONS.find((s) => s.id === 'meta')!}
        expanded={expandedSections.has('meta')}
        onToggle={() => toggleSection('meta')}
      >
        <div className="space-y-4">
          {metaFields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={getValue(field.key)}
              onChange={(value) => onChange(field.key, value)}
              disabled={disabled}
              experimentId={experimentId}
            />
          ))}
        </div>
      </Section>

      {/* Theme Section */}
      <Section
        section={SETTINGS_SECTIONS.find((s) => s.id === 'theme')!}
        expanded={expandedSections.has('theme')}
        onToggle={() => toggleSection('theme')}
      >
        <div className="space-y-4">
          {themeFields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={getValue(field.key)}
              onChange={(value) => onChange(field.key, value)}
              disabled={disabled}
              experimentId={experimentId}
            />
          ))}
        </div>
      </Section>

      {/* Progress Section */}
      <Section
        section={SETTINGS_SECTIONS.find((s) => s.id === 'progress')!}
        expanded={expandedSections.has('progress')}
        onToggle={() => toggleSection('progress')}
      >
        <div className="space-y-4">
          {progressFields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={getValue(field.key)}
              onChange={(value) => onChange(field.key, value)}
              disabled={disabled}
              experimentId={experimentId}
            />
          ))}
        </div>
      </Section>

      {/* Sidebar Section */}
      <Section
        section={SETTINGS_SECTIONS.find((s) => s.id === 'sidebar')!}
        expanded={expandedSections.has('sidebar')}
        onToggle={() => toggleSection('sidebar')}
      >
        <div className="space-y-4">
          {sidebarFields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={getValue(field.key)}
              onChange={(value) => onChange(field.key, value)}
              disabled={disabled}
              experimentId={experimentId}
            />
          ))}
        </div>
      </Section>

      {/* Navigation Bar Section */}
      <Section
        section={SETTINGS_SECTIONS.find((s) => s.id === 'navigation_bar')!}
        expanded={expandedSections.has('navigation_bar')}
        onToggle={() => toggleSection('navigation_bar')}
      >
        <div className="space-y-4">
          {navigationBarFields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={getValue(field.key)}
              onChange={(value) => onChange(field.key, value)}
              disabled={disabled}
              experimentId={experimentId}
            />
          ))}
        </div>
      </Section>

      {/* Custom Styling Section */}
      <Section
        section={SETTINGS_SECTIONS.find((s) => s.id === 'custom')!}
        expanded={expandedSections.has('custom')}
        onToggle={() => toggleSection('custom')}
      >
        <div className="space-y-4">
          {customFields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={getValue(field.key)}
              onChange={(value) => onChange(field.key, value)}
              disabled={disabled}
              experimentId={experimentId}
            />
          ))}
        </div>
      </Section>
    </div>
  )
}

// Section Component
interface SectionProps {
  section: GuiSection
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

function Section({ section, expanded, onToggle, children }: SectionProps) {
  const isCollapsible = section.collapsible !== false

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <button
        type="button"
        onClick={isCollapsible ? onToggle : undefined}
        className={`w-full flex items-center justify-between px-4 py-3 text-left bg-gray-50 border-b border-gray-200 ${
          isCollapsible ? 'cursor-pointer hover:bg-gray-100' : 'cursor-default'
        }`}
      >
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{section.label}</h3>
          {section.description && (
            <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
          )}
        </div>
        {isCollapsible && (
          <ChevronIcon
            className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </button>
      {expanded && <div className="p-4">{children}</div>}
    </div>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

