/**
 * Asset Field Component
 * URL input with asset browser integration
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { GuiFieldDefinition } from '../../../lib/gui-schema'

interface Asset {
  asset_id: string
  filename: string
  content_type: string
  url: string
  created_at: string
}

interface AssetFieldProps {
  field: GuiFieldDefinition
  value: string | undefined
  onChange: (value: string) => void
  disabled?: boolean
  experimentId?: string
}

export function AssetField({ field, value, onChange, disabled, experimentId: _experimentId }: AssetFieldProps) {
  const [showBrowser, setShowBrowser] = useState(false)
  const currentValue = value ?? ''

  // Fetch all available assets (not filtered by experiment)
  const { data: assetsData, isLoading, error: fetchError } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const response = await api.get('/assets')
      return response.data
    },
    enabled: showBrowser,
    retry: false,
  })

  // Safely extract assets array from response
  const assets: Asset[] = Array.isArray(assetsData?.assets) ? assetsData.assets : []

  // Filter assets by type
  const filteredAssets = assets.filter((asset) => {
    if (!field.assetTypes || field.assetTypes.includes('any')) return true
    const type = asset.content_type.split('/')[0]
    return field.assetTypes.some((t) => {
      if (t === 'image') return type === 'image'
      if (t === 'video') return type === 'video'
      if (t === 'audio') return type === 'audio'
      if (t === 'html') return asset.content_type === 'text/html' || asset.filename.endsWith('.html')
      return false
    })
  })

  const handleSelectAsset = (asset: Asset) => {
    // Use the API download endpoint, not the internal MinIO URL
    onChange(`/api/assets/${asset.asset_id}/download`)
    setShowBrowser(false)
  }

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {field.description && <p className="text-xs text-gray-500">{field.description}</p>}

      <div className="flex gap-2">
        <input
          type="text"
          value={currentValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || 'Enter URL or select asset...'}
          disabled={disabled}
          className={`flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 ${
            disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
          }`}
        />
        <button
          type="button"
          onClick={() => setShowBrowser(!showBrowser)}
          disabled={disabled}
          className={`px-3 py-2 text-sm font-medium border rounded-md transition-colors ${
            showBrowser
              ? 'bg-primary-100 border-primary-300 text-primary-700'
              : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          title="Browse assets"
        >
          <FolderIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Asset Browser */}
      {showBrowser && (
        <div className="mt-2 border border-gray-200 rounded-lg bg-gray-50 p-3 max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="text-sm text-gray-500 text-center py-4">Loading assets...</div>
          ) : fetchError ? (
            <div className="text-sm text-red-500 text-center py-4">
              <p className="font-medium">Failed to load assets</p>
              <p className="text-xs mt-1">You can still enter URLs manually.</p>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-4">
              {assets.length === 0 ? 'No assets uploaded yet' : 'No matching assets found'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filteredAssets.map((asset) => (
                <button
                  key={asset.asset_id}
                  type="button"
                  onClick={() => handleSelectAsset(asset)}
                  className="flex items-center gap-2 p-2 text-left text-sm rounded-md hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200 transition-all"
                >
                  <AssetIcon contentType={asset.content_type} />
                  <span className="flex-1 truncate">{asset.filename}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preview for images/videos */}
      {currentValue && (
        <AssetPreview url={currentValue} assetTypes={field.assetTypes} />
      )}
    </div>
  )
}

function AssetPreview({
  url,
  assetTypes,
}: {
  url: string
  assetTypes?: ('image' | 'video' | 'audio' | 'html' | 'any')[]
}) {
  const isImage =
    assetTypes?.includes('image') ||
    url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ||
    url.includes('image')
  const isVideo =
    assetTypes?.includes('video') || url.match(/\.(mp4|webm|ogg)$/i) || url.includes('video')

  if (isImage) {
    return (
      <div className="mt-2 p-2 bg-gray-100 rounded-md">
        <img
          src={url}
          alt="Preview"
          className="max-h-32 rounded object-contain mx-auto"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      </div>
    )
  }

  if (isVideo) {
    return (
      <div className="mt-2 p-2 bg-gray-100 rounded-md text-center">
        <VideoIcon className="w-8 h-8 text-gray-400 mx-auto" />
        <p className="text-xs text-gray-500 mt-1 truncate">{url}</p>
      </div>
    )
  }

  return null
}

function AssetIcon({ contentType }: { contentType: string }) {
  const type = contentType.split('/')[0]
  if (type === 'image') return <ImageIcon className="w-4 h-4 text-blue-500" />
  if (type === 'video') return <VideoIcon className="w-4 h-4 text-purple-500" />
  if (type === 'audio') return <AudioIcon className="w-4 h-4 text-green-500" />
  return <FileIcon className="w-4 h-4 text-gray-400" />
}

// Icons
function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
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

function AudioIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
      />
    </svg>
  )
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
      />
    </svg>
  )
}

