interface ContentDisplayBlockProps {
  content?: string
  contentType?: string
  config?: Record<string, unknown>
}

export default function ContentDisplayBlock({ content, contentType, config }: ContentDisplayBlockProps) {
  if (!content) {
    return null
  }

  // Config options for dimensions
  const heightConfig = (config?.height as string) || 'auto'
  const widthConfig = (config?.width as string) || '100%'

  // Check if we should use full viewport dimensions
  const isFullWidth = widthConfig === '100%'
  const isFullHeight = heightConfig === '100%'

  // Calculate dimensions - for 100%, use viewport-relative calculations
  // Full width: viewport width minus sidebar (256px) and padding (3rem)
  // Full height: viewport height minus progress bar (~48px), padding, and navigation (~80px)
  const width = isFullWidth ? 'calc(100vw - 256px - 3rem)' : widthConfig
  const height = isFullHeight ? 'calc(100vh - 200px)' : heightConfig

  const containerStyle: React.CSSProperties = {
    width,
    height: height === 'auto' ? undefined : height,
    marginLeft: isFullWidth ? 'calc((100% - (100vw - 256px - 3rem)) / 2)' : undefined,
    maxWidth: isFullWidth ? 'none' : undefined,
    overflow: height !== 'auto' ? 'auto' : undefined,
  }

  if (contentType === 'html') {
    return (
      <div
        className="prose prose-slate max-w-none"
        style={containerStyle}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    )
  }

  // Default to text rendering
  return (
    <div className="prose prose-slate max-w-none" style={containerStyle}>
      {content.split('\n').map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  )
}

