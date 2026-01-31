/**
 * WebSocket client for External Task communication
 * Used by the experiment shell to communicate with the backend
 * about external task status and send commands to external apps
 */

export type ExternalTaskStatus = 
  | 'pending'
  | 'started'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'

export interface ExternalTaskState {
  status: ExternalTaskStatus
  progress: number
  currentStep: string | null
  externalAppConnected: boolean
  data: Record<string, unknown> | null
  closeWindow?: boolean  // Flag to tell parent to close popup window on completion
}

export type ExternalTaskCommand = 'restart' | 'close' | 'pause' | 'resume' | 'custom'

interface WSMessage {
  type: string
  payload?: Record<string, unknown>
  timestamp?: string
}

type MessageHandler = (message: WSMessage) => void
type StatusChangeHandler = (state: ExternalTaskState) => void
type ConnectionChangeHandler = (connected: boolean) => void

export class ExternalTaskSocket {
  private ws: WebSocket | null = null
  private taskToken: string
  private wsUrl: string
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private messageHandlers: Map<string, MessageHandler[]> = new Map()
  private statusChangeHandlers: StatusChangeHandler[] = []
  private connectionChangeHandlers: ConnectionChangeHandler[] = []
  private currentState: ExternalTaskState = {
    status: 'pending',
    progress: 0,
    currentStep: null,
    externalAppConnected: false,
    data: null,
  }
  private isConnected = false
  private shouldReconnect = true

  constructor(taskToken: string, wsUrl: string) {
    this.taskToken = taskToken
    this.wsUrl = wsUrl
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Build full WebSocket URL
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const host = window.location.host
        const fullWsUrl = `${protocol}//${host}${this.wsUrl}`

        this.ws = new WebSocket(fullWsUrl)

        this.ws.onopen = () => {
          console.log('[ExternalTaskSocket] Connected')
          this.isConnected = true
          this.reconnectAttempts = 0
          
          // Send shell identification message
          this.send({
            type: 'shell_connect',
            payload: { taskToken: this.taskToken },
          })
          
          this.notifyConnectionChange(true)
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WSMessage
            this.handleMessage(message)
          } catch (e) {
            console.error('[ExternalTaskSocket] Failed to parse message:', e)
          }
        }

        this.ws.onclose = (event) => {
          console.log('[ExternalTaskSocket] Disconnected:', event.code, event.reason)
          this.isConnected = false
          this.notifyConnectionChange(false)
          
          // Attempt reconnect if not intentionally closed
          if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect()
          }
        }

        this.ws.onerror = (error) => {
          console.error('[ExternalTaskSocket] Error:', error)
          reject(error)
        }
      } catch (e) {
        reject(e)
      }
    })
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.shouldReconnect = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.isConnected = false
  }

  /**
   * Send a message to the server
   */
  private send(message: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        ...message,
        timestamp: new Date().toISOString(),
      }))
    } else {
      console.warn('[ExternalTaskSocket] Cannot send - not connected')
    }
  }

  /**
   * Send a command to the external app
   */
  sendCommand(command: ExternalTaskCommand, data?: Record<string, unknown>): void {
    this.send({
      type: 'send_command',
      payload: {
        command,
        data: data || {},
      },
    })
  }

  /**
   * Send restart command
   */
  sendRestart(): void {
    this.sendCommand('restart')
  }

  /**
   * Send close command
   */
  sendClose(): void {
    this.sendCommand('close')
  }

  /**
   * Send pause command
   */
  sendPause(): void {
    this.sendCommand('pause')
  }

  /**
   * Send resume command
   */
  sendResume(): void {
    this.sendCommand('resume')
  }

  /**
   * Send custom command
   */
  sendCustomCommand(action: string, data?: Record<string, unknown>): void {
    this.sendCommand('custom', { action, ...data })
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: WSMessage): void {
    const { type, payload } = message

    switch (type) {
      case 'status':
        // Initial status from server
        this.updateState({
          status: payload?.status as ExternalTaskStatus,
          progress: (payload?.progress as number) || 0,
          currentStep: (payload?.current_step as string) || null,
          externalAppConnected: (payload?.external_app_connected as boolean) || false,
          data: (payload?.data as Record<string, unknown>) || null,
        })
        break

      case 'external_app_connected':
        this.updateState({ externalAppConnected: true, status: 'started' })
        break

      case 'external_app_disconnected':
        this.updateState({ externalAppConnected: false })
        break

      case 'progress_update':
        this.updateState({
          progress: (payload?.progress as number) || this.currentState.progress,
          currentStep: (payload?.step as string) || this.currentState.currentStep,
          status: 'in_progress',
        })
        break

      case 'task_completed':
        this.updateState({
          status: 'completed',
          progress: 100,
          data: (payload?.data as Record<string, unknown>) || null,
          closeWindow: (payload?.close_window as boolean) || false,
        })
        break

      case 'command_sent':
        // Command was sent to external app
        this.notifyHandlers('command_sent', message)
        break

      case 'command_ack_received':
        // External app acknowledged command
        this.notifyHandlers('command_ack', message)
        break

      case 'error':
        console.error('[ExternalTaskSocket] Server error:', payload)
        this.notifyHandlers('error', message)
        break

      case 'pong':
        // Heartbeat response
        break

      default:
        // Forward to any registered handlers
        this.notifyHandlers(type, message)
    }
  }

  /**
   * Update current state and notify handlers
   */
  private updateState(updates: Partial<ExternalTaskState>): void {
    this.currentState = { ...this.currentState, ...updates }
    this.notifyStatusChange()
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    
    console.log(`[ExternalTaskSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
    
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect().catch((e) => {
          console.error('[ExternalTaskSocket] Reconnect failed:', e)
        })
      }
    }, delay)
  }

  /**
   * Register a handler for a specific message type
   */
  on(messageType: string, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, [])
    }
    this.messageHandlers.get(messageType)!.push(handler)

    // Return unsubscribe function
    return () => {
      const handlers = this.messageHandlers.get(messageType)
      if (handlers) {
        const index = handlers.indexOf(handler)
        if (index > -1) {
          handlers.splice(index, 1)
        }
      }
    }
  }

  /**
   * Register a handler for status changes
   */
  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusChangeHandlers.push(handler)
    
    // Immediately call with current state
    handler(this.currentState)

    return () => {
      const index = this.statusChangeHandlers.indexOf(handler)
      if (index > -1) {
        this.statusChangeHandlers.splice(index, 1)
      }
    }
  }

  /**
   * Register a handler for connection changes
   */
  onConnectionChange(handler: ConnectionChangeHandler): () => void {
    this.connectionChangeHandlers.push(handler)
    
    // Immediately call with current state
    handler(this.isConnected)

    return () => {
      const index = this.connectionChangeHandlers.indexOf(handler)
      if (index > -1) {
        this.connectionChangeHandlers.splice(index, 1)
      }
    }
  }

  /**
   * Notify handlers of a specific message type
   */
  private notifyHandlers(messageType: string, message: WSMessage): void {
    const handlers = this.messageHandlers.get(messageType)
    if (handlers) {
      handlers.forEach((handler) => handler(message))
    }
  }

  /**
   * Notify status change handlers
   */
  private notifyStatusChange(): void {
    this.statusChangeHandlers.forEach((handler) => handler(this.currentState))
  }

  /**
   * Notify connection change handlers
   */
  private notifyConnectionChange(connected: boolean): void {
    this.connectionChangeHandlers.forEach((handler) => handler(connected))
  }

  /**
   * Get current state
   */
  getState(): ExternalTaskState {
    return { ...this.currentState }
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected
  }

  /**
   * Send ping for keepalive
   */
  ping(): void {
    this.send({ type: 'ping' })
  }
}



