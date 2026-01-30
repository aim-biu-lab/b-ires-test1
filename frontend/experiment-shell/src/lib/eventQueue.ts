import Dexie, { Table } from 'dexie'
import { api } from './api'

export interface QueuedEvent {
  id?: number
  idempotencyKey: string
  sessionId: string
  eventType: string
  stageId: string
  blockId?: string
  payload: Record<string, unknown>
  timestamp: number
  retryCount: number
  syncedAt: number | null
}

export interface PendingSubmission {
  id?: number
  idempotencyKey: string
  sessionId: string
  stageId: string
  data: Record<string, unknown>
  timestamp: number
  retryCount: number
  status: 'pending' | 'syncing' | 'failed' | 'completed'
  errorMessage?: string
  completedAt: number | null
}

class EventDatabase extends Dexie {
  events!: Table<QueuedEvent>
  submissions!: Table<PendingSubmission>

  constructor() {
    super('bires-events')
    this.version(2).stores({
      events: '++id, idempotencyKey, sessionId, eventType, syncedAt',
      submissions: '++id, idempotencyKey, sessionId, stageId, status, completedAt',
    })
  }
}

const db = new EventDatabase()

const MAX_RETRY_COUNT = 5
const RETRY_DELAY_BASE_MS = 1000

export const eventQueue = {
  async addEvent(event: {
    sessionId: string
    eventType: string
    stageId: string
    blockId?: string
    payload?: Record<string, unknown>
  }) {
    const timestamp = Date.now()
    const idempotencyKey = `${event.sessionId}_${event.stageId}_${event.eventType}_${timestamp}`

    const queuedEvent: QueuedEvent = {
      idempotencyKey,
      sessionId: event.sessionId,
      eventType: event.eventType,
      stageId: event.stageId,
      blockId: event.blockId,
      payload: event.payload || {},
      timestamp,
      retryCount: 0,
      syncedAt: null,
    }

    await db.events.add(queuedEvent)

    // Try to sync immediately if online
    if (navigator.onLine) {
      this.syncEvents()
    }
  },

  async syncEvents() {
    // Get all events where syncedAt is null or 0 (not yet synced)
    const allEvents = await db.events.toArray()
    const unsyncedEvents = allEvents.filter(e => !e.syncedAt)

    if (unsyncedEvents.length === 0) return
    
    console.log(`[EventQueue] Syncing ${unsyncedEvents.length} events`)

    // Group by session
    const sessions = new Map<string, QueuedEvent[]>()
    for (const event of unsyncedEvents) {
      const sessionEvents = sessions.get(event.sessionId) || []
      sessionEvents.push(event)
      sessions.set(event.sessionId, sessionEvents)
    }

    // Sync each session's events
    for (const [sessionId, events] of sessions) {
      // Skip preview sessions - they don't exist in the backend
      if (sessionId.startsWith('preview-')) {
        // Mark as synced to prevent repeated attempts
        const syncedAt = Date.now()
        for (const event of events) {
          if (event.id) {
            await db.events.update(event.id, { syncedAt })
          }
        }
        continue
      }
      
      try {
        console.log(`[EventQueue] Sending ${events.length} events for session ${sessionId}`)
        
        const response = await api.post('/logs/batch', {
          session_id: sessionId,
          events: events.map((e) => ({
            idempotency_key: e.idempotencyKey,
            session_id: e.sessionId,
            event_type: e.eventType,
            stage_id: e.stageId,
            block_id: e.blockId,
            payload: e.payload,
            timestamp: new Date(e.timestamp).toISOString(),
          })),
        })

        console.log(`[EventQueue] Sync response:`, response.data)

        // Mark as synced
        const syncedAt = Date.now()
        for (const event of events) {
          if (event.id) {
            await db.events.update(event.id, { syncedAt })
          }
        }

        // Clean up old synced events (keep last 24 hours)
        const cutoff = Date.now() - 24 * 60 * 60 * 1000
        await db.events.where('syncedAt').below(cutoff).delete()
        
        console.log(`[EventQueue] Successfully synced ${events.length} events`)
      } catch (error) {
        console.error('[EventQueue] Failed to sync events for session', sessionId, error)

        // Increment retry count
        for (const event of events) {
          if (event.id) {
            await db.events.update(event.id, { retryCount: event.retryCount + 1 })
          }
        }
      }
    }
  },

  async getPendingCount(): Promise<number> {
    const allEvents = await db.events.toArray()
    return allEvents.filter(e => !e.syncedAt).length
  },

  async clearAll() {
    await db.events.clear()
    await db.submissions.clear()
  },

  // Stage submission queue methods
  async queueSubmission(submission: {
    sessionId: string
    stageId: string
    data: Record<string, unknown>
  }): Promise<string> {
    const timestamp = Date.now()
    const idempotencyKey = `submit_${submission.sessionId}_${submission.stageId}_${timestamp}`

    const pendingSubmission: PendingSubmission = {
      idempotencyKey,
      sessionId: submission.sessionId,
      stageId: submission.stageId,
      data: submission.data,
      timestamp,
      retryCount: 0,
      status: 'pending',
      completedAt: null,
    }

    await db.submissions.add(pendingSubmission)

    return idempotencyKey
  },

  async markSubmissionSyncing(idempotencyKey: string) {
    const submission = await db.submissions.where('idempotencyKey').equals(idempotencyKey).first()
    if (submission?.id) {
      await db.submissions.update(submission.id, { status: 'syncing' })
    }
  },

  async markSubmissionCompleted(idempotencyKey: string) {
    const submission = await db.submissions.where('idempotencyKey').equals(idempotencyKey).first()
    if (submission?.id) {
      await db.submissions.update(submission.id, {
        status: 'completed',
        completedAt: Date.now(),
      })
    }
  },

  async markSubmissionFailed(idempotencyKey: string, errorMessage: string) {
    const submission = await db.submissions.where('idempotencyKey').equals(idempotencyKey).first()
    if (submission?.id) {
      const newRetryCount = submission.retryCount + 1
      await db.submissions.update(submission.id, {
        status: newRetryCount >= MAX_RETRY_COUNT ? 'failed' : 'pending',
        retryCount: newRetryCount,
        errorMessage,
      })
    }
  },

  async getPendingSubmissions(sessionId?: string): Promise<PendingSubmission[]> {
    let query = db.submissions.where('status').equals('pending')

    const submissions = await query.toArray()

    if (sessionId) {
      return submissions.filter((s) => s.sessionId === sessionId)
    }

    return submissions
  },

  async syncPendingSubmissions(
    onSubmit: (sessionId: string, stageId: string, data: Record<string, unknown>) => Promise<unknown>
  ): Promise<{ success: number; failed: number }> {
    const pending = await this.getPendingSubmissions()
    let success = 0
    let failed = 0

    // Sort by timestamp to maintain order
    pending.sort((a, b) => a.timestamp - b.timestamp)

    for (const submission of pending) {
      // Exponential backoff based on retry count
      if (submission.retryCount > 0) {
        const delay = RETRY_DELAY_BASE_MS * Math.pow(2, submission.retryCount - 1)
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 30000)))
      }

      await this.markSubmissionSyncing(submission.idempotencyKey)

      try {
        await onSubmit(submission.sessionId, submission.stageId, submission.data)
        await this.markSubmissionCompleted(submission.idempotencyKey)
        success++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        await this.markSubmissionFailed(submission.idempotencyKey, errorMessage)
        failed++

        // If this submission failed, don't continue with subsequent stages
        // as they may depend on this one
        if (submission.retryCount >= MAX_RETRY_COUNT) {
          console.error(
            `[EventQueue] Submission permanently failed for stage ${submission.stageId}:`,
            errorMessage
          )
        }
        break
      }
    }

    // Cleanup old completed submissions (keep last 24 hours)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    await db.submissions.where('completedAt').below(cutoff).delete()

    return { success, failed }
  },

  async hasPendingSubmissions(sessionId?: string): Promise<boolean> {
    const pending = await this.getPendingSubmissions(sessionId)
    return pending.length > 0
  },

  async getSubmissionStatus(sessionId: string): Promise<{
    pending: number
    failed: number
    lastError?: string
  }> {
    const allSubmissions = await db.submissions.where('sessionId').equals(sessionId).toArray()

    const pending = allSubmissions.filter(
      (s) => s.status === 'pending' || s.status === 'syncing'
    ).length
    const failedSubmissions = allSubmissions.filter((s) => s.status === 'failed')
    const lastError = failedSubmissions[failedSubmissions.length - 1]?.errorMessage

    return {
      pending,
      failed: failedSubmissions.length,
      lastError,
    }
  },

  /**
   * Clear all data for a specific session (used for preview mode reset)
   */
  async clearSessionData(sessionId: string): Promise<void> {
    await db.events.where('sessionId').equals(sessionId).delete()
    await db.submissions.where('sessionId').equals(sessionId).delete()
  },

  /**
   * Clear all data from the database (full reset)
   */
  async clearAllData(): Promise<void> {
    await db.events.clear()
    await db.submissions.clear()
  },
}

// Sync events on page load if online
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    if (navigator.onLine) {
      eventQueue.syncEvents()
    }
  })

  // Sync when coming back online
  window.addEventListener('online', () => {
    eventQueue.syncEvents()
  })
}

export default eventQueue

