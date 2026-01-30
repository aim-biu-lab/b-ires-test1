import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as monaco from 'monaco-editor'
import { api } from '../lib/api'
import {
  QUESTION_TYPES,
  FIELD_TYPES,
  THEMES,
} from '../lib/yaml-schema'

interface Asset {
  asset_id: string
  filename: string
  content_type: string
  asset_type: string
  size: number
  url: string
}

interface EditorToolbarProps {
  editorRef: React.MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>
}

type DropdownType = 'asset' | 'question' | 'field' | 'theme' | 'html' | null
type AssetInsertMode = 'source' | 'html_img' | null

export function EditorToolbar({ editorRef }: EditorToolbarProps) {
  const [activeDropdown, setActiveDropdown] = useState<DropdownType>(null)
  const [assetFilter, setAssetFilter] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [_assetInsertMode, setAssetInsertMode] = useState<AssetInsertMode>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Fetch available assets
  const { data: assetsData } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const response = await api.get('/assets')
      return response.data as { assets: Asset[]; total: number }
    },
  })

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setActiveDropdown(null)
        setSelectedAsset(null)
        setAssetInsertMode(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const insertTextAtCursor = (text: string) => {
    const editor = editorRef.current
    if (!editor) return

    const selection = editor.getSelection()
    if (selection) {
      editor.executeEdits('insert', [
        {
          range: selection,
          text: text,
          forceMoveMarkers: true,
        },
      ])
      editor.focus()
    }
    setActiveDropdown(null)
    setSelectedAsset(null)
    setAssetInsertMode(null)
  }

  const handleAssetClick = (asset: Asset) => {
    // For images, show submenu with insert options
    if (asset.asset_type === 'image') {
      setSelectedAsset(asset)
      setAssetInsertMode(null)
    } else {
      // For other assets, insert directly as source
      insertAssetAsSource(asset)
    }
  }

  const insertAssetAsSource = (asset: Asset) => {
    // Use the actual API URL that the video/iframe player can load directly
    const assetUrl = `/api/assets/${asset.asset_id}/download`
    const snippet = `source: "${assetUrl}"  # ${asset.filename}`
    insertTextAtCursor(snippet)
  }

  const insertAssetAsHtmlImg = (asset: Asset) => {
    const snippet = `<img src="/api/assets/${asset.asset_id}/download" alt="${asset.filename}" />`
    insertTextAtCursor(snippet)
  }

  const insertQuestion = (questionType: string) => {
    // Correct indentation: 4 spaces for items inside questions array
    const snippets: Record<string, string> = {
      text: `- id: "q_text"
  text: "Enter your response:"
  type: "text"
  required: true`,
      textarea: `- id: "q_textarea"
  text: "Please describe in detail:"
  type: "textarea"
  required: true`,
      number: `- id: "q_number"
  text: "Enter a number:"
  type: "number"
  required: true`,
      select: `- id: "q_select"
  text: "Choose an option:"
  type: "select"
  required: true
  options:
    - value: "opt1"
      label: "Option 1"
    - value: "opt2"
      label: "Option 2"`,
      radio: `- id: "q_radio"
  text: "Select one:"
  type: "radio"
  required: true
  options:
    - value: "opt1"
      label: "Option 1"
    - value: "opt2"
      label: "Option 2"`,
      checkbox: `- id: "q_checkbox"
  text: "Select all that apply:"
  type: "checkbox"
  required: false
  options:
    - value: "opt1"
      label: "Option 1"
    - value: "opt2"
      label: "Option 2"`,
      likert_scale: `- id: "q_likert"
  text: "Rate your agreement:"
  type: "likert_scale"
  required: true
  range: [1, 5]`,
      slider: `- id: "q_slider"
  text: "Adjust the slider:"
  type: "slider"
  required: true
  range: [0, 100]`,
      date: `- id: "q_date"
  text: "Select a date:"
  type: "date"
  required: true`,
      time: `- id: "q_time"
  text: "Select a time:"
  type: "time"
  required: true`,
      email: `- id: "q_email"
  text: "Enter your email:"
  type: "email"
  required: true`,
      hidden: `- id: "q_hidden"
  text: ""
  type: "hidden"
  required: false`,
    }

    insertTextAtCursor(snippets[questionType] || `- id: "q_new"\n  text: ""\n  type: "${questionType}"`)
  }

  const insertField = (fieldType: string) => {
    // Correct indentation: 4 spaces for items inside fields array
    const snippets: Record<string, string> = {
      text: `- field: "text_field"
  label: "Text Field"
  type: "text"
  required: true`,
      number: `- field: "number_field"
  label: "Number"
  type: "number"
  required: true
  min: 0
  max: 100`,
      select: `- field: "select_field"
  label: "Select"
  type: "select"
  required: true
  options:
    - value: "opt1"
      label: "Option 1"
    - value: "opt2"
      label: "Option 2"`,
      radio: `- field: "radio_field"
  label: "Radio Choice"
  type: "radio"
  required: true
  options:
    - value: "opt1"
      label: "Option 1"
    - value: "opt2"
      label: "Option 2"`,
      date: `- field: "date_field"
  label: "Date"
  type: "date"
  required: true`,
      email: `- field: "email_field"
  label: "Email"
  type: "email"
  required: true`,
    }

    insertTextAtCursor(snippets[fieldType] || `- field: "new_field"\n  label: ""\n  type: "${fieldType}"`)
  }

  const insertTheme = (theme: string) => {
    insertTextAtCursor(`theme: "${theme}"`)
  }

  const insertHtmlSnippet = (snippetType: string) => {
    const snippets: Record<string, string> = {
      image: `<img src="/api/assets/ASSET_ID/download" alt="description" style="max-width: 100%;" />`,
      link: `<a href="URL" target="_blank">Link text</a>`,
      heading: `<h2>Heading</h2>`,
      paragraph: `<p>Your text here...</p>`,
      list: `<ul>
  <li>Item 1</li>
  <li>Item 2</li>
</ul>`,
      bold: `<strong>Bold text</strong>`,
      italic: `<em>Italic text</em>`,
      div: `<div style="">
  Content here
</div>`,
    }
    insertTextAtCursor(snippets[snippetType] || '')
  }

  const filteredAssets = assetsData?.assets.filter(
    (asset) =>
      asset.filename.toLowerCase().includes(assetFilter.toLowerCase()) ||
      asset.asset_type.toLowerCase().includes(assetFilter.toLowerCase())
  )

  const imageAssets = filteredAssets?.filter((asset) => asset.asset_type === 'image')

  const getAssetIcon = (type: string) => {
    switch (type) {
      case 'image':
        return '🖼️'
      case 'video':
        return '🎬'
      case 'audio':
        return '🎵'
      case 'html':
        return '📄'
      case 'css':
        return '🎨'
      case 'javascript':
        return '⚡'
      case 'pdf':
        return '📑'
      default:
        return '📁'
    }
  }

  return (
    <div
      ref={dropdownRef}
      className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 flex-wrap"
    >
      {/* Insert Asset Button */}
      <div className="relative">
        <button
          onClick={() => {
            setActiveDropdown(activeDropdown === 'asset' ? null : 'asset')
            setSelectedAsset(null)
          }}
          className={`toolbar-btn ${activeDropdown === 'asset' ? 'toolbar-btn-active' : ''}`}
          title="Insert Asset Reference"
        >
          <FileIcon className="w-4 h-4" />
          <span>Asset</span>
          <ChevronIcon className="w-3 h-3" />
        </button>

        {activeDropdown === 'asset' && (
          <div className="dropdown-menu w-80">
            <div className="p-2 border-b border-gray-100">
              <input
                type="text"
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value)}
                placeholder="Search assets..."
                className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:border-primary-400"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {!filteredAssets?.length ? (
                <div className="px-3 py-4 text-sm text-gray-500 text-center">
                  {assetsData?.assets.length === 0 ? (
                    <>
                      No assets uploaded yet.
                      <br />
                      <a href="/assets" className="text-primary-600 hover:underline">
                        Go to Assets
                      </a>
                    </>
                  ) : (
                    'No matching assets'
                  )}
                </div>
              ) : (
                filteredAssets.map((asset) => (
                  <div key={asset.asset_id} className="relative">
                    {selectedAsset?.asset_id === asset.asset_id && asset.asset_type === 'image' ? (
                      // Show insert options for selected image
                      <div className="bg-primary-50 border-l-2 border-primary-500">
                        <div className="px-3 py-2 text-sm font-medium text-primary-700 border-b border-primary-100">
                          Insert "{asset.filename}" as:
                        </div>
                        <button
                          onClick={() => insertAssetAsSource(asset)}
                          className="w-full px-3 py-2 text-sm text-left hover:bg-primary-100 flex items-center gap-2"
                        >
                          <CodeIcon className="w-4 h-4" />
                          <span>YAML source reference</span>
                        </button>
                        <button
                          onClick={() => insertAssetAsHtmlImg(asset)}
                          className="w-full px-3 py-2 text-sm text-left hover:bg-primary-100 flex items-center gap-2"
                        >
                          <ImageIcon className="w-4 h-4" />
                          <span>HTML &lt;img&gt; tag</span>
                        </button>
                        <button
                          onClick={() => setSelectedAsset(null)}
                          className="w-full px-3 py-1 text-xs text-gray-500 text-left hover:bg-gray-100"
                        >
                          ← Back
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleAssetClick(asset)}
                        className="dropdown-item w-full"
                      >
                        <span className="text-lg mr-2">{getAssetIcon(asset.asset_type)}</span>
                        <div className="flex-1 text-left min-w-0">
                          <div className="font-medium truncate">{asset.filename}</div>
                          <div className="text-xs text-gray-500">{asset.asset_type}</div>
                        </div>
                        {asset.asset_type === 'image' && (
                          <span className="text-xs text-gray-400">▸</span>
                        )}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Insert Image (quick access for images) */}
      <div className="relative">
        <button
          onClick={() => setActiveDropdown(activeDropdown === 'html' ? null : 'html')}
          className={`toolbar-btn ${activeDropdown === 'html' ? 'toolbar-btn-active' : ''}`}
          title="Insert HTML Elements"
        >
          <HtmlIcon className="w-4 h-4" />
          <span>HTML</span>
          <ChevronIcon className="w-3 h-3" />
        </button>

        {activeDropdown === 'html' && (
          <div className="dropdown-menu w-64">
            <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase">
              Insert HTML
            </div>
            
            {/* Image assets submenu */}
            {imageAssets && imageAssets.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 border-t border-gray-100 mt-1">
                  Images from Assets
                </div>
                {imageAssets.slice(0, 5).map((asset) => (
                  <button
                    key={asset.asset_id}
                    onClick={() => insertAssetAsHtmlImg(asset)}
                    className="dropdown-item"
                  >
                    <span className="text-lg mr-2">🖼️</span>
                    <span className="truncate">{asset.filename}</span>
                  </button>
                ))}
                {imageAssets.length > 5 && (
                  <div className="px-3 py-1 text-xs text-gray-400">
                    +{imageAssets.length - 5} more (use Asset button)
                  </div>
                )}
                <div className="border-t border-gray-100 my-1" />
              </>
            )}

            <div className="px-3 py-1.5 text-xs font-semibold text-gray-400">
              HTML Snippets
            </div>
            <button onClick={() => insertHtmlSnippet('image')} className="dropdown-item">
              <ImageIcon className="w-4 h-4 mr-2" />
              Image (template)
            </button>
            <button onClick={() => insertHtmlSnippet('heading')} className="dropdown-item">
              <span className="w-4 h-4 mr-2 font-bold text-sm">H</span>
              Heading
            </button>
            <button onClick={() => insertHtmlSnippet('paragraph')} className="dropdown-item">
              <span className="w-4 h-4 mr-2 text-sm">¶</span>
              Paragraph
            </button>
            <button onClick={() => insertHtmlSnippet('list')} className="dropdown-item">
              <ListIcon className="w-4 h-4 mr-2" />
              List
            </button>
            <button onClick={() => insertHtmlSnippet('link')} className="dropdown-item">
              <LinkIcon className="w-4 h-4 mr-2" />
              Link
            </button>
            <button onClick={() => insertHtmlSnippet('bold')} className="dropdown-item">
              <span className="w-4 h-4 mr-2 font-bold text-sm">B</span>
              Bold
            </button>
            <button onClick={() => insertHtmlSnippet('italic')} className="dropdown-item">
              <span className="w-4 h-4 mr-2 italic text-sm">I</span>
              Italic
            </button>
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-gray-300" />

      {/* Insert Question Button */}
      <div className="relative">
        <button
          onClick={() => setActiveDropdown(activeDropdown === 'question' ? null : 'question')}
          className={`toolbar-btn ${activeDropdown === 'question' ? 'toolbar-btn-active' : ''}`}
          title="Insert Question"
        >
          <QuestionIcon className="w-4 h-4" />
          <span>Question</span>
          <ChevronIcon className="w-3 h-3" />
        </button>

        {activeDropdown === 'question' && (
          <div className="dropdown-menu max-h-72 overflow-y-auto">
            {QUESTION_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => insertQuestion(type)}
                className="dropdown-item"
              >
                <span className="font-medium">{type.replace(/_/g, ' ')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Insert Field Button */}
      <div className="relative">
        <button
          onClick={() => setActiveDropdown(activeDropdown === 'field' ? null : 'field')}
          className={`toolbar-btn ${activeDropdown === 'field' ? 'toolbar-btn-active' : ''}`}
          title="Insert Field"
        >
          <InputIcon className="w-4 h-4" />
          <span>Field</span>
          <ChevronIcon className="w-3 h-3" />
        </button>

        {activeDropdown === 'field' && (
          <div className="dropdown-menu">
            {FIELD_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => insertField(type)}
                className="dropdown-item"
              >
                <span className="font-medium">{type.replace(/_/g, ' ')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-gray-300" />

      {/* Insert Theme Button */}
      <div className="relative">
        <button
          onClick={() => setActiveDropdown(activeDropdown === 'theme' ? null : 'theme')}
          className={`toolbar-btn ${activeDropdown === 'theme' ? 'toolbar-btn-active' : ''}`}
          title="Insert Theme"
        >
          <PaletteIcon className="w-4 h-4" />
          <span>Theme</span>
          <ChevronIcon className="w-3 h-3" />
        </button>

        {activeDropdown === 'theme' && (
          <div className="dropdown-menu">
            {THEMES.map((theme) => (
              <button
                key={theme}
                onClick={() => insertTheme(theme)}
                className="dropdown-item"
              >
                <span className="font-medium">{theme.replace(/_/g, ' ')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Help tooltip */}
      <span className="text-xs text-gray-500">
        Tip: <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl+Space</kbd> for autocomplete
      </span>
    </div>
  )
}

// Icons
function FileIcon({ className }: { className?: string }) {
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

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  )
}

function HtmlIcon({ className }: { className?: string }) {
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

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
      />
    </svg>
  )
}

function QuestionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function InputIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  )
}

function PaletteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
      />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 10h16M4 14h16M4 18h16"
      />
    </svg>
  )
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
      />
    </svg>
  )
}
