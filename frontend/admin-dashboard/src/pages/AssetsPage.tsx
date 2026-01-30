import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import { api } from '../lib/api'

interface Asset {
  asset_id: string
  filename: string
  content_type: string
  asset_type: string
  size: number
  url: string
  created_at: string
  is_shared: boolean
}

export default function AssetsPage() {
  const queryClient = useQueryClient()
  const [isUploading, setIsUploading] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const response = await api.get('/assets')
      return response.data as { assets: Asset[]; total: number }
    },
  })

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('is_shared', 'true')
      
      await api.post('/assets/upload', formData)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (assetId: string) => {
      await api.delete(`/assets/${assetId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
  })

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setIsUploading(true)
    try {
      for (const file of acceptedFiles) {
        await uploadMutation.mutateAsync(file)
      }
    } finally {
      setIsUploading(false)
    }
  }, [uploadMutation])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
      'video/*': ['.mp4', '.webm', '.ogg'],
      'audio/*': ['.mp3', '.wav', '.ogg'],
      'text/html': ['.html'],
      'text/css': ['.css'],
      'application/javascript': ['.js'],
      'application/pdf': ['.pdf'],
    },
  })

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getAssetIcon = (type: string) => {
    switch (type) {
      case 'image': return '🖼️'
      case 'video': return '🎬'
      case 'audio': return '🎵'
      case 'html': return '📄'
      case 'css': return '🎨'
      case 'javascript': return '⚡'
      case 'pdf': return '📑'
      default: return '📁'
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Assets</h1>
        <p className="text-gray-600 mt-1">Upload and manage media files for your experiments</p>
      </div>

      {/* Upload Zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-primary-500 bg-primary-50'
            : 'border-gray-300 hover:border-primary-400'
        }`}
      >
        <input {...getInputProps()} />
        {isUploading ? (
          <p className="text-gray-600">Uploading...</p>
        ) : isDragActive ? (
          <p className="text-primary-600">Drop files here...</p>
        ) : (
          <div>
            <UploadIcon className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600">
              Drag & drop files here, or <span className="text-primary-600">browse</span>
            </p>
            <p className="text-sm text-gray-400 mt-2">
              Supports images, videos, audio, HTML, CSS, JS, PDF
            </p>
          </div>
        )}
      </div>

      {/* Assets Grid */}
      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : data?.assets.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No assets uploaded yet. Drag and drop files above to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
            {data?.assets.map((asset) => (
              <div
                key={asset.asset_id}
                className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{getAssetIcon(asset.asset_type)}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900 truncate" title={asset.filename}>
                      {asset.filename}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {formatFileSize(asset.size)} • {asset.asset_type}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`asset_id:${asset.asset_id}`)
                      alert('Asset reference copied to clipboard!')
                    }}
                    className="text-sm text-primary-600 hover:text-primary-700"
                  >
                    Copy Reference
                  </button>
                  <div className="flex gap-2">
                    <a
                      href={`/api/assets/${asset.asset_id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-gray-600 hover:text-gray-900"
                    >
                      View
                    </a>
                    <button
                      onClick={() => {
                        if (confirm('Are you sure you want to delete this asset?')) {
                          deleteMutation.mutate(asset.asset_id)
                        }
                      }}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  )
}

