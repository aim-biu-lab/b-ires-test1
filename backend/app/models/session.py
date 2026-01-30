"""
Session models for experiment participants

Supports:
- Flat stage navigation (legacy)
- 4-level hierarchical navigation (Phase > Stage > Block > Task)
- Assignment persistence for balanced/weighted distribution
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum
from pydantic import BaseModel, Field


class SessionStatus(str, Enum):
    """Session status"""
    ACTIVE = "active"
    COMPLETED = "completed"
    ABANDONED = "abandoned"
    TIMED_OUT = "timed_out"


class StageStatus(str, Enum):
    """Individual stage status"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    INVALIDATED = "invalidated"


class HierarchyPath(BaseModel):
    """Current position in the 4-level hierarchy"""
    phase_id: Optional[str] = None
    stage_id: Optional[str] = None
    block_id: Optional[str] = None
    task_id: Optional[str] = None
    
    def to_flat_id(self) -> str:
        """Get the most specific ID (for backward compatibility)"""
        return self.task_id or self.block_id or self.stage_id or self.phase_id or ""
    
    def to_path_string(self) -> str:
        """Get full path as string (e.g., 'phase.stage.block.task')"""
        parts = [p for p in [self.phase_id, self.stage_id, self.block_id, self.task_id] if p]
        return ".".join(parts)


class AssignmentRecord(BaseModel):
    """Record of a balanced/weighted assignment"""
    level_id: str  # The parent level where assignment was made
    assigned_child_id: str  # The child that was assigned
    ordering_mode: str  # 'balanced', 'weighted', 'latin_square'
    timestamp: datetime
    reason: Optional[str] = None  # Human-readable explanation


class StageProgress(BaseModel):
    """Progress information for a stage/task"""
    stage_id: str
    status: StageStatus
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    substep_index: int = 0
    data: Optional[Dict[str, Any]] = None
    
    # Hierarchy context (optional, for 4-level structure)
    phase_id: Optional[str] = None
    block_id: Optional[str] = None
    task_id: Optional[str] = None


class HierarchyProgress(BaseModel):
    """Progress information for hierarchical navigation"""
    phase_progress: Dict[str, StageStatus] = {}
    stage_progress: Dict[str, StageStatus] = {}
    block_progress: Dict[str, StageStatus] = {}
    task_progress: Dict[str, StageStatus] = {}


class SessionState(BaseModel):
    """Session state - synced with Redis"""
    session_id: str
    experiment_id: str
    user_id: str
    
    # Current position (flat for backward compatibility)
    current_stage_id: str
    current_substep_index: int = 0
    
    # Hierarchical position (new 4-level structure)
    current_path: Optional[HierarchyPath] = None
    
    # Progress tracking
    stage_progress: Dict[str, StageProgress]
    hierarchy_progress: Optional[HierarchyProgress] = None
    visible_stages: List[str]
    completed_stages: List[str]
    
    # Hierarchical completion tracking (for navigation locks)
    completed_phases: List[str] = []  # Phase IDs that are fully completed
    completed_blocks: Dict[str, List[str]] = {}  # stage_id -> list of completed block IDs
    
    # Locked items (computed from allow_jump_to_completed settings)
    locked_items: Dict[str, List[str]] = {}  # {phases: [], stages: [], blocks: [], tasks: []}
    
    # Assignments for balanced/weighted distribution (persisted)
    assignments: Dict[str, str] = {}  # level_id -> assigned_child_id
    assignment_history: List[AssignmentRecord] = []
    
    # Randomization
    randomization_seed: Optional[int] = None
    
    # Offline support
    is_offline: bool = False


class SessionBase(BaseModel):
    """Base session model"""
    experiment_id: str
    user_id: str


class SessionCreate(BaseModel):
    """Session creation request"""
    experiment_id: str
    url_params: Optional[Dict[str, str]] = None
    user_agent: Optional[str] = None
    screen_size: Optional[str] = None


class SessionInDB(BaseModel):
    """Session as stored in database"""
    id: str = Field(..., alias="_id")
    session_id: str
    experiment_id: str
    user_id: str
    participant_number: int  # Auto-incremented per experiment (1, 2, 3...)
    participant_label: Optional[str] = None  # Optional custom label set by admin
    status: SessionStatus
    
    # Current position (flat)
    current_stage_id: str
    current_substep_index: int = 0
    
    # Hierarchical position (4-level structure)
    current_phase_id: Optional[str] = None
    current_block_id: Optional[str] = None
    current_task_id: Optional[str] = None
    
    # Progress tracking
    stage_progress: Dict[str, Dict[str, Any]]
    hierarchy_progress: Optional[Dict[str, Any]] = None
    visible_stages: List[str]
    completed_stages: List[str]
    
    # Hierarchical completion tracking (for navigation locks)
    completed_phases: List[str] = []  # Phase IDs that are fully completed
    completed_blocks: Dict[str, List[str]] = {}  # stage_id -> list of completed block IDs
    
    # Locked items (items participant cannot return to)
    locked_items: Dict[str, List[str]] = {}  # {phases: [], stages: [], blocks: [], tasks: []}
    
    # Assignments for distribution (persisted for recovery)
    assignments: Dict[str, str] = {}  # level_id -> assigned_child_id
    assignment_history: List[Dict[str, Any]] = []
    
    # Randomization seed for reproducible shuffling
    randomization_seed: Optional[int] = None
    
    data: Dict[str, Any]  # All collected data
    metadata: Dict[str, Any]  # Browser info, URL params, etc.
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    
    class Config:
        populate_by_name = True


class SessionResponse(BaseModel):
    """Session response for client"""
    session_id: str
    experiment_id: str
    current_stage_id: str
    current_substep_index: int
    visible_stages: List[Dict[str, Any]]  # Filtered stage configs
    completed_stage_ids: List[str]
    progress: Dict[str, Any]  # current, total, percentage
    status: SessionStatus


class SessionStartResponse(BaseModel):
    """Response when starting a new session"""
    session_id: str
    experiment_id: str
    current_stage: Dict[str, Any]
    visible_stages: List[Dict[str, Any]]
    progress: Dict[str, Any]
    shell_config: Optional[Dict[str, Any]] = None  # Shell appearance/behavior config
    debug_mode: bool = False  # Whether debug features are enabled for this experiment


class StageSubmission(BaseModel):
    """Stage data submission"""
    stage_id: str
    data: Dict[str, Any]
    substep_index: Optional[int] = None


class LockedItems(BaseModel):
    """Locked items that participant cannot return to"""
    phases: List[str] = []
    stages: List[str] = []
    blocks: List[str] = []
    tasks: List[str] = []


class StageSubmitResponse(BaseModel):
    """Response after submitting stage data"""
    session_id: str
    next_stage: Optional[Dict[str, Any]]
    visible_stages: List[Dict[str, Any]]
    completed_stage_ids: List[str]
    progress: Dict[str, Any]
    is_complete: bool = False
    locked_items: Optional[LockedItems] = None  # Items that cannot be returned to


class JumpRequest(BaseModel):
    """Request to jump to a different stage"""
    target_stage_id: str


class JumpResponse(BaseModel):
    """Response for jump request"""
    session_id: str
    current_stage: Dict[str, Any]
    return_stage_id: Optional[str] = None  # Where to return after viewing reference (can be None)
    is_reference: bool
    invalidated_stages: Optional[List[str]] = None  # Stages that were invalidated
    locked_items: Optional[LockedItems] = None  # Items that cannot be returned to


class SessionRecoveryResponse(BaseModel):
    """Response when recovering a session"""
    session_id: str
    status: SessionStatus
    current_stage: Optional[Dict[str, Any]] = None
    visible_stages: List[Dict[str, Any]] = []
    completed_stage_ids: List[str] = []
    progress: Dict[str, Any] = {}
    data: Dict[str, Any] = {}  # Previously entered data
    shell_config: Optional[Dict[str, Any]] = None  # Shell appearance/behavior config
    locked_items: Optional[LockedItems] = None  # Items that cannot be returned to
    debug_mode: bool = False  # Whether debug features are enabled for this experiment


# Admin/Monitoring models
class SessionListItem(BaseModel):
    """Session item for admin list view"""
    session_id: str
    experiment_id: str
    experiment_name: Optional[str] = None
    user_id: str
    participant_number: int  # Human-readable participant number (P1, P2...)
    participant_label: Optional[str] = None  # Custom label set by admin
    status: SessionStatus
    current_stage_id: str
    current_stage_label: Optional[str] = None
    completed_stages_count: int
    total_stages_count: int
    progress_percentage: float
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None


class SessionListResponse(BaseModel):
    """Paginated session list response"""
    sessions: List[SessionListItem]
    total: int
    page: int
    page_size: int
    has_more: bool


class SessionStats(BaseModel):
    """Statistics about sessions"""
    total_sessions: int
    active_sessions: int
    completed_sessions: int
    abandoned_sessions: int
    completion_rate: float
    avg_completion_time_seconds: Optional[float] = None


class ExperimentSessionStats(BaseModel):
    """Session statistics for a specific experiment"""
    experiment_id: str
    experiment_name: str
    stats: SessionStats
    stage_completion_rates: Dict[str, float]
    recent_sessions: List[SessionListItem]


class DailySessionData(BaseModel):
    """Session count data for a single day"""
    date: str  # Format: "Jan 15" or similar short format
    date_full: str  # Format: "2026-01-15" ISO date
    sessions: int
    completed: int
    abandoned: int


class SessionsOverTimeResponse(BaseModel):
    """Response for sessions over time endpoint"""
    data: List[DailySessionData]
    period_days: int

