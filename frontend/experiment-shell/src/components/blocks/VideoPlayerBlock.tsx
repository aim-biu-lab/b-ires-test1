import { useRef, useEffect, useState, useCallback } from 'react'
import { eventQueue } from '../../lib/eventQueue'
import { useSessionStore } from '../../store/sessionStore'

interface TopBarStatus {
  type: 'loading' | 'success' | 'warning' | 'error' | 'info'
  message: string
}

interface VideoPlayerBlockProps {
  source: string
  config?: Record<string, unknown>
  stageId: string
  onStatusChange?: (status: TopBarStatus | null) => void
  onFieldChange?: (fieldId: string, value: unknown) => void
  errors?: Record<string, string>
}

// Utility to detect YouTube URLs and extract video ID
const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/

function getYouTubeVideoId(url: string): string | null {
  const match = url.match(YOUTUBE_REGEX)
  return match ? match[1] : null
}

function isYouTubeUrl(url: string): boolean {
  return YOUTUBE_REGEX.test(url)
}

// YouTube Player Component
function YouTubePlayer({
  videoId,
  autoplay,
  controls,
  stageId,
  sessionId,
}: {
  videoId: string
  autoplay: boolean
  controls: boolean
  stageId: string
  sessionId: string | null
}) {
  const [hasStarted, setHasStarted] = useState(false)

  const logEvent = useCallback((eventType: string, payload: Record<string, unknown> = {}) => {
    if (!sessionId) return
    eventQueue.addEvent({
      sessionId,
      eventType,
      stageId,
      blockId: 'video',
      payload: { ...payload, videoType: 'youtube', videoId },
    })
  }, [sessionId, stageId, videoId])

  useEffect(() => {
    if (!hasStarted) {
      logEvent('youtube_video_loaded')
      setHasStarted(true)
    }
  }, [hasStarted, logEvent])

  // Build YouTube embed URL with parameters
  const embedParams = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    controls: controls ? '1' : '0',
    rel: '0', // Don't show related videos from other channels
    modestbranding: '1',
    enablejsapi: '1',
  })

  const embedUrl = `https://www.youtube.com/embed/${videoId}?${embedParams.toString()}`

  return (
    <iframe
      src={embedUrl}
      className="w-full h-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      title="YouTube video player"
    />
  )
}

// Video Start Overlay Component
function VideoStartOverlay({ onStart }: { onStart: () => void }) {
  return (
    <div 
      className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center text-white z-10 cursor-pointer"
      onClick={onStart}
    >
      <div className="w-24 h-24 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center mb-6 transition-colors">
        <svg className="w-12 h-12 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
      <h3 className="text-2xl font-semibold mb-2">Ready to Watch</h3>
      <p className="text-gray-300 text-center max-w-md">
        Click anywhere to start the video
      </p>
    </div>
  )
}

// Video Completed Overlay Component
function VideoCompletedOverlay({ onReplay }: { onReplay?: () => void }) {
  return (
    <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center text-white z-10 animate-fade-in">
      <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-2xl font-semibold mb-2">Video Completed</h3>
      <p className="text-gray-300 text-center max-w-md mb-6">
        You have finished watching the video. Click "Submit" to continue to the next step.
      </p>
      {onReplay && (
        <button
          onClick={onReplay}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Replay Video
        </button>
      )}
    </div>
  )
}

// Native Video Player Component
function NativeVideoPlayer({
  source,
  autoplay,
  controls,
  allowSeek,
  allowPause,
  logProgressInterval,
  stageId,
  sessionId,
  onProgress,
  onEnded,
  showStartOverlay,
  showCompletedOverlay,
  onStart,
  onReplay,
}: {
  source: string
  autoplay: boolean
  controls: boolean
  allowSeek: boolean
  allowPause: boolean
  logProgressInterval: number
  stageId: string
  sessionId: string | null
  onProgress: (progress: number) => void
  onEnded: () => void
  showStartOverlay: boolean
  showCompletedOverlay: boolean
  onStart: () => void
  onReplay: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasEnded, setHasEnded] = useState(false)
  // Track the maximum watched position for seek prevention
  const maxWatchedTimeRef = useRef(0)
  
  // Handle start click - start playing the video
  const handleStartClick = () => {
    if (videoRef.current) {
      videoRef.current.play().catch((err) => {
        console.error('[VideoPlayer] Play error:', err)
        // Don't call onStart if play failed
      })
      onStart()
    }
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let progressTimer: number | null = null

    const logEvent = (eventType: string, payload: Record<string, unknown> = {}) => {
      if (!sessionId) return
      eventQueue.addEvent({
        sessionId,
        eventType,
        stageId,
        blockId: 'video',
        payload: { ...payload, videoType: 'native' },
      })
    }

    const handlePlay = () => {
      setIsPlaying(true)
      logEvent('video_play', { currentTime: video.currentTime })
    }

    const handlePause = () => {
      setIsPlaying(false)
      if (!video.ended) {
        logEvent('video_pause', { currentTime: video.currentTime })
      }
    }

    const handleEnded = () => {
      setIsPlaying(false)
      setHasEnded(true)
      onEnded()
      logEvent('video_ended', { duration: video.duration })
    }

    const handleSeeked = () => {
      logEvent('video_seek', { currentTime: video.currentTime })
    }

    const handleTimeUpdate = () => {
      const progressPercent = (video.currentTime / video.duration) * 100
      onProgress(progressPercent)
      // Update max watched time during normal playback
      if (video.currentTime > maxWatchedTimeRef.current) {
        maxWatchedTimeRef.current = video.currentTime
      }
    }

    const handleFullscreenChange = () => {
      const isFullscreen = document.fullscreenElement === video
      logEvent(isFullscreen ? 'video_fullscreen_enter' : 'video_fullscreen_exit')
    }

    // Prevent seeking if disabled - use 'seeking' event which fires when user initiates a seek
    // Store the attempted seek position before we reset it
    const handleSeeking = () => {
      const attemptedTime = video.currentTime
      // Only allow seeking backwards within already watched content
      // Prevent seeking forward beyond what's been watched
      if (attemptedTime > maxWatchedTimeRef.current + 0.5) {
        video.currentTime = maxWatchedTimeRef.current
        logEvent('video_seek_blocked', { 
          attemptedTime, 
          maxWatched: maxWatchedTimeRef.current 
        })
      }
    }

    // Progress logging interval
    if (logProgressInterval > 0) {
      progressTimer = window.setInterval(() => {
        if (video && !video.paused) {
          logEvent('video_progress', {
            currentTime: video.currentTime,
            duration: video.duration,
            progress: (video.currentTime / video.duration) * 100,
          })
        }
      }, logProgressInterval)
    }

    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('ended', handleEnded)
    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('timeupdate', handleTimeUpdate)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    
    // Only add seeking listener when seek is disabled
    if (!allowSeek) {
      video.addEventListener('seeking', handleSeeking)
    }

    return () => {
      if (progressTimer) clearInterval(progressTimer)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      if (!allowSeek) {
        video.removeEventListener('seeking', handleSeeking)
      }
    }
  }, [sessionId, stageId, logProgressInterval, allowSeek, onProgress, onEnded])

  const handlePauseClick = () => {
    if (!allowPause && isPlaying) {
      return // Prevent pausing
    }
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
    }
  }

  return (
    <>
      <video
        ref={videoRef}
        src={source}
        autoPlay={autoplay}
        controls={controls}
        className="w-full h-full"
        playsInline
      />
      
      {/* Start overlay - shown before video starts */}
      {showStartOverlay && <VideoStartOverlay onStart={handleStartClick} />}
      
      {/* Custom overlay when controls are disabled */}
      {!controls && !showStartOverlay && !showCompletedOverlay && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer"
          onClick={handlePauseClick}
        >
          {!isPlaying && !hasEnded && (
            <div className="w-16 h-16 bg-white/80 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-800 ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          )}
        </div>
      )}
      
      {/* Video completed overlay */}
      {showCompletedOverlay && <VideoCompletedOverlay onReplay={onReplay} />}
    </>
  )
}

export default function VideoPlayerBlock({ source, config, stageId, onStatusChange, onFieldChange, errors }: VideoPlayerBlockProps) {
  const sessionId = useSessionStore((state) => state.sessionId)
  const [progress, setProgress] = useState(0)
  const [hasEnded, setHasEnded] = useState(false)
  const [showCompletedOverlay, setShowCompletedOverlay] = useState(false)
  
  // Check autoplay setting to determine if we show start overlay
  const autoplay = config?.autoplay as boolean ?? false
  const [showStartOverlay, setShowStartOverlay] = useState(!autoplay)
  
  // Track if we've already reported completion to prevent infinite loops
  const hasReportedCompletionRef = useRef(false)
  
  // Handle video start
  const handleVideoStart = useCallback(() => {
    setShowStartOverlay(false)
  }, [])
  
  // Handle video end
  const handleVideoEnded = useCallback(() => {
    setHasEnded(true)
    setShowCompletedOverlay(true)
  }, [])
  
  // Handle replay
  const handleReplay = useCallback(() => {
    setShowCompletedOverlay(false)
    setProgress(0)
  }, [])

  // Get validation error for this block
  const validationError = errors?._video_completed

  // Report completion status to parent (top bar) and set field for validation
  // Only report once to prevent infinite update loops
  useEffect(() => {
    if (hasEnded && !hasReportedCompletionRef.current) {
      hasReportedCompletionRef.current = true
      
      if (onStatusChange) {
        onStatusChange({
          type: 'success',
          message: 'Video completed',
        })
      }
      // Mark video as completed for validation
      if (onFieldChange) {
        onFieldChange('_video_completed', true)
      }
    }
  }, [hasEnded, onStatusChange, onFieldChange])

  const controls = config?.controls as boolean ?? true
  const allowSeek = config?.allow_seek as boolean ?? true
  const allowPause = config?.allow_pause as boolean ?? true
  const logProgressInterval = config?.log_progress_interval_ms as number ?? 5000

  // Config options for dimensions
  const heightConfig = (config?.height as string) || 'auto'
  const widthConfig = (config?.width as string) || '100%'

  // Check if we should use full dimensions - video should fill parent container
  const isFullWidth = widthConfig === '100%'
  const isFullHeight = heightConfig === '100%'

  // For 100% width, use full parent width (parent already handles layout constraints)
  const width = isFullWidth ? '100%' : widthConfig

  const youtubeVideoId = getYouTubeVideoId(source)
  const isYouTube = isYouTubeUrl(source)

  // When using full height, use flex layout to fill available space without overflow
  // The parent container (ExperimentShell) now uses h-screen with proper flex layout,
  // so we can simply use h-full to fill the remaining space
  if (isFullHeight) {
    return (
      <div className="flex flex-col h-full">
        <div 
          className="relative rounded-lg overflow-hidden bg-black flex-1 min-h-0"
          style={{ width }}
        >
          {isYouTube && youtubeVideoId ? (
            <YouTubePlayer
              videoId={youtubeVideoId}
              autoplay={autoplay}
              controls={controls}
              stageId={stageId}
              sessionId={sessionId}
            />
          ) : (
            <NativeVideoPlayer
              source={source}
              autoplay={autoplay}
              controls={controls}
              allowSeek={allowSeek}
              allowPause={allowPause}
              logProgressInterval={logProgressInterval}
              stageId={stageId}
              sessionId={sessionId}
              onProgress={setProgress}
              onEnded={handleVideoEnded}
              showStartOverlay={showStartOverlay}
              showCompletedOverlay={showCompletedOverlay}
              onStart={handleVideoStart}
              onReplay={handleReplay}
            />
          )}
        </div>

        {/* Progress indicator (only for native video) */}
        {!isYouTube && !showStartOverlay && !showCompletedOverlay && (
          <div className="h-1 bg-border rounded-full overflow-hidden mt-4 flex-shrink-0">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        
        {/* Validation error message */}
        {validationError && (
          <p className="text-sm text-red-500 mt-2 flex-shrink-0">{validationError}</p>
        )}
      </div>
    )
  }

  // Non-full-height mode - original behavior with aspect ratio
  return (
    <div className="space-y-4">
      <div 
        className="relative rounded-lg overflow-hidden bg-black"
        style={{ 
          width,
          height: heightConfig === 'auto' ? undefined : heightConfig,
          aspectRatio: heightConfig === 'auto' ? '16/9' : undefined,
        }}
      >
        {isYouTube && youtubeVideoId ? (
          <YouTubePlayer
            videoId={youtubeVideoId}
            autoplay={autoplay}
            controls={controls}
            stageId={stageId}
            sessionId={sessionId}
          />
        ) : (
          <NativeVideoPlayer
            source={source}
            autoplay={autoplay}
            controls={controls}
            allowSeek={allowSeek}
            allowPause={allowPause}
            logProgressInterval={logProgressInterval}
            stageId={stageId}
            sessionId={sessionId}
            onProgress={setProgress}
            onEnded={handleVideoEnded}
            showStartOverlay={showStartOverlay}
            showCompletedOverlay={showCompletedOverlay}
            onStart={handleVideoStart}
            onReplay={handleReplay}
          />
        )}
      </div>

      {/* Progress indicator (only for native video) */}
      {!isYouTube && !showStartOverlay && !showCompletedOverlay && (
        <div className="h-1 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      
      {/* Validation error message */}
      {validationError && (
        <p className="text-sm text-red-500">{validationError}</p>
      )}
    </div>
  )
}

