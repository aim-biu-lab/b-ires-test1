"""
External Task models for external web application integration
"""
from datetime import datetime
from typing import Optional, Dict, Any, List
from enum import Enum
from pydantic import BaseModel, Field


class ExternalTaskStatus(str, Enum):
    """External task status"""
    PENDING = "pending"           # Task created, waiting for external app to connect
    STARTED = "started"           # External app connected and ready
    IN_PROGRESS = "in_progress"   # Task is being performed
    COMPLETED = "completed"       # Task completed successfully
    FAILED = "failed"             # Task failed
    EXPIRED = "expired"           # Task token expired
    CANCELLED = "cancelled"       # Task cancelled by user/system


class ExternalTaskCompletionMode(str, Enum):
    """How task completion is determined"""
    REQUIRED = "required"         # Must wait for external app to signal completion
    OPTIONAL = "optional"         # User can continue without completion
    MANUAL = "manual"             # User clicks "Mark as Done" button


class ExternalTaskTimeoutAction(str, Enum):
    """What happens when task times out"""
    PROMPT = "prompt"             # Show dialog with options
    SKIP = "skip"                 # Auto-skip if stage not mandatory
    RETRY = "retry"               # Auto-restart the task
    FAIL = "fail"                 # Mark as failed and block progress


class ExternalTaskWindowMode(str, Enum):
    """How to open the external task window"""
    POPUP = "popup"               # Sized popup window
    FULLSCREEN = "fullscreen"     # Full monitor size
    TAB = "tab"                   # New browser tab


# =============================================================================
# WebSocket Message Types
# =============================================================================

class WSMessageType(str, Enum):
    """WebSocket message types for external task communication"""
    # From external app to platform
    READY = "ready"                       # External app is ready
    LOG = "log"                           # Log event
    PROGRESS = "progress"                 # Progress update
    COMPLETE = "complete"                 # Task completed
    COMMAND_ACK = "command_ack"           # Command acknowledgment
    CLOSE_WINDOW_REQUEST = "close_window_request"  # Request parent to close popup window
    
    # From platform to external app
    INIT = "init"                         # Initialize with config
    COMMAND = "command"                   # Send command to external app
    
    # Internal notifications (platform to shell)
    EXTERNAL_APP_CONNECTED = "external_app_connected"
    EXTERNAL_APP_DISCONNECTED = "external_app_disconnected"
    TASK_COMPLETED = "task_completed"
    PROGRESS_UPDATE = "progress_update"
    ERROR = "error"


class WSMessage(BaseModel):
    """Base WebSocket message"""
    type: str
    payload: Optional[Dict[str, Any]] = None
    timestamp: Optional[datetime] = None


class WSReadyMessage(BaseModel):
    """External app ready message"""
    type: str = WSMessageType.READY.value


class WSLogMessage(BaseModel):
    """Log event message from external app"""
    type: str = WSMessageType.LOG.value
    payload: Dict[str, Any]  # { event_type: str, data: dict }


class WSProgressMessage(BaseModel):
    """Progress update from external app"""
    type: str = WSMessageType.PROGRESS.value
    payload: Dict[str, Any]  # { progress: int (0-100), step: str|null }


class WSCompleteMessage(BaseModel):
    """Task completion message from external app"""
    type: str = WSMessageType.COMPLETE.value
    payload: Dict[str, Any]  # { data: dict }


class WSCommandMessage(BaseModel):
    """Command from platform to external app"""
    type: str = WSMessageType.COMMAND.value
    payload: Dict[str, Any]  # { command: str, ...data }


class WSCommandAckMessage(BaseModel):
    """Command acknowledgment from external app"""
    type: str = WSMessageType.COMMAND_ACK.value
    payload: Dict[str, Any]  # { command: str, success: bool }


class WSInitMessage(BaseModel):
    """Init config sent to external app on connection"""
    type: str = WSMessageType.INIT.value
    payload: Dict[str, Any]  # { session_id, stage_id, config, participant_number }


# =============================================================================
# REST API Models
# =============================================================================

class ExternalTaskConfig(BaseModel):
    """Configuration for external task stage from YAML"""
    # Button configuration
    button_text: str = "Open Task"
    button_open_text: str = "Task Opened"
    reopen_button_text: str = "Reopen Task"
    
    # Completion behavior
    completion_mode: ExternalTaskCompletionMode = ExternalTaskCompletionMode.REQUIRED
    
    # Timeout configuration
    timeout_ms: int = 0  # 0 = no timeout
    timeout_action: ExternalTaskTimeoutAction = ExternalTaskTimeoutAction.PROMPT
    allow_retry_on_timeout: bool = True
    max_retries: int = 3  # 0 = unlimited
    
    # Window management
    try_close_on_complete: bool = True
    window_mode: ExternalTaskWindowMode = ExternalTaskWindowMode.POPUP
    window_width: int = 1200
    window_height: int = 800
    
    # UI messages
    waiting_message: str = "Waiting for task completion..."
    completed_message: str = "Task completed successfully!"
    timeout_message: str = "Task timed out. Would you like to try again?"
    ready_text: str = "Ready to start"
    ready_description: Optional[str] = None
    
    # Block layout
    block_width: str = "40%"
    
    # URL parameters
    pass_session_id: bool = True
    pass_stage_id: bool = True
    custom_params: Optional[Dict[str, str]] = None
    
    # Reverse control
    enable_reverse_control: bool = False
    reverse_commands: Optional[List[str]] = None


class ExternalTaskInitRequest(BaseModel):
    """Request to initialize an external task"""
    stage_id: str
    target_url: str
    config: Optional[Dict[str, Any]] = None


class ExternalTaskInitResponse(BaseModel):
    """Response with task token and WebSocket URL"""
    task_token: str
    target_url: str  # URL with task_token appended
    ws_url: str      # WebSocket URL for real-time communication


class ExternalTaskStatusResponse(BaseModel):
    """Response with current task status"""
    task_token: str
    status: ExternalTaskStatus
    progress: int = 0
    current_step: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    retry_count: int = 0
    external_app_connected: bool = False


class ExternalTaskInDB(BaseModel):
    """External task as stored in database/Redis"""
    id: str = Field(..., alias="_id")
    task_token: str
    session_id: str
    experiment_id: str
    stage_id: str
    user_id: str
    participant_number: int
    target_url: str
    config: Dict[str, Any]
    status: ExternalTaskStatus
    progress: int = 0
    current_step: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    retry_count: int = 0
    shell_connected: bool = False
    external_app_connected: bool = False
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    
    class Config:
        populate_by_name = True


# =============================================================================
# Command Types
# =============================================================================

class ExternalTaskCommand(str, Enum):
    """Commands that can be sent to external app"""
    RESTART = "restart"
    CLOSE = "close"
    PAUSE = "pause"
    RESUME = "resume"
    CUSTOM = "custom"


class SendCommandRequest(BaseModel):
    """Request to send a command to external app"""
    command: ExternalTaskCommand
    action: Optional[str] = None  # For custom commands
    data: Optional[Dict[str, Any]] = None



