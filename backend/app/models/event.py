"""
Event/logging models for telemetry
"""
from datetime import datetime
from typing import Optional, Dict, Any, List
from enum import Enum
from pydantic import BaseModel, Field


class EventType(str, Enum):
    """Event types for logging"""
    # Navigation events
    SESSION_START = "session_start"
    SESSION_END = "session_end"
    STAGE_VIEW = "stage_view"
    STAGE_SUBMIT = "stage_submit"
    STAGE_SKIP = "stage_skip"
    STAGE_JUMP = "stage_jump"
    
    # Interaction events
    CLICK = "click"
    INPUT = "input"
    FOCUS = "focus"
    BLUR = "blur"
    SCROLL = "scroll"
    
    # Media events
    VIDEO_PLAY = "video_play"
    VIDEO_PAUSE = "video_pause"
    VIDEO_SEEK = "video_seek"
    VIDEO_ENDED = "video_ended"
    VIDEO_PROGRESS = "video_progress"
    VIDEO_FULLSCREEN_ENTER = "video_fullscreen_enter"
    VIDEO_FULLSCREEN_EXIT = "video_fullscreen_exit"
    YOUTUBE_VIDEO_LOADED = "youtube_video_loaded"
    
    # Iframe events
    IFRAME_LOADED = "iframe_loaded"
    IFRAME_READY = "iframe_ready"
    IFRAME_COMPLETE = "iframe_complete"
    IFRAME_PROGRESS = "iframe_progress"
    IFRAME_TIMEOUT = "iframe_timeout"
    IFRAME_CUSTOM = "iframe_custom"
    IFRAME_USING_PROXY = "iframe_using_proxy"
    IFRAME_PROXY_FALLBACK = "iframe_proxy_fallback"
    IFRAME_BLOCKED = "iframe_blocked"
    
    # Attention check events
    ATTENTION_CHECK_ATTEMPT = "attention_check_attempt"
    ATTENTION_CHECK_PASSED = "attention_check_passed"
    ATTENTION_CHECK_FAILED = "attention_check_failed"
    
    # Multiple choice events
    MULTIPLE_CHOICE_SELECT = "multiple_choice_select"
    MULTIPLE_CHOICE_DESELECT = "multiple_choice_deselect"
    MULTIPLE_CHOICE_FREE_TEXT = "multiple_choice_free_text"
    MULTIPLE_CHOICE_SUBMIT = "multiple_choice_submit"
    
    # External task events
    EXTERNAL_TASK_INIT = "external_task_init"
    EXTERNAL_TASK_WINDOW_OPENED = "external_task_window_opened"
    EXTERNAL_TASK_WINDOW_CLOSED = "external_task_window_closed"
    EXTERNAL_TASK_WINDOW_CLOSED_ON_COMPLETE = "external_task_window_closed_on_complete"
    EXTERNAL_TASK_WINDOW_CLOSED_VIA_WEBSOCKET = "external_task_window_closed_via_websocket"
    EXTERNAL_TASK_WINDOW_CLOSED_VIA_POSTMESSAGE = "external_task_window_closed_via_postmessage"
    EXTERNAL_TASK_CLOSE_WINDOW_REQUEST = "external_task_close_window_request"
    EXTERNAL_TASK_APP_CONNECTED = "external_task_app_connected"
    EXTERNAL_TASK_APP_DISCONNECTED = "external_task_app_disconnected"
    EXTERNAL_TASK_READY = "external_task_ready"
    EXTERNAL_TASK_PROGRESS = "external_task_progress"
    EXTERNAL_TASK_COMPLETE = "external_task_complete"
    EXTERNAL_TASK_TIMEOUT = "external_task_timeout"
    EXTERNAL_TASK_RETRY = "external_task_retry"
    EXTERNAL_TASK_COMMAND_SENT = "external_task_command_sent"
    EXTERNAL_TASK_COMMAND_ACK = "external_task_command_ack"
    EXTERNAL_TASK_LOG = "external_task_log"
    EXTERNAL_TASK_MANUAL_COMPLETE = "external_task_manual_complete"
    
    # System events
    ERROR = "error"
    TIMEOUT = "timeout"
    OFFLINE = "offline"
    ONLINE = "online"
    SYNC = "sync"
    
    # Custom events
    CUSTOM = "custom"


class EventMetadata(BaseModel):
    """Event metadata"""
    user_agent: Optional[str] = None
    screen_size: Optional[str] = None
    referrer: Optional[str] = None
    url_params: Optional[Dict[str, str]] = None
    viewport_size: Optional[str] = None
    device_type: Optional[str] = None


class EventBase(BaseModel):
    """Base event model"""
    event_type: EventType
    stage_id: str
    block_id: Optional[str] = None
    payload: Dict[str, Any] = {}
    timestamp: Optional[datetime] = None  # Client timestamp


class EventCreate(EventBase):
    """Event creation request"""
    idempotency_key: str
    session_id: str
    metadata: Optional[EventMetadata] = None


class EventBatch(BaseModel):
    """Batch of events for offline sync"""
    session_id: str
    events: List[EventCreate]


class EventInDB(BaseModel):
    """Event as stored in database"""
    id: str = Field(..., alias="_id")
    event_id: str
    idempotency_key: str
    session_id: str
    experiment_id: str
    user_id: str
    participant_number: int = 0  # Human-readable participant number
    participant_label: Optional[str] = None  # Custom label set by admin
    event_type: EventType
    stage_id: str
    block_id: Optional[str] = None
    payload: Dict[str, Any]
    metadata: Dict[str, Any]
    client_timestamp: datetime
    server_timestamp: datetime
    
    class Config:
        populate_by_name = True


class EventResponse(BaseModel):
    """Event response"""
    event_id: str
    status: str  # "accepted", "duplicate_accepted"


class EventBatchResponse(BaseModel):
    """Batch event response"""
    accepted: int
    duplicates: int
    failed: int
    session_state: Optional[Dict[str, Any]] = None  # Authoritative state for reconciliation


class EventQuery(BaseModel):
    """Query parameters for event retrieval"""
    experiment_id: Optional[str] = None
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    stage_id: Optional[str] = None
    event_types: Optional[List[EventType]] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    limit: int = 1000
    offset: int = 0

