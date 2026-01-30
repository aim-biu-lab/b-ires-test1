/**
 * Hot Edit Receiver - postMessage listener for preview mode
 * 
 * Receives config updates from the admin editor and categorizes them
 * as structural (requiring refresh) or content-only (live update).
 * Uses postMessage for cross-origin support.
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

export interface HotEditCallbacks {
  onConfigUpdate: (config: Record<string, unknown>, isStructuralChange: boolean) => void
  onEditorClosed: () => void
  onConnected: () => void
}

/**
 * Hot Edit Receiver class for the participant shell preview
 * Listens for config updates from the admin editor via postMessage
 */
export class HotEditReceiver {
  private experimentId: string
  private callbacks: HotEditCallbacks | null = null
  private connected = false
  private messageHandler: ((event: MessageEvent) => void) | null = null
  // Reserved for future security validation (origin checking)
  private _editorOrigin: string | null = null

  constructor(experimentId: string) {
    this.experimentId = experimentId
  }

  /**
   * Opens the receiver and starts listening for editor messages
   */
  open(callbacks: HotEditCallbacks): void {
    if (this.messageHandler) return

    this.callbacks = callbacks

    this.messageHandler = (event: MessageEvent) => {
      const message = event.data as HotEditMessage

      // Verify this is a hot-edit message from the editor
      if (!message || message.source !== 'hot-edit-editor') return

      // Ignore messages for different experiments (shouldn't happen, but safety check)
      if (message.experimentId !== this.experimentId) return

      // Store the editor's origin for responses (reserved for future security validation)
      this._editorOrigin = event.origin

      switch (message.type) {
        case 'ping':
          // Respond to ping with pong
          this.sendResponse({ type: 'pong' })
          if (!this.connected) {
            this.connected = true
            this.callbacks?.onConnected()
          }
          break

        case 'config_update':
          if (message.config) {
            this.callbacks?.onConfigUpdate(message.config, message.isStructuralChange)
          }
          break

        case 'editor_closed':
          this.callbacks?.onEditorClosed()
          break
      }
    }

    window.addEventListener('message', this.messageHandler)

    // Send connected message to editor (if opened from editor)
    // Try to send to opener if available
    if (window.opener) {
      this.sendResponse({ type: 'preview_connected' })
      this.connected = true
      this.callbacks?.onConnected()
    }
  }

  /**
   * Sends a response message to the editor
   */
  private sendResponse(response: Omit<HotEditPreviewResponse, 'experimentId' | 'timestamp' | 'source'>): void {
    // Try to send to opener window (if opened from editor)
    if (window.opener) {
      const message: HotEditPreviewResponse = {
        ...response,
        experimentId: this.experimentId,
        timestamp: Date.now(),
        source: 'hot-edit-preview'
      }
      // Use '*' for targetOrigin since we don't know the editor's origin initially
      // The editor will verify the experimentId anyway
      window.opener.postMessage(message, '*')
    }
  }

  /**
   * Closes the receiver
   */
  close(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler)
      this.messageHandler = null
    }
    this.connected = false
    this.callbacks = null
    this._editorOrigin = null
  }

  /**
   * Returns whether the receiver is connected
   */
  isConnected(): boolean {
    return this.connected
  }
}

/**
 * Creates and returns a HotEditReceiver instance
 */
export function createHotEditReceiver(experimentId: string): HotEditReceiver {
  return new HotEditReceiver(experimentId)
}

/**
 * Extracts a stage config from the full experiment config by stage ID
 */
export function extractStageConfig(
  config: Record<string, unknown>,
  stageId: string
): Record<string, unknown> | null {
  // Check hierarchical structure (phases > stages > blocks > tasks)
  const phases = config.phases as Array<Record<string, unknown>> | undefined
  if (phases) {
    for (const phase of phases) {
      const stages = phase.stages as Array<Record<string, unknown>> | undefined
      if (stages) {
        for (const stage of stages) {
          // Check stage level
          if (stage.id === stageId) {
            return stage
          }
          // Check blocks
          const blocks = stage.blocks as Array<Record<string, unknown>> | undefined
          if (blocks) {
            for (const block of blocks) {
              if (block.id === stageId) {
                return block
              }
              // Check tasks
              const tasks = block.tasks as Array<Record<string, unknown>> | undefined
              if (tasks) {
                for (const task of tasks) {
                  if (task.id === stageId) {
                    return task
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Check flat stages structure
  const stages = config.stages as Array<Record<string, unknown>> | undefined
  if (stages) {
    for (const stage of stages) {
      if (stage.id === stageId) {
        return stage
      }
    }
  }

  return null
}

/**
 * Flattens the experiment config to get all stages/tasks in order
 * Returns an array of stage configs
 */
export function flattenStages(config: Record<string, unknown>): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []

  // Check hierarchical structure (phases > stages > blocks > tasks)
  const phases = config.phases as Array<Record<string, unknown>> | undefined
  if (phases) {
    for (const phase of phases) {
      const stages = phase.stages as Array<Record<string, unknown>> | undefined
      if (stages) {
        for (const stage of stages) {
          const blocks = stage.blocks as Array<Record<string, unknown>> | undefined
          if (blocks) {
            for (const block of blocks) {
              const tasks = block.tasks as Array<Record<string, unknown>> | undefined
              if (tasks) {
                result.push(...tasks)
              } else {
                // Block without tasks - add the block itself
                result.push(block)
              }
            }
          } else {
            // Stage without blocks - add the stage itself
            result.push(stage)
          }
        }
      }
    }
  }

  // Check flat stages structure
  const stages = config.stages as Array<Record<string, unknown>> | undefined
  if (stages) {
    result.push(...stages)
  }

  return result
}

/**
 * Gets the shell config from the experiment config
 */
export function getShellConfig(config: Record<string, unknown>): Record<string, unknown> {
  return (config.shell_config as Record<string, unknown>) || {}
}
