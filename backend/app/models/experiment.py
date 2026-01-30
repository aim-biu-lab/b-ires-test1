"""
Experiment configuration models

Supports a 4-level hierarchy:
  Phase > Stage > Block > Task

Each level can have its own rules for ordering, visibility, and distribution.
"""
from datetime import datetime
from typing import Optional, List, Dict, Any, Union
from enum import Enum
from pydantic import BaseModel, Field


class ExperimentStatus(str, Enum):
    """Experiment publication status"""
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class OrderingMode(str, Enum):
    """Ordering mode for children at any hierarchy level"""
    SEQUENTIAL = "sequential"      # Fixed order (1, 2, 3...)
    RANDOMIZED = "randomized"      # Seeded shuffle per participant
    BALANCED = "balanced"          # Least-filled algorithm for equal groups
    WEIGHTED = "weighted"          # Probability-based assignment
    LATIN_SQUARE = "latin_square"  # Order counterbalancing


class BalanceOn(str, Enum):
    """When to count for balanced distribution"""
    STARTED = "started"      # Count when participant enters
    COMPLETED = "completed"  # Count when participant finishes


class PickStrategy(str, Enum):
    """Strategy for picking X out of N children"""
    RANDOM = "random"                    # Pick X children randomly using participant's seed
    ROUND_ROBIN = "round_robin"          # Rotate through children groups across participants
    WEIGHTED_RANDOM = "weighted_random"  # Pick based on probability weights


class PickConditionOperator(str, Enum):
    """Operators for pick conditions"""
    NOT_IN = "not_in"  # Child's value must NOT be in accumulated values
    IN = "in"          # Child's value must BE in accumulated values
    NOT_EQUAL = "!="   # Alias for not_in
    EQUAL = "=="       # Alias for in


class StageType(str, Enum):
    """Available stage/block types"""
    USER_INFO = "user_info"
    QUESTIONNAIRE = "questionnaire"
    CONTENT_DISPLAY = "content_display"
    VIDEO_PLAYER = "video_player"
    IFRAME_SANDBOX = "iframe_sandbox"
    LIKERT_SCALE = "likert_scale"
    CONSENT_FORM = "consent_form"
    ATTENTION_CHECK = "attention_check"
    EXTERNAL_TASK = "external_task"
    MULTIPLE_CHOICE = "multiple_choice"
    PARTICIPANT_IDENTITY = "participant_identity"


class ContentType(str, Enum):
    """Content display types"""
    TEXT = "text"
    HTML = "html"
    FILE = "file"
    RICH_TEXT = "rich_text"


class CompletionTrigger(str, Enum):
    """Stage completion triggers"""
    MANUAL = "manual"
    MEDIA_ENDED = "media_ended"
    MEDIA_PAUSED = "media_paused"
    TIMER = "timer"
    MESSAGE = "message"


class TimeoutAction(str, Enum):
    """Actions when stage times out"""
    AUTO_SUBMIT = "auto_submit"
    SKIP_STAGE = "skip_stage"
    LOCK_INTERFACE = "lock_interface"
    PROMPT = "prompt"


class QuotaStrategy(str, Enum):
    """Quota handling strategy"""
    SKIP_IF_FULL = "skip_if_full"
    BLOCK = "block"
    REDIRECT = "redirect"


# ============================================================================
# Rules and Distribution Configuration (for 4-level hierarchy)
# ============================================================================

class WeightConfig(BaseModel):
    """Weight configuration for weighted distribution"""
    id: str  # Child ID to assign weight to
    value: int = 1  # Weight value (higher = more likely)


class PickCondition(BaseModel):
    """
    Condition for filtering children during pick operation.
    Compares child's pick_assigns value against accumulated pick_assignments.
    """
    variable: str  # Variable name to check in child's pick_assigns
    operator: PickConditionOperator = PickConditionOperator.NOT_IN  # Comparison operator


class RulesConfig(BaseModel):
    """
    Rules configuration for any hierarchy level.
    Controls ordering, visibility, and distribution of children.
    """
    ordering: OrderingMode = OrderingMode.SEQUENTIAL
    visibility: Optional[str] = None  # Expression for conditional display
    balance_on: BalanceOn = BalanceOn.STARTED  # When to count for balanced
    weights: Optional[List[WeightConfig]] = None  # For weighted distribution
    quota: Optional[int] = None  # Max participants for this branch
    metadata: Optional[Dict[str, Any]] = None  # Additional tags/info
    
    # Pick N children feature - show only a subset of children
    pick_count: Optional[int] = None  # Number of children to pick (None = show all)
    pick_strategy: PickStrategy = PickStrategy.RANDOM  # Strategy for picking children
    pick_weights: Optional[List[WeightConfig]] = None  # Weights for weighted_random strategy
    pick_conditions: Optional[List[PickCondition]] = None  # Conditions for filtering candidates


class UISettings(BaseModel):
    """UI settings for hierarchy levels"""
    visible_to_participant: bool = True  # Show in sidebar/progress
    show_in_sidebar: bool = True  # Explicitly control sidebar visibility
    label: Optional[str] = None  # Override label
    icon: Optional[str] = None  # Icon identifier
    collapsed_by_default: bool = False  # For expandable sections


# ============================================================================
# Stage configuration models (original structure preserved for compatibility)
# ============================================================================

class TimingConfig(BaseModel):
    """Stage timing configuration"""
    min_duration_ms: Optional[int] = None
    max_duration_ms: Optional[int] = None
    show_timer: bool = False
    show_elapsed_time: bool = False
    on_timeout: TimeoutAction = TimeoutAction.AUTO_SUBMIT


class QuotaConfig(BaseModel):
    """Stage quota configuration"""
    limit: int
    strategy: QuotaStrategy = QuotaStrategy.SKIP_IF_FULL
    fallback_stage: Optional[str] = None


class VideoConfig(BaseModel):
    """Video player configuration"""
    autoplay: bool = False
    controls: bool = True
    allow_seek: bool = True
    allow_pause: bool = True
    log_progress_interval_ms: int = 5000


class QuestionOption(BaseModel):
    """Question option for select/radio/checkbox"""
    value: str
    label: str


class LikertAnswerOption(BaseModel):
    """Likert scale answer option with label and score"""
    label: str   # Visible label (e.g., "Strongly Agree")
    score: int   # Hidden score value (e.g., 5)


class LikertStyleConfig(BaseModel):
    """Style configuration for likert scale"""
    option_gap: Optional[int] = None       # Gap between options in pixels (default: 8)
    margin_top: Optional[int] = None       # Margin from top of question block in pixels
    margin_bottom: Optional[int] = None    # Margin from bottom of options row in pixels
    option_padding: Optional[int] = None   # Padding inside each option in pixels


class QuestionConfig(BaseModel):
    """Question configuration"""
    id: str
    text: str
    type: str  # text, textarea, number, email, date, select, radio, checkbox, likert_scale
    required: bool = True
    options: Optional[List[QuestionOption]] = None
    validation: Optional[str] = None  # Regex pattern
    validation_message: Optional[str] = None
    min_value: Optional[float] = Field(None, alias="min")
    max_value: Optional[float] = Field(None, alias="max")
    range: Optional[List[int]] = None  # For likert scale [1, 7]
    visual_theme: Optional[str] = None
    # New likert scale options
    likert_options: Optional[List[LikertAnswerOption]] = None  # Custom answer options with labels/scores
    show_faces: Optional[bool] = None   # Toggle face images (default: true, disabled if >5 options)
    show_score: Optional[bool] = None   # Toggle numeric score display (default: false)
    style_config: Optional[LikertStyleConfig] = None  # Style configuration


class UserInfoField(BaseModel):
    """User info field configuration"""
    field: str
    label: str
    type: str
    required: bool = True
    options: Optional[List[QuestionOption]] = None
    validation: Optional[str] = None
    validation_message: Optional[str] = None
    min_value: Optional[int] = Field(None, alias="min")
    max_value: Optional[int] = Field(None, alias="max")


# ============================================================================
# Task Configuration (atomic unit - formerly the core of StageConfig)
# ============================================================================

class TaskConfig(BaseModel):
    """
    Task configuration - the atomic unit of experiment content.
    This is the leaf node in the 4-level hierarchy.
    """
    id: str
    type: StageType
    label: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    mandatory: bool = True
    
    # Rules (visibility, etc.)
    rules: Optional[RulesConfig] = None
    ui_settings: Optional[UISettings] = None
    
    # Pick assigns - variables assigned when this task is picked
    pick_assigns: Optional[Dict[str, Any]] = None
    
    # Visibility and navigation (legacy support)
    visibility_rule: Optional[str] = None
    editable_after_submit: bool = False
    invalidates_dependents: bool = True
    allow_jump_to_completed: bool = True  # Can return to this task after completion
    reference: bool = False
    reference_label: Optional[str] = None
    
    # Timing
    timing: Optional[TimingConfig] = None
    
    # Quota
    quota: Optional[QuotaConfig] = None
    
    # Content (for content_display)
    content_type: Optional[ContentType] = None
    content: Optional[str] = None
    content_file: Optional[str] = None
    content_asset_id: Optional[str] = None
    
    # Video configuration
    source: Optional[str] = None
    video_config: Optional[VideoConfig] = Field(None, alias="config")
    completion_trigger: Optional[CompletionTrigger] = None
    
    # Questionnaire
    questions: Optional[List[QuestionConfig]] = None
    
    # User info
    fields: Optional[List[UserInfoField]] = None
    
    # Likert scale
    range: Optional[List[int]] = None
    visual_theme: Optional[str] = None
    likert_options: Optional[List[LikertAnswerOption]] = None  # Custom answer options
    show_faces: Optional[bool] = None   # Toggle face images
    show_score: Optional[bool] = None   # Toggle numeric score display
    likert_style_config: Optional[LikertStyleConfig] = None  # Style configuration
    
    # External task
    target_url: Optional[str] = None


# ============================================================================
# Block Configuration (contains Tasks)
# ============================================================================

class BlockConfig(BaseModel):
    """
    Block configuration - groups related tasks together.
    Third level in the 4-level hierarchy (Phase > Stage > Block > Task).
    """
    id: str
    label: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    
    # Rules for this block's children
    rules: Optional[RulesConfig] = None
    ui_settings: Optional[UISettings] = None
    
    # Pick assigns - variables assigned when this block is picked
    pick_assigns: Optional[Dict[str, Any]] = None
    
    # Tasks within this block
    tasks: Optional[List[TaskConfig]] = None
    
    # Legacy support: can also have direct type for single-task blocks
    type: Optional[StageType] = None
    mandatory: bool = True
    visibility_rule: Optional[str] = None
    allow_jump_to_completed: bool = True  # Can return to tasks in this block after block completes
    timing: Optional[TimingConfig] = None
    quota: Optional[QuotaConfig] = None
    
    # Task-specific fields for single-task blocks (legacy support)
    content_type: Optional[ContentType] = None
    content: Optional[str] = None
    source: Optional[str] = None
    video_config: Optional[VideoConfig] = Field(None, alias="config")
    completion_trigger: Optional[CompletionTrigger] = None
    questions: Optional[List[QuestionConfig]] = None
    fields: Optional[List[UserInfoField]] = None
    range: Optional[List[int]] = None
    # Likert scale extended options for blocks
    likert_options: Optional[List[LikertAnswerOption]] = None
    show_faces: Optional[bool] = None
    show_score: Optional[bool] = None
    likert_style_config: Optional[LikertStyleConfig] = None


# ============================================================================
# Stage Configuration (updated for 4-level hierarchy)
# ============================================================================

class StageConfig(BaseModel):
    """
    Stage configuration - second level in the hierarchy.
    Can contain blocks (new 4-level hierarchy) or be a direct task (legacy).
    """
    id: str
    type: Optional[StageType] = None  # Optional for container stages
    label: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    mandatory: bool = True
    
    # Rules for this stage's children
    rules: Optional[RulesConfig] = None
    ui_settings: Optional[UISettings] = None
    
    # Pick assigns - variables assigned when this stage is picked
    pick_assigns: Optional[Dict[str, Any]] = None
    
    # New hierarchy: blocks within this stage
    blocks: Optional[List[BlockConfig]] = None
    
    # Visibility and navigation
    visibility_rule: Optional[str] = None
    editable_after_submit: bool = False
    invalidates_dependents: bool = True
    allow_jump_to_completed: bool = True  # Can return to this stage after completion
    reference: bool = False
    reference_label: Optional[str] = None
    
    # Timing
    timing: Optional[TimingConfig] = None
    
    # Quota
    quota: Optional[QuotaConfig] = None
    
    # Content (for content_display - direct stage type)
    content_type: Optional[ContentType] = None
    content: Optional[str] = None
    content_file: Optional[str] = None
    content_asset_id: Optional[str] = None
    
    # Video configuration
    source: Optional[str] = None
    video_config: Optional[VideoConfig] = Field(None, alias="config")
    completion_trigger: Optional[CompletionTrigger] = None
    
    # Questionnaire
    questions: Optional[List[QuestionConfig]] = None
    
    # User info
    fields: Optional[List[UserInfoField]] = None
    
    # Likert scale
    range: Optional[List[int]] = None
    visual_theme: Optional[str] = None
    likert_options: Optional[List[LikertAnswerOption]] = None  # Custom answer options
    show_faces: Optional[bool] = None   # Toggle face images
    show_score: Optional[bool] = None   # Toggle numeric score display
    likert_style_config: Optional[LikertStyleConfig] = None  # Style configuration
    
    # External task
    target_url: Optional[str] = None
    
    # Legacy substages support (deprecated, use blocks instead)
    substages: Optional[List["StageConfig"]] = None


# ============================================================================
# Phase Configuration (top level of 4-level hierarchy)
# ============================================================================

class PhaseConfig(BaseModel):
    """
    Phase configuration - top level in the 4-level hierarchy.
    Groups related stages together (e.g., "Onboarding", "Main Task", "Debrief").
    """
    id: str
    label: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    allow_jump_to_completed: bool = True  # Can return to stages in this phase after phase completes
    
    # Rules for this phase's children (stages)
    rules: Optional[RulesConfig] = None
    ui_settings: Optional[UISettings] = None
    
    # Stages within this phase
    stages: List[StageConfig]


class ShellProgressConfig(BaseModel):
    """Progress display configuration"""
    show_in_title: bool = True
    title_format: str = "{{experiment_name}} - {{stage_label}} ({{current}}/{{total}})"
    show_progress_bar: bool = True
    progress_bar_position: str = "top"
    progress_bar_style: str = "continuous"
    show_percentage: bool = False
    show_counter: bool = True
    counter_position: str = "top-right"
    counter_format: str = "Question {{current}} of {{total}}"


class SidebarConfig(BaseModel):
    """Sidebar configuration"""
    enabled: bool = True
    position: str = "left"
    width: str = "280px"
    collapsed_on_mobile: bool = True
    show_completed_checkmarks: bool = True
    show_step_numbers: bool = True
    clickable_completed: bool = True
    highlight_current: bool = True
    show_substeps: bool = True


class NavigationLabels(BaseModel):
    """Navigation button labels"""
    next: str = "Continue"
    back: str = "Back"
    submit: str = "Submit"
    finish: str = "Complete Study"


class NavigationConfig(BaseModel):
    """Navigation configuration"""
    labels: NavigationLabels = NavigationLabels()
    allow_back: bool = True
    back_button_position: str = "left"
    allow_jump_to_completed: bool = True
    allow_jump_to_reference: bool = True
    return_to_current: bool = True
    jump_warning: bool = True


class KeyboardShortcutsConfig(BaseModel):
    """Keyboard shortcuts configuration"""
    enabled: bool = True
    next_key: str = Field("Enter", alias="next")
    back_key: str = Field("Backspace", alias="back")


class LayoutConfig(BaseModel):
    """Layout configuration"""
    max_width: str = "800px"
    content_alignment: str = "center"
    sidebar_position: str = "left"


class ResponsiveConfig(BaseModel):
    """Responsive design configuration"""
    mobile_optimized: bool = True
    collapse_sidebar_mobile: bool = True


class BrandingConfig(BaseModel):
    """Branding configuration"""
    logo: Optional[str] = None
    favicon: Optional[str] = None
    title_template: str = "{{experiment_name}} - {{current_stage}}"


class ShellConfig(BaseModel):
    """Experiment shell configuration"""
    theme: str = "clinical_blue"
    branding: Optional[BrandingConfig] = None
    layout: Optional[LayoutConfig] = None
    responsive: Optional[ResponsiveConfig] = None
    progress: Optional[ShellProgressConfig] = None
    sidebar: Optional[SidebarConfig] = None
    navigation: Optional[NavigationConfig] = None
    keyboard_shortcuts: Optional[KeyboardShortcutsConfig] = None


class ExperimentMeta(BaseModel):
    """Experiment metadata"""
    experiment_id: str = Field(..., alias="id")
    version: str = "1.0.0"
    name: str
    description: Optional[str] = None
    status: ExperimentStatus = ExperimentStatus.DRAFT
    extends: Optional[str] = None  # Template inheritance (only in draft)
    published_at: Optional[datetime] = None
    snapshot_id: Optional[str] = None
    debug_mode: bool = False  # Enable debug features for participants


class ExperimentConfig(BaseModel):
    """
    Complete experiment configuration.
    
    Supports both:
    - New 4-level hierarchy: phases > stages > blocks > tasks
    - Legacy flat structure: stages (for backward compatibility)
    """
    meta: ExperimentMeta
    shell_config: Optional[ShellConfig] = None
    
    # New 4-level hierarchy (preferred)
    phases: Optional[List[PhaseConfig]] = None
    
    # Legacy flat structure (for backward compatibility)
    stages: Optional[List[StageConfig]] = None
    
    public_variables: Optional[Dict[str, Any]] = None
    server_variables: Optional[Dict[str, Any]] = None
    
    def get_all_stages_flat(self) -> List[StageConfig]:
        """
        Get all stages as a flat list (for backward compatibility).
        Converts 4-level hierarchy to flat structure if needed.
        """
        if self.stages:
            return self.stages
        
        if self.phases:
            flat_stages = []
            for phase in self.phases:
                flat_stages.extend(phase.stages)
            return flat_stages
        
        return []
    
    def is_hierarchical(self) -> bool:
        """Check if experiment uses the new 4-level hierarchy"""
        return self.phases is not None and len(self.phases) > 0


class ExperimentInDB(BaseModel):
    """Experiment as stored in database"""
    id: str = Field(..., alias="_id")
    experiment_id: str
    version: str
    name: str
    description: Optional[str] = None
    status: ExperimentStatus
    owner_id: str
    config: Dict[str, Any]  # Full YAML config as dict
    config_yaml: str  # Original YAML string
    created_at: datetime
    updated_at: datetime
    published_at: Optional[datetime] = None
    
    class Config:
        populate_by_name = True


class ExperimentCreate(BaseModel):
    """Experiment creation request"""
    name: str
    description: Optional[str] = None
    config_yaml: str  # YAML configuration string


class ExperimentUpdate(BaseModel):
    """Experiment update request"""
    name: Optional[str] = None
    description: Optional[str] = None
    config_yaml: Optional[str] = None
    status: Optional[ExperimentStatus] = None


class ExperimentResponse(BaseModel):
    """Experiment response model"""
    id: str
    experiment_id: str
    version: str
    name: str
    description: Optional[str] = None
    status: ExperimentStatus
    owner_id: str
    config: Dict[str, Any]
    created_at: datetime
    updated_at: datetime
    published_at: Optional[datetime] = None


class ExperimentListResponse(BaseModel):
    """Experiment list item response"""
    id: str
    experiment_id: str
    version: str
    name: str
    description: Optional[str] = None
    status: ExperimentStatus
    owner_id: str
    created_at: datetime
    updated_at: datetime
    published_at: Optional[datetime] = None


# Allow recursive/forward references
TaskConfig.model_rebuild()
BlockConfig.model_rebuild()
StageConfig.model_rebuild()
PhaseConfig.model_rebuild()


class ExperimentVersion(BaseModel):
    """Saved version of experiment configuration"""
    id: str = Field(..., alias="_id")
    experiment_id: str
    version_name: str
    description: Optional[str] = None
    config: Dict[str, Any]
    config_yaml: str
    created_by: str
    created_at: datetime
    
    class Config:
        populate_by_name = True


class ExperimentVersionCreate(BaseModel):
    """Request to save a new version"""
    version_name: str
    description: Optional[str] = None


class ExperimentVersionResponse(BaseModel):
    """Version response model"""
    id: str
    experiment_id: str
    version_name: str
    description: Optional[str] = None
    created_by: str
    created_at: datetime


class ExperimentImport(BaseModel):
    """Request to import an experiment"""
    name: str
    description: Optional[str] = None
    config_yaml: str

