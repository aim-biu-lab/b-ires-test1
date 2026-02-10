/**
 * Hot Edit Channel - postMessage wrapper for real-time preview updates
 * 
 * Enables communication between the admin editor and participant shell preview
 * without requiring backend involvement. Uses postMessage for cross-origin support.
 */

export interface HotEditMessage {
  type: 'config_update' | 'preview_ready' | 'editor_closed' | 'ping'
  experimentId: string
  config?: Record<string, unknown>
  changedPaths?: string[]
  isStructuralChange: boolean
  timestamp: number
  source: 'hot-edit-editor'
}

export interface HotEditPreviewResponse {
  type: 'preview_connected' | 'pong'
  experimentId: string
  timestamp: number
  source: 'hot-edit-preview'
}

const DEBOUNCE_DELAY_MS = 1500

/**
 * Detects if a change is structural (requires refresh) or content-only (live update)
 * 
 * Structural changes:
 * - Stage added/removed
 * - Stage order changed
 * - Stage type changed
 * - Stage ID changed
 * - Phase/block structure changes
 * - Navigation rules changed
 * 
 * Content changes (live update):
 * - Text/content changes
 * - Image URLs, labels, descriptions
 * - Layout/style properties
 * - Timing settings
 */
export function detectStructuralChange(
  oldConfig: Record<string, unknown> | null,
  newConfig: Record<string, unknown>,
  changedPaths: string[]
): boolean {
  // If no old config, it's the initial load - not structural
  if (!oldConfig) return false

  // Check for structural path patterns
  const structuralPatterns = [
    /^phases\[\d+\]$/,                           // Phase added/removed
    /^phases\[\d+\]\.stages\[\d+\]$/,            // Stage added/removed
    /^phases\[\d+\]\.stages\[\d+\]\.blocks\[\d+\]$/, // Block added/removed
    /^phases\[\d+\]\.stages\[\d+\]\.blocks\[\d+\]\.tasks\[\d+\]$/, // Task added/removed
    /\.id$/,                                      // ID changes
    /\.type$/,                                    // Type changes
    /^stages\[\d+\]$/,                           // Flat stage added/removed
    /\.rules\./,                                  // Navigation rules
    /\.ordering$/,                                // Ordering changes
  ]

  for (const path of changedPaths) {
    for (const pattern of structuralPatterns) {
      if (pattern.test(path)) {
        return true
      }
    }
  }

  // Check if the number of stages/phases changed
  const oldPhases = (oldConfig.phases as unknown[]) || []
  const newPhases = (newConfig.phases as unknown[]) || []
  if (oldPhases.length !== newPhases.length) return true

  // Check flat stages if present
  const oldStages = (oldConfig.stages as unknown[]) || []
  const newStages = (newConfig.stages as unknown[]) || []
  if (oldStages.length !== newStages.length) return true

  return false
}

/**
 * Computes the paths that changed between two configs
 */
export function computeChangedPaths(
  oldConfig: Record<string, unknown> | null,
  newConfig: Record<string, unknown>,
  prefix = ''
): string[] {
  if (!oldConfig) return [prefix || 'root']

  const changedPaths: string[] = []

  const allKeys = new Set([
    ...Object.keys(oldConfig),
    ...Object.keys(newConfig)
  ])

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key
    const oldValue = oldConfig[key]
    const newValue = newConfig[key]

    if (oldValue === newValue) continue

    if (
      typeof oldValue === 'object' &&
      typeof newValue === 'object' &&
      oldValue !== null &&
      newValue !== null &&
      !Array.isArray(oldValue) &&
      !Array.isArray(newValue)
    ) {
      // Recurse into objects
      changedPaths.push(
        ...computeChangedPaths(
          oldValue as Record<string, unknown>,
          newValue as Record<string, unknown>,
          path
        )
      )
    } else if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      // For arrays, check length and items
      if (oldValue.length !== newValue.length) {
        changedPaths.push(path)
      } else {
        for (let i = 0; i < oldValue.length; i++) {
          if (typeof oldValue[i] === 'object' && typeof newValue[i] === 'object') {
            changedPaths.push(
              ...computeChangedPaths(
                oldValue[i] as Record<string, unknown>,
                newValue[i] as Record<string, unknown>,
                `${path}[${i}]`
              )
            )
          } else if (oldValue[i] !== newValue[i]) {
            changedPaths.push(`${path}[${i}]`)
          }
        }
      }
    } else {
      changedPaths.push(path)
    }
  }

  return changedPaths
}

/**
 * Hot Edit Channel class for the admin editor
 * Uses postMessage for cross-origin communication with preview tabs
 */
export class HotEditChannel {
  private experimentId: string
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private lastConfig: Record<string, unknown> | null = null
  private previewConnected = false
  private onPreviewConnectedCallback: ((connected: boolean) => void) | null = null
  private previewWindow: Window | null = null
  private messageHandler: ((event: MessageEvent) => void) | null = null
  private shellBaseUrl: string

  constructor(experimentId: string) {
    this.experimentId = experimentId
    this.shellBaseUrl = import.meta.env.VITE_SHELL_URL || window.location.origin
  }

  /**
   * Opens the channel and starts listening for preview responses
   */
  open(): void {
    if (this.messageHandler) return

    // Listen for messages from preview window
    this.messageHandler = (event: MessageEvent) => {
      // Verify origin matches shell URL
      const shellOrigin = new URL(this.shellBaseUrl).origin
      if (event.origin !== shellOrigin) return

      const message = event.data as HotEditPreviewResponse
      
      // Verify this is a hot-edit message
      if (!message || message.source !== 'hot-edit-preview') return
      
      // Verify experiment ID matches
      if (message.experimentId !== this.experimentId) return

      if (message.type === 'preview_connected' || message.type === 'pong') {
        // Update preview window reference from event source (handles page reloads)
        if (event.source && event.source !== this.previewWindow) {
          this.previewWindow = event.source as Window
        }
        
        this.previewConnected = true
        this.onPreviewConnectedCallback?.(true)
        
        // Send current config immediately when preview connects
        if (this.lastConfig) {
          this.sendConfigUpdate(this.lastConfig, true)
        }
      }
    }

    window.addEventListener('message', this.messageHandler)
  }

  /**
   * Closes the channel and notifies preview
   */
  close(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    // Notify preview that editor is closing
    if (this.previewWindow && !this.previewWindow.closed) {
      const message: HotEditMessage = {
        type: 'editor_closed',
        experimentId: this.experimentId,
        isStructuralChange: false,
        timestamp: Date.now(),
        source: 'hot-edit-editor'
      }
      this.previewWindow.postMessage(message, this.shellBaseUrl)
    }

    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler)
      this.messageHandler = null
    }

    this.previewWindow = null
    this.previewConnected = false
    this.onPreviewConnectedCallback?.(false)
  }

  /**
   * Opens the preview window and sends initial ping
   */
  openPreview(): Window | null {
    const previewUrl = this.getPreviewUrl()
    this.previewWindow = window.open(previewUrl, '_blank')
    
    // Send ping after a short delay to let the preview load
    if (this.previewWindow) {
      setTimeout(() => {
        this.sendPing()
      }, 500)
    }
    
    return this.previewWindow
  }

  /**
   * Sets the preview window reference (for existing windows)
   */
  setPreviewWindow(win: Window): void {
    this.previewWindow = win
  }

  /**
   * Sends a ping to check if preview is connected
   */
  private sendPing(): void {
    if (!this.previewWindow || this.previewWindow.closed) return

    const message: HotEditMessage = {
      type: 'ping',
      experimentId: this.experimentId,
      isStructuralChange: false,
      timestamp: Date.now(),
      source: 'hot-edit-editor'
    }
    this.previewWindow.postMessage(message, this.shellBaseUrl)
  }

  /**
   * Sends a config update immediately
   */
  private sendConfigUpdate(config: Record<string, unknown>, immediate = false): void {
    if (!this.previewWindow || this.previewWindow.closed) return

    const changedPaths = computeChangedPaths(this.lastConfig, config)
    const isStructuralChange = detectStructuralChange(this.lastConfig, config, changedPaths)

    const message: HotEditMessage = {
      type: 'config_update',
      experimentId: this.experimentId,
      config,
      changedPaths,
      isStructuralChange,
      timestamp: Date.now(),
      source: 'hot-edit-editor'
    }

    this.previewWindow.postMessage(message, this.shellBaseUrl)
    
    if (!immediate) {
      this.lastConfig = config
    }
  }

  /**
   * Queues a config update with debouncing
   */
  queueConfigUpdate(config: Record<string, unknown>): void {
    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // Set new debounce timer
    this.debounceTimer = setTimeout(() => {
      this.sendConfigUpdate(config)
      this.debounceTimer = null
    }, DEBOUNCE_DELAY_MS)
  }

  /**
   * Sets callback for preview connection status changes
   */
  onPreviewConnected(callback: (connected: boolean) => void): void {
    this.onPreviewConnectedCallback = callback
  }

  /**
   * Returns whether preview is currently connected
   */
  isPreviewConnected(): boolean {
    return this.previewConnected
  }

  /**
   * Sets the initial config without sending an update
   */
  setInitialConfig(config: Record<string, unknown>): void {
    this.lastConfig = config
  }

  /**
   * Gets the preview URL for this experiment
   */
  getPreviewUrl(): string {
    return `${this.shellBaseUrl}?preview=hot-edit&exp=${this.experimentId}`
  }
}

/**
 * Creates and returns a HotEditChannel instance
 */
export function createHotEditChannel(experimentId: string): HotEditChannel {
  return new HotEditChannel(experimentId)
}
