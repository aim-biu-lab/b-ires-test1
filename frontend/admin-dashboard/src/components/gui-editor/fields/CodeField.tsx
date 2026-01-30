/**
 * Code Field Component
 * Syntax-highlighted code editor for HTML/CSS content
 */

import { useRef, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { GuiFieldDefinition } from '../../../lib/gui-schema'

interface CodeFieldProps {
  field: GuiFieldDefinition
  value: string | undefined
  onChange: (value: string) => void
  disabled?: boolean
}

export function CodeField({ field, value, onChange, disabled }: CodeFieldProps) {
  const currentValue = value ?? (field.default as string) ?? ''
  const language = field.language || 'html'
  const rows = field.rows ?? 10
  const height = `${rows * 20}px`
  const editorRef = useRef<unknown>(null)

  const handleEditorMount = useCallback((editor: unknown) => {
    editorRef.current = editor
  }, [])

  const handleChange = useCallback(
    (value: string | undefined) => {
      onChange(value || '')
    },
    [onChange]
  )

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <span className="text-xs text-gray-400 uppercase">{language}</span>
      </div>
      {field.description && <p className="text-xs text-gray-500">{field.description}</p>}

      <div className="border border-gray-300 rounded-md overflow-hidden">
        <Editor
          height={height}
          defaultLanguage={language}
          value={currentValue}
          onChange={handleChange}
          onMount={handleEditorMount}
          theme="vs-light"
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            insertSpaces: true,
            readOnly: disabled,
            automaticLayout: true,
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
            },
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            renderLineHighlight: 'none',
            folding: true,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
          }}
        />
      </div>

      {/* Quick templates for HTML content */}
      {language === 'html' && !disabled && (
        <div className="flex flex-wrap gap-1 mt-1">
          <QuickInsertButton
            label="Heading"
            code="<h2>Title</h2>"
            onClick={(code) => onChange(currentValue + '\n' + code)}
          />
          <QuickInsertButton
            label="Paragraph"
            code="<p>Text here...</p>"
            onClick={(code) => onChange(currentValue + '\n' + code)}
          />
          <QuickInsertButton
            label="List"
            code="<ul>\n  <li>Item 1</li>\n  <li>Item 2</li>\n</ul>"
            onClick={(code) => onChange(currentValue + '\n' + code)}
          />
          <QuickInsertButton
            label="Bold"
            code="<strong>bold text</strong>"
            onClick={(code) => onChange(currentValue + code)}
          />
          <QuickInsertButton
            label="Link"
            code='<a href="URL">link text</a>'
            onClick={(code) => onChange(currentValue + code)}
          />
        </div>
      )}
    </div>
  )
}

function QuickInsertButton({
  label,
  code,
  onClick,
}: {
  label: string
  code: string
  onClick: (code: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(code)}
      className="px-2 py-0.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
      title={`Insert ${label}`}
    >
      {label}
    </button>
  )
}

