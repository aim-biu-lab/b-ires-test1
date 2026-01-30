"""
Session manager - Backend-authoritative state machine for experiment sessions

Supports:
- Legacy flat stage navigation
- 4-level hierarchical navigation (Phase > Stage > Block > Task)
- Balanced/weighted distribution with persistence
- Visibility rule evaluation with inheritance
"""
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
import json
import logging
import random

from app.core.redis_client import get_redis, RedisKeys
from app.services.dependency_graph import DependencyGraph
from app.services.visibility_engine import VisibilityEngine
from app.services.sequencer import Sequencer
from app.services.participant_registry import ParticipantRegistry
from app.models.experiment import OrderingMode, RulesConfig

logger = logging.getLogger(__name__)


class SessionManager:
    """
    Manages experiment session state.
    This is the SOURCE OF TRUTH - frontend never determines state transitions.
    
    Supports both:
    - Legacy flat structure: stages[]
    - 4-level hierarchy: phases[] > stages[] > blocks[] > tasks[]
    """
    
    def __init__(
        self,
        experiment_config: Dict[str, Any],
        db=None,
    ):
        self.config = experiment_config
        self.db = db
        
        # Check if using new hierarchical structure
        self.is_hierarchical = "phases" in experiment_config and experiment_config["phases"]
        
        # For legacy support
        self.stages = experiment_config.get("stages", [])
        if self.is_hierarchical:
            # Flatten phases to stages for backward compatibility
            self.stages = self._flatten_phases_to_stages(experiment_config.get("phases", []))
        
        # Build stage map (includes all levels for hierarchical)
        self.stage_map = {stage["id"]: stage for stage in self._flatten_stages(self.stages)}
        
        # Build full hierarchy map for hierarchical navigation
        if self.is_hierarchical:
            self.phases = experiment_config.get("phases", [])
            self.hierarchy_map = self._build_hierarchy_map()
        else:
            self.phases = []
            self.hierarchy_map = {}
        
        self.dependency_graph = DependencyGraph(experiment_config)
        self.visibility_engine = VisibilityEngine()
        self.sequencer = Sequencer(db) if db is not None else Sequencer()
        self.participant_registry = ParticipantRegistry(db) if db is not None else ParticipantRegistry()
    
    def _flatten_phases_to_stages(self, phases: List[Dict]) -> List[Dict]:
        """Convert phases to flat stage list for backward compatibility"""
        result = []
        for phase in phases:
            phase_stages = phase.get("stages", [])
            # Get phase ui_settings
            phase_ui_settings = phase.get("ui_settings", {})
            phase_collapsed_by_default = phase_ui_settings.get("collapsed_by_default", False)
            phase_show_in_sidebar = phase_ui_settings.get("show_in_sidebar", True)
            
            for stage in phase_stages:
                stage_copy = stage.copy()
                # Phase metadata
                stage_copy["_phase_id"] = phase.get("id")
                stage_copy["_phase_label"] = phase_ui_settings.get("label") or phase.get("label", phase.get("id"))
                stage_copy["_phase_collapsed_by_default"] = phase_collapsed_by_default
                stage_copy["_phase_show_in_sidebar"] = phase_show_in_sidebar
                result.append(stage_copy)
        return result
    
    def _build_hierarchy_map(self) -> Dict[str, Dict]:
        """Build a map of all hierarchy items by ID"""
        result = {}
        
        for phase in self.phases:
            phase_id = phase.get("id")
            result[phase_id] = {
                "type": "phase",
                "item": phase,
                "parent_id": None,
                "children": [s.get("id") for s in phase.get("stages", [])],
            }
            
            for stage in phase.get("stages", []):
                stage_id = stage.get("id")
                result[stage_id] = {
                    "type": "stage",
                    "item": stage,
                    "parent_id": phase_id,
                    "children": [],
                }
                
                # Check for blocks
                blocks = stage.get("blocks", [])
                if blocks:
                    result[stage_id]["children"] = [b.get("id") for b in blocks]
                    
                    for block in blocks:
                        block_id = block.get("id")
                        result[block_id] = {
                            "type": "block",
                            "item": block,
                            "parent_id": stage_id,
                            "children": [],
                        }
                        
                        # Check for tasks
                        tasks = block.get("tasks", [])
                        if tasks:
                            result[block_id]["children"] = [t.get("id") for t in tasks]
                            
                            for task in tasks:
                                task_id = task.get("id")
                                result[task_id] = {
                                    "type": "task",
                                    "item": task,
                                    "parent_id": block_id,
                                    "children": [],
                                }
        
        return result
    
    def _flatten_stages(self, stages: List[Dict], parent_id: str = None) -> List[Dict]:
        """Flatten nested stages into a single list"""
        result = []
        for stage in stages:
            stage_copy = stage.copy()
            stage_copy["parent_id"] = parent_id
            result.append(stage_copy)
            
            # Extract phase metadata to propagate to children
            phase_id = stage.get("_phase_id")
            phase_label = stage.get("_phase_label")
            phase_collapsed_by_default = stage.get("_phase_collapsed_by_default")
            phase_show_in_sidebar = stage.get("_phase_show_in_sidebar", True)
            
            # Extract stage metadata
            stage_id = stage.get("id")
            stage_ui_settings = stage.get("ui_settings", {})
            stage_label = stage_ui_settings.get("label") or stage.get("label", stage_id)
            stage_collapsed_by_default = stage_ui_settings.get("collapsed_by_default", False)
            stage_show_in_sidebar = stage_ui_settings.get("show_in_sidebar", True)
            
            # Handle substages (legacy)
            if "substages" in stage:
                result.extend(self._flatten_stages(stage["substages"], stage["id"]))
            
            # Handle blocks (new hierarchy)
            if "blocks" in stage:
                for block in stage["blocks"]:
                    block_copy = block.copy()
                    block_copy["parent_id"] = stage_id
                    
                    # Extract block metadata
                    block_id = block.get("id")
                    block_ui_settings = block.get("ui_settings", {})
                    block_label = block_ui_settings.get("label") or block.get("label", block_id)
                    block_collapsed_by_default = block_ui_settings.get("collapsed_by_default", False)
                    block_show_in_sidebar = block_ui_settings.get("show_in_sidebar", True)
                    
                    # Propagate all hierarchy metadata to blocks
                    block_copy["_phase_id"] = phase_id
                    block_copy["_phase_label"] = phase_label
                    block_copy["_phase_collapsed_by_default"] = phase_collapsed_by_default
                    block_copy["_phase_show_in_sidebar"] = phase_show_in_sidebar
                    block_copy["_stage_id"] = stage_id
                    block_copy["_stage_label"] = stage_label
                    block_copy["_stage_collapsed_by_default"] = stage_collapsed_by_default
                    block_copy["_stage_show_in_sidebar"] = stage_show_in_sidebar
                    
                    # If block has a type, it's a direct task-like block
                    if block.get("type"):
                        result.append(block_copy)
                    
                    # Handle tasks within block
                    if "tasks" in block:
                        for task in block["tasks"]:
                            task_copy = task.copy()
                            task_copy["parent_id"] = block_id
                            
                            # Propagate all hierarchy metadata to tasks
                            task_copy["_phase_id"] = phase_id
                            task_copy["_phase_label"] = phase_label
                            task_copy["_phase_collapsed_by_default"] = phase_collapsed_by_default
                            task_copy["_phase_show_in_sidebar"] = phase_show_in_sidebar
                            task_copy["_stage_id"] = stage_id
                            task_copy["_stage_label"] = stage_label
                            task_copy["_stage_collapsed_by_default"] = stage_collapsed_by_default
                            task_copy["_stage_show_in_sidebar"] = stage_show_in_sidebar
                            task_copy["_block_id"] = block_id
                            task_copy["_block_label"] = block_label
                            task_copy["_block_collapsed_by_default"] = block_collapsed_by_default
                            task_copy["_block_show_in_sidebar"] = block_show_in_sidebar
                            result.append(task_copy)
        
        return result
    
    async def initialize_session(
        self,
        session_id: str,
        user_id: str,
        url_params: Dict[str, str],
        user_agent: Optional[str] = None,
        screen_size: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Initialize a new session state"""
        # Generate randomization seed
        randomization_seed = random.randint(0, 2**31 - 1)
        
        # Initialize participant registry
        await self.participant_registry.initialize(
            session_id=session_id,
            experiment_id=self.config.get("meta", {}).get("id", "unknown"),
            user_id=user_id,
            url_params=url_params,
            user_agent=user_agent,
            screen_size=screen_size,
        )
        
        # Build initial context for visibility evaluation
        context = await self.participant_registry.build_visibility_context(session_id)
        context["user_id"] = user_id
        
        # For hierarchical experiments, compute the execution tree
        assignments = {}
        if self.is_hierarchical:
            visible_stage_ids, assignments = await self._compute_hierarchical_visible_items(
                session_id, context, randomization_seed
            )
        else:
            visible_stage_ids = self._compute_visible_stages(context)
        
        # Find first visible stage
        first_stage_id = visible_stage_ids[0] if visible_stage_ids else None
        
        # Initialize stage progress
        stage_progress = {}
        for stage_id in self.stage_map:
            stage_progress[stage_id] = {
                "status": "pending",
                "started_at": None,
                "completed_at": None,
                "substep_index": 0,
                "data": None,
            }
        
        if first_stage_id:
            stage_progress[first_stage_id]["status"] = "in_progress"
            stage_progress[first_stage_id]["started_at"] = datetime.utcnow().isoformat()
        
        # Build visible stages config (filtered for client)
        visible_stages = [
            self._filter_stage_for_client(self.stage_map[sid])
            for sid in visible_stage_ids
            if sid in self.stage_map
        ]
        
        return {
            "session_id": session_id,
            "current_stage_id": first_stage_id,
            "current_stage": self._filter_stage_for_client(self.stage_map.get(first_stage_id)) if first_stage_id else None,
            "stage_progress": stage_progress,
            "visible_stage_ids": visible_stage_ids,
            "visible_stages": visible_stages,
            "completed_stage_ids": [],
            "progress": self._compute_progress([], visible_stage_ids),
            "randomization_seed": randomization_seed,
            "assignments": assignments,
        }
    
    async def _compute_hierarchical_visible_items(
        self,
        session_id: str,
        context: Dict[str, Any],
        randomization_seed: int,
        existing_assignments: Optional[Dict[str, str]] = None,
    ) -> Tuple[List[str], Dict[str, str]]:
        """
        Compute visible items for hierarchical experiment.
        Handles pick N children, visibility rules, ordering, and balanced/weighted assignment.
        
        Processing order:
        1. Pick N children (if pick_count is set) - with pick_conditions filtering
        2. Apply visibility rules
        3. Apply ordering mode
        
        Returns:
            Tuple of (visible_stage_ids, assignments)
        """
        visible_ids = []
        assignments = existing_assignments or {}
        
        # Track accumulated pick_assignments for pick_conditions
        # Format: { "variable_name": [value1, value2, ...] }
        pick_assignments: Dict[str, List[Any]] = self._restore_pick_assignments(assignments)
        
        for phase in self.phases:
            phase_id = phase.get("id")
            phase_rules = phase.get("rules") or {}
            
            # Check phase visibility
            phase_rule = phase_rules.get("visibility") or phase.get("visibility_rule")
            if not self.visibility_engine.evaluate(phase_rule or "true", context):
                continue
            
            # Get stages for this phase
            stages = phase.get("stages", [])
            
            # Step 1: Apply pick_count if specified (before ordering)
            rules_config = self._dict_to_rules_config(phase_rules)
            if rules_config and rules_config.pick_count is not None:
                # Get existing picks from assignments
                existing_picks = self._get_picks_from_assignments(assignments, phase_id)
                
                picked_stages, picked_ids, pick_reason, new_assigns = await self.sequencer.pick_children(
                    children=[{"id": s.get("id"), **s} for s in stages],
                    rules=rules_config,
                    session_id=session_id,
                    level_id=phase_id,
                    existing_picks=existing_picks,
                    randomization_seed=randomization_seed,
                    pick_assignments=pick_assignments,
                )
                
                if picked_ids:
                    # Store picks in assignments with special prefix
                    assignments[f"{phase_id}_picks"] = ",".join(picked_ids)
                    logger.debug(f"Phase {phase_id} pick: {pick_reason}")
                
                # Accumulate new assignments
                if new_assigns:
                    self._accumulate_pick_assignments(pick_assignments, new_assigns)
                    self._store_pick_assignments(assignments, pick_assignments)
                
                stages = picked_stages
            
            # Step 2: Apply ordering
            ordering = phase_rules.get("ordering", "sequential")
            
            if ordering in ["balanced", "weighted", "latin_square"]:
                # Use sequencer for distribution
                ordered, assigned_id, reason = await self.sequencer.get_ordered_children(
                    children=[{"id": s.get("id"), **s} for s in stages],
                    rules=rules_config,
                    session_id=session_id,
                    level_id=phase_id,
                    existing_assignment=assignments.get(phase_id),
                    randomization_seed=randomization_seed,
                )
                if assigned_id:
                    assignments[phase_id] = assigned_id
                    await self.participant_registry.add_assignment(
                        session_id, phase_id, assigned_id, reason
                    )
                stages = ordered
            elif ordering == "randomized":
                ordered, _, _ = await self.sequencer.get_ordered_children(
                    children=[{"id": s.get("id"), **s} for s in stages],
                    rules=self._dict_to_rules_config({"ordering": "randomized"}),
                    session_id=session_id,
                    level_id=phase_id,
                    randomization_seed=randomization_seed,
                )
                stages = ordered
            
            # Step 3: Process each stage
            for stage in stages:
                stage_id = stage.get("id")
                stage_rules = stage.get("rules") or {}
                
                # Check stage visibility with inheritance from phase
                stage_rule = stage_rules.get("visibility") or stage.get("visibility_rule")
                if not self.visibility_engine.evaluate(stage_rule or "true", context, parent_visible=True):
                    continue
                
                # If stage has blocks, process them
                blocks = stage.get("blocks", [])
                if blocks:
                    # Get stage rules config for pick_count and ordering
                    stage_rules_config = self._dict_to_rules_config(stage_rules)
                    
                    # Step 1: Apply pick_count for stage's blocks if specified
                    if stage_rules_config and stage_rules_config.pick_count is not None:
                        existing_picks = self._get_picks_from_assignments(assignments, stage_id)
                        
                        picked_blocks, picked_ids, pick_reason, new_assigns = await self.sequencer.pick_children(
                            children=[{"id": b.get("id"), **b} for b in blocks],
                            rules=stage_rules_config,
                            session_id=session_id,
                            level_id=stage_id,
                            existing_picks=existing_picks,
                            randomization_seed=randomization_seed,
                            pick_assignments=pick_assignments,
                        )
                        
                        if picked_ids:
                            assignments[f"{stage_id}_picks"] = ",".join(picked_ids)
                            logger.debug(f"Stage {stage_id} block pick: {pick_reason}")
                        
                        # Accumulate new assignments
                        if new_assigns:
                            self._accumulate_pick_assignments(pick_assignments, new_assigns)
                            self._store_pick_assignments(assignments, pick_assignments)
                        
                        blocks = picked_blocks
                    
                    # Step 2: Apply ordering to blocks
                    # Note: For blocks, we want to ORDER all items, not SELECT one.
                    # balanced/weighted/latin_square should all return ALL blocks in a counterbalanced order.
                    ordering = stage_rules.get("ordering", "sequential")
                    
                    if ordering in ["balanced", "latin_square"]:
                        # Use latin_square to get counterbalanced ordering of ALL blocks
                        # "balanced" for ordering means counterbalanced order (same as latin_square)
                        latin_square_rules = self._dict_to_rules_config({"ordering": "latin_square"})
                        ordered, assigned_id, reason = await self.sequencer.get_ordered_children(
                            children=[{"id": b.get("id"), **b} for b in blocks],
                            rules=latin_square_rules,
                            session_id=session_id,
                            level_id=f"{stage_id}_blocks",
                            existing_assignment=assignments.get(f"{stage_id}_blocks"),
                            randomization_seed=randomization_seed,
                        )
                        if assigned_id:
                            assignments[f"{stage_id}_blocks"] = assigned_id
                            await self.participant_registry.add_assignment(
                                session_id, f"{stage_id}_blocks", assigned_id, reason
                            )
                        blocks = ordered
                    elif ordering == "weighted":
                        # Use weighted shuffle: order ALL blocks by weighted probability
                        # Higher weight = more likely to appear earlier
                        ordering_rules_config = stage_rules_config or self._dict_to_rules_config(stage_rules)
                        ordered, assigned_id, reason = await self.sequencer.get_weighted_order_all(
                            children=[{"id": b.get("id"), **b} for b in blocks],
                            rules=ordering_rules_config,
                            session_id=session_id,
                            level_id=f"{stage_id}_blocks",
                            existing_assignment=assignments.get(f"{stage_id}_blocks"),
                            randomization_seed=randomization_seed,
                        )
                        if assigned_id:
                            assignments[f"{stage_id}_blocks"] = assigned_id
                            await self.participant_registry.add_assignment(
                                session_id, f"{stage_id}_blocks", assigned_id, reason
                            )
                        blocks = ordered
                    elif ordering in ["randomized", "random"]:
                        # Support both "randomized" (official) and "random" (common alias)
                        ordered, _, _ = await self.sequencer.get_ordered_children(
                            children=[{"id": b.get("id"), **b} for b in blocks],
                            rules=self._dict_to_rules_config({"ordering": "randomized"}),
                            session_id=session_id,
                            level_id=f"{stage_id}_blocks",
                            randomization_seed=randomization_seed,
                        )
                        blocks = ordered
                    
                    # Process the (potentially picked and ordered) blocks
                    visible_ids.extend(await self._process_blocks(
                        blocks, stage_id, context, session_id, randomization_seed, assignments, pick_assignments
                    ))
                else:
                    # Direct stage (no blocks) - treat as leaf
                    if stage.get("type"):
                        visible_ids.append(stage_id)
        
        return visible_ids, assignments
    
    def _get_picks_from_assignments(self, assignments: Dict[str, str], level_id: str) -> Optional[List[str]]:
        """Get previously picked child IDs from assignments dict"""
        picks_key = f"{level_id}_picks"
        if picks_key in assignments:
            picks_str = assignments[picks_key]
            if picks_str:
                return picks_str.split(",")
        return None
    
    def _restore_pick_assignments(self, assignments: Dict[str, str]) -> Dict[str, List[Any]]:
        """Restore accumulated pick_assignments from assignments dict"""
        pick_assigns_key = "_pick_assignments"
        if pick_assigns_key in assignments:
            try:
                return json.loads(assignments[pick_assigns_key])
            except (json.JSONDecodeError, TypeError):
                pass
        return {}
    
    def _store_pick_assignments(self, assignments: Dict[str, str], pick_assignments: Dict[str, List[Any]]) -> None:
        """Store accumulated pick_assignments in assignments dict"""
        if pick_assignments:
            assignments["_pick_assignments"] = json.dumps(pick_assignments)
    
    def _accumulate_pick_assignments(
        self, 
        accumulated: Dict[str, List[Any]], 
        new_assigns: Dict[str, Any]
    ) -> None:
        """Accumulate new assignments into the accumulated dict (mutates accumulated)"""
        if not new_assigns:
            return
        
        for key, values in new_assigns.items():
            if key not in accumulated:
                accumulated[key] = []
            # new_assigns values are already lists from _collect_pick_assigns
            if isinstance(values, list):
                accumulated[key].extend(values)
            else:
                accumulated[key].append(values)
    
    async def _process_blocks(
        self,
        blocks: List[Dict],
        stage_id: str,
        context: Dict[str, Any],
        session_id: str,
        randomization_seed: int,
        assignments: Dict[str, str],
        pick_assignments: Optional[Dict[str, List[Any]]] = None,
    ) -> List[str]:
        """Process blocks within a stage, applying pick_count if configured"""
        visible_ids = []
        
        # Initialize pick_assignments if not provided
        if pick_assignments is None:
            pick_assignments = self._restore_pick_assignments(assignments)
        
        for block in blocks:
            block_id = block.get("id")
            block_rules = block.get("rules") or {}
            
            # Check block visibility
            block_rule = block_rules.get("visibility") or block.get("visibility_rule")
            if not self.visibility_engine.evaluate(block_rule or "true", context):
                continue
            
            # If block has tasks, process them with potential pick_count
            tasks = block.get("tasks", [])
            if tasks:
                # Apply pick_count if specified for block's tasks
                rules_config = self._dict_to_rules_config(block_rules)
                if rules_config and rules_config.pick_count is not None:
                    # Get existing picks
                    existing_picks = self._get_picks_from_assignments(assignments, block_id)
                    
                    picked_tasks, picked_ids, pick_reason, new_assigns = await self.sequencer.pick_children(
                        children=[{"id": t.get("id"), **t} for t in tasks],
                        rules=rules_config,
                        session_id=session_id,
                        level_id=block_id,
                        existing_picks=existing_picks,
                        randomization_seed=randomization_seed,
                        pick_assignments=pick_assignments,
                    )
                    
                    if picked_ids:
                        assignments[f"{block_id}_picks"] = ",".join(picked_ids)
                        logger.debug(f"Block {block_id} pick: {pick_reason}")
                    
                    # Accumulate new assignments
                    if new_assigns:
                        self._accumulate_pick_assignments(pick_assignments, new_assigns)
                        self._store_pick_assignments(assignments, pick_assignments)
                    
                    tasks = picked_tasks
                
                # Apply visibility rules to remaining tasks
                for task in tasks:
                    task_id = task.get("id")
                    task_rules = task.get("rules") or {}
                    task_rule = task_rules.get("visibility") or task.get("visibility_rule")
                    
                    if self.visibility_engine.evaluate(task_rule or "true", context):
                        visible_ids.append(task_id)
            else:
                # Block itself is the leaf (has a type)
                if block.get("type"):
                    visible_ids.append(block_id)
        
        return visible_ids
    
    def _dict_to_rules_config(self, rules_dict: Dict) -> Optional[RulesConfig]:
        """Convert dict to RulesConfig model"""
        if not rules_dict:
            return None
        
        try:
            from app.models.experiment import (
                OrderingMode, BalanceOn, WeightConfig, PickStrategy, 
                PickCondition, PickConditionOperator
            )
            
            ordering = rules_dict.get("ordering", "sequential")
            if isinstance(ordering, str):
                ordering = OrderingMode(ordering)
            
            balance_on = rules_dict.get("balance_on", "started")
            if isinstance(balance_on, str):
                balance_on = BalanceOn(balance_on)
            
            weights = None
            if rules_dict.get("weights"):
                weights = [
                    WeightConfig(id=w.get("id"), value=w.get("value", 1))
                    for w in rules_dict["weights"]
                ]
            
            # Pick strategy configuration
            pick_strategy = rules_dict.get("pick_strategy", "random")
            if isinstance(pick_strategy, str):
                pick_strategy = PickStrategy(pick_strategy)
            
            pick_weights = None
            if rules_dict.get("pick_weights"):
                pick_weights = [
                    WeightConfig(id=w.get("id"), value=w.get("value", 1))
                    for w in rules_dict["pick_weights"]
                ]
            
            # Pick conditions configuration
            pick_conditions = None
            if rules_dict.get("pick_conditions"):
                pick_conditions = []
                for cond in rules_dict["pick_conditions"]:
                    variable = cond.get("variable")
                    if not variable:
                        logger.warning(f"Skipping pick_condition with missing variable: {cond}")
                        continue
                    operator = cond.get("operator", "not_in")
                    if isinstance(operator, str):
                        try:
                            operator = PickConditionOperator(operator)
                        except ValueError:
                            logger.warning(f"Invalid pick_condition operator '{operator}', using 'not_in'")
                            operator = PickConditionOperator.NOT_IN
                    pick_conditions.append(PickCondition(
                        variable=variable,
                        operator=operator,
                    ))
            
            return RulesConfig(
                ordering=ordering,
                visibility=rules_dict.get("visibility"),
                balance_on=balance_on,
                weights=weights,
                quota=rules_dict.get("quota"),
                metadata=rules_dict.get("metadata"),
                pick_count=rules_dict.get("pick_count"),
                pick_strategy=pick_strategy,
                pick_weights=pick_weights,
                pick_conditions=pick_conditions,
            )
        except Exception as e:
            logger.warning(f"Error converting rules dict: {e}")
            return None
    
    async def submit_stage(
        self,
        session_id: str,
        session_data: Dict[str, Any],
        stage_id: str,
        data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Process stage submission and return next state.
        Validates data, updates state, computes next stage.
        """
        stage_config = self.stage_map.get(stage_id)
        if not stage_config:
            raise ValueError(f"Unknown stage: {stage_id}")
        
        # Validate submission data
        validation_errors = self._validate_stage_data(stage_config, data)
        if validation_errors:
            raise ValueError(f"Validation failed: {validation_errors}")
        
        # Update stage progress
        stage_progress = session_data.get("stage_progress", {})
        now = datetime.utcnow().isoformat()
        
        stage_progress[stage_id] = {
            "status": "completed",
            "started_at": stage_progress.get(stage_id, {}).get("started_at", now),
            "completed_at": now,
            "substep_index": 0,
            "data": data,
        }
        
        # Update completed stages
        completed_stages = list(session_data.get("completed_stages", []))
        if stage_id not in completed_stages:
            completed_stages.append(stage_id)
        
        # Update participant registry with response
        await self.participant_registry.add_response(session_id, stage_id, data)
        
        # Build context for visibility evaluation
        context = await self.participant_registry.build_visibility_context(session_id)
        context["user_id"] = session_data.get("user_id")
        
        # Get existing assignments
        assignments = session_data.get("assignments", {})
        randomization_seed = session_data.get("randomization_seed")
        
        # Recompute visible stages (needed for completion checks with pick_count)
        if self.is_hierarchical:
            visible_stage_ids, assignments = await self._compute_hierarchical_visible_items(
                session_id, context, randomization_seed, assignments
            )
        else:
            visible_stage_ids = self._compute_visible_stages(context)
        
        # Track hierarchical completion (blocks and phases)
        completed_phases = list(session_data.get("completed_phases", []))
        completed_blocks = dict(session_data.get("completed_blocks", {}))
        
        # Check if this completes a block
        block_id = stage_config.get("_block_id")
        parent_stage_id = stage_config.get("_stage_id")
        if block_id and parent_stage_id:
            block_completed = self._is_block_completed(block_id, completed_stages, assignments)
            if block_completed:
                if parent_stage_id not in completed_blocks:
                    completed_blocks[parent_stage_id] = []
                if block_id not in completed_blocks[parent_stage_id]:
                    completed_blocks[parent_stage_id].append(block_id)
        
        # Check if this completes a phase
        phase_id = stage_config.get("_phase_id")
        if phase_id:
            phase_completed = self._is_phase_completed(phase_id, completed_stages, visible_stage_ids)
            if phase_completed and phase_id not in completed_phases:
                completed_phases.append(phase_id)
        
        # Determine next stage
        next_stage_id = self._find_next_stage(stage_id, completed_stages, visible_stage_ids)
        
        # Check if experiment is complete
        is_complete = next_stage_id is None
        
        if next_stage_id:
            stage_progress[next_stage_id] = {
                "status": "in_progress",
                "started_at": now,
                "completed_at": None,
                "substep_index": 0,
                "data": None,
            }
        
        # Build visible stages config
        visible_stages = [
            self._filter_stage_for_client(self.stage_map[sid])
            for sid in visible_stage_ids
            if sid in self.stage_map
        ]
        
        # Build session data for lock computation
        updated_session_data = {
            **session_data,
            "completed_stages": completed_stages,
            "completed_phases": completed_phases,
            "completed_blocks": completed_blocks,
        }
        
        # Compute locked items
        locked_items = self._compute_locked_items(updated_session_data)
        
        return {
            "session_id": session_id,
            "next_stage_id": next_stage_id,
            "next_stage": self._filter_stage_for_client(self.stage_map.get(next_stage_id)) if next_stage_id else None,
            "stage_progress": stage_progress,
            "visible_stage_ids": visible_stage_ids,
            "visible_stages": visible_stages,
            "completed_stage_ids": completed_stages,
            "completed_phases": completed_phases,
            "completed_blocks": completed_blocks,
            "locked_items": locked_items,
            "progress": self._compute_progress(completed_stages, visible_stage_ids),
            "is_complete": is_complete,
            "assignments": assignments,
        }
    
    def _is_return_allowed(
        self,
        target_stage_id: str,
        session_data: Dict[str, Any],
    ) -> Tuple[bool, Optional[str]]:
        """
        Check if returning to target is allowed, considering locks at all hierarchy levels.
        Returns (is_allowed, reason_if_blocked)
        """
        target_stage = self.stage_map.get(target_stage_id)
        if not target_stage:
            return False, "Stage not found"
        
        completed_stages = session_data.get("completed_stages", [])
        completed_phases = session_data.get("completed_phases", [])
        completed_blocks = session_data.get("completed_blocks", {})
        
        # Only check locks for completed stages
        if target_stage_id not in completed_stages:
            return True, None
        
        # 1. Check stage-level lock (the stage itself)
        if not target_stage.get("allow_jump_to_completed", True):
            return False, "Stage is locked after completion"
        
        # 2. Check parent block lock (if this stage/task belongs to a block)
        block_id = target_stage.get("_block_id")
        if block_id:
            # Get block config from hierarchy
            block_config = self._get_hierarchy_item_config(block_id)
            if block_config:
                # Check if block is completed
                parent_stage_id = target_stage.get("_stage_id")
                stage_completed_blocks = completed_blocks.get(parent_stage_id, [])
                if block_id in stage_completed_blocks:
                    if not block_config.get("allow_jump_to_completed", True):
                        return False, "Parent block is locked after completion"
        
        # 3. Check parent stage lock (if this task is within a stage with blocks)
        parent_stage_id = target_stage.get("_stage_id")
        if parent_stage_id and parent_stage_id != target_stage_id:
            parent_stage = self.stage_map.get(parent_stage_id)
            if parent_stage and parent_stage_id in completed_stages:
                if not parent_stage.get("allow_jump_to_completed", True):
                    return False, "Parent stage is locked after completion"
        
        # 4. Check parent phase lock
        phase_id = target_stage.get("_phase_id")
        if phase_id and phase_id in completed_phases:
            phase_config = self._get_phase_config(phase_id)
            if phase_config and not phase_config.get("allow_jump_to_completed", True):
                return False, "Parent phase is locked after completion"
        
        return True, None
    
    def _get_hierarchy_item_config(self, item_id: str) -> Optional[Dict[str, Any]]:
        """Get configuration for a hierarchy item by ID"""
        if item_id in self.hierarchy_map:
            return self.hierarchy_map[item_id].get("item")
        return None
    
    def _get_phase_config(self, phase_id: str) -> Optional[Dict[str, Any]]:
        """Get phase configuration by ID"""
        for phase in self.phases:
            if phase.get("id") == phase_id:
                return phase
        return None
    
    def _compute_locked_items(self, session_data: Dict[str, Any]) -> Dict[str, List[str]]:
        """
        Compute which items are locked based on completion status and allow_jump_to_completed settings.
        Returns dict of locked item IDs by level:
        {
            "phases": ["phase_1"],
            "stages": ["stage_1", "stage_2"],
            "blocks": ["block_1"],
            "tasks": ["task_1", "task_2"]
        }
        """
        locked = {
            "phases": [],
            "stages": [],
            "blocks": [],
            "tasks": [],
        }
        
        completed_stages = session_data.get("completed_stages", [])
        completed_phases = session_data.get("completed_phases", [])
        completed_blocks = session_data.get("completed_blocks", {})
        
        # Check each completed phase
        for phase in self.phases:
            phase_id = phase.get("id")
            if phase_id in completed_phases and not phase.get("allow_jump_to_completed", True):
                locked["phases"].append(phase_id)
                # All stages in this phase are also locked
                for stage in phase.get("stages", []):
                    stage_id = stage.get("id")
                    if stage_id not in locked["stages"]:
                        locked["stages"].append(stage_id)
        
        # Check each stage
        for stage_id, stage_config in self.stage_map.items():
            if stage_id in completed_stages:
                # Check if stage itself is locked
                if not stage_config.get("allow_jump_to_completed", True):
                    if stage_id not in locked["stages"]:
                        locked["stages"].append(stage_id)
                
                # Check if parent phase is locked (inherits lock)
                phase_id = stage_config.get("_phase_id")
                if phase_id and phase_id in locked["phases"]:
                    if stage_id not in locked["stages"]:
                        locked["stages"].append(stage_id)
        
        # Check completed blocks
        for parent_stage_id, block_ids in completed_blocks.items():
            for block_id in block_ids:
                block_config = self._get_hierarchy_item_config(block_id)
                if block_config and not block_config.get("allow_jump_to_completed", True):
                    if block_id not in locked["blocks"]:
                        locked["blocks"].append(block_id)
                
                # Check if parent stage is locked (inherits lock)
                if parent_stage_id in locked["stages"]:
                    if block_id not in locked["blocks"]:
                        locked["blocks"].append(block_id)
        
        # Check tasks - they inherit locks from parents
        for stage_id, stage_config in self.stage_map.items():
            if stage_id in completed_stages:
                # Check if task's parent block is locked
                block_id = stage_config.get("_block_id")
                if block_id and block_id in locked["blocks"]:
                    if stage_id not in locked["tasks"]:
                        locked["tasks"].append(stage_id)
                
                # Check if task's parent stage is locked
                parent_stage_id = stage_config.get("_stage_id")
                if parent_stage_id and parent_stage_id in locked["stages"]:
                    if stage_id not in locked["tasks"]:
                        locked["tasks"].append(stage_id)
                
                # Check if task itself is locked
                if not stage_config.get("allow_jump_to_completed", True):
                    if stage_id not in locked["tasks"]:
                        locked["tasks"].append(stage_id)
        
        return locked
    
    async def jump_to_stage(
        self,
        session_id: str,
        session_data: Dict[str, Any],
        target_stage_id: str,
    ) -> Dict[str, Any]:
        """
        Handle jump navigation to reference, completed, or next available stage.
        Manages invalidation for editable stages and respects navigation locks.
        """
        target_stage = self.stage_map.get(target_stage_id)
        if not target_stage:
            raise ValueError(f"Unknown stage: {target_stage_id}")
        
        current_stage_id = session_data.get("current_stage_id")
        completed_stages = session_data.get("completed_stages", [])
        visible_stages = session_data.get("visible_stages", [])
        
        is_reference = target_stage.get("reference", False)
        is_completed = target_stage_id in completed_stages
        is_editable = target_stage.get("editable_after_submit", False)
        
        # Check if target is the next available stage (first uncompleted in sequence)
        is_next_available = self._is_next_available_stage(target_stage_id, completed_stages, visible_stages)
        
        # Validate jump is allowed
        if not is_reference and not is_completed and not is_next_available:
            raise ValueError("Cannot jump to uncompleted non-reference stage")
        
        # Check hierarchical navigation locks for completed stages
        if is_completed:
            is_allowed, lock_reason = self._is_return_allowed(target_stage_id, session_data)
            if not is_allowed:
                raise ValueError(f"Cannot return to this stage: {lock_reason}")
        
        # Compute current locked items
        locked_items = self._compute_locked_items(session_data)
        
        result = {
            "session_id": session_id,
            "current_stage_id": target_stage_id,
            "current_stage": self._filter_stage_for_client(target_stage),
            "return_stage_id": current_stage_id,
            "is_reference": is_reference,
            "invalidated_stages": None,
            "stage_progress": session_data.get("stage_progress", {}),
            "completed_stage_ids": completed_stages,
            "locked_items": locked_items,
        }
        
        # Store return point for reference stages
        if is_reference:
            redis = get_redis()
            await redis.setex(f"jump_return:{session_id}", 3600, current_stage_id)
        
        # Handle potential invalidation for editable stages
        if is_completed and is_editable and target_stage.get("invalidates_dependents", True):
            # Get dependent stages
            dependents = self.dependency_graph.get_dependents(target_stage_id)
            
            if dependents:
                result["invalidated_stages"] = dependents
                
                # Update stage progress
                for dep_id in dependents:
                    if dep_id in result["stage_progress"]:
                        result["stage_progress"][dep_id]["status"] = "invalidated"
                
                # Remove from completed
                result["completed_stage_ids"] = [
                    sid for sid in completed_stages
                    if sid not in dependents
                ]
        
        return result
    
    async def get_session_state(
        self,
        session_id: str,
        session_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Get current session state for recovery"""
        if not session_data:
            # Try to get from Redis cache
            redis = get_redis()
            cached = await redis.get(RedisKeys.session_state(session_id))
            if cached:
                return json.loads(cached)
            
            # No cached state, need session_data
            raise ValueError("Session data required")
        
        current_stage_id = session_data.get("current_stage_id")
        completed_stages = session_data.get("completed_stages", [])
        visible_stage_ids = session_data.get("visible_stages", [])
        
        visible_stages = [
            self._filter_stage_for_client(self.stage_map[sid])
            for sid in visible_stage_ids
            if sid in self.stage_map
        ]
        
        # Compute locked items
        locked_items = self._compute_locked_items(session_data)
        
        return {
            "session_id": session_id,
            "current_stage": self._filter_stage_for_client(self.stage_map.get(current_stage_id)) if current_stage_id else None,
            "visible_stages": visible_stages,
            "completed_stage_ids": completed_stages,
            "progress": self._compute_progress(completed_stages, visible_stage_ids),
            "locked_items": locked_items,
        }
    
    def get_stage_config(self, stage_id: str) -> Optional[Dict[str, Any]]:
        """Get stage configuration by ID"""
        return self.stage_map.get(stage_id)
    
    def serialize_state(self, state: Dict[str, Any]) -> str:
        """Serialize state for Redis storage"""
        return json.dumps(state, default=str)
    
    def _compute_visible_stages(self, context: Dict[str, Any]) -> List[str]:
        """Compute which stages are visible based on current context"""
        visible = []
        
        for stage in self.stages:
            if self._is_stage_visible(stage, context):
                visible.append(stage["id"])
        
        return visible
    
    def _is_stage_visible(self, stage: Dict[str, Any], context: Dict[str, Any]) -> bool:
        """Check if a stage is visible based on visibility rule"""
        rule = stage.get("visibility_rule")
        
        if not rule:
            return True  # No rule = always visible
        
        if rule == "true":
            return True
        
        if rule == "false":
            return False
        
        return self.visibility_engine.evaluate(rule, context)
    
    def _find_next_stage(
        self,
        current_stage_id: str,
        completed_stages: List[str],
        visible_stages: List[str],
    ) -> Optional[str]:
        """Find the next stage to navigate to"""
        # Get stage order from visible stages
        try:
            current_index = visible_stages.index(current_stage_id)
        except ValueError:
            current_index = -1
        
        # Find next uncompleted visible stage
        for i in range(current_index + 1, len(visible_stages)):
            stage_id = visible_stages[i]
            if stage_id not in completed_stages:
                return stage_id
        
        return None  # Experiment complete
    
    def _compute_progress(
        self,
        completed_stages: List[str],
        visible_stages: List[str],
    ) -> Dict[str, Any]:
        """Compute progress information"""
        total = len(visible_stages)
        current = len(completed_stages)
        
        return {
            "current": current,
            "total": total,
            "percentage": round((current / total * 100) if total > 0 else 0, 1),
        }
    
    def _is_block_completed(
        self, 
        block_id: str, 
        completed_stages: List[str],
        assignments: Optional[Dict[str, str]] = None,
    ) -> bool:
        """Check if all tasks in a block are completed (respects pick_count)"""
        if block_id not in self.hierarchy_map:
            return False
        
        block_info = self.hierarchy_map[block_id]
        if block_info.get("type") != "block":
            return False
        
        children = block_info.get("children", [])
        
        # If block has no children (tasks), check if the block itself is completed
        if not children:
            # Block itself is the task
            return block_id in completed_stages
        
        # Check if there are picked children (from pick_count)
        if assignments:
            picked_ids = self._get_picks_from_assignments(assignments, block_id)
            if picked_ids:
                # Only check picked children, not all children
                return all(task_id in completed_stages for task_id in picked_ids)
        
        # Check if all child tasks are completed
        return all(task_id in completed_stages for task_id in children)
    
    def _is_phase_completed(
        self, 
        phase_id: str, 
        completed_stages: List[str],
        visible_stage_ids: Optional[List[str]] = None,
    ) -> bool:
        """Check if all stages/tasks in a phase are completed (respects pick_count)"""
        if phase_id not in self.hierarchy_map:
            return False
        
        phase_info = self.hierarchy_map[phase_id]
        if phase_info.get("type") != "phase":
            return False
        
        # Collect all leaf tasks/stages in this phase
        all_leaf_ids = self._get_all_leaf_ids_in_phase(phase_id)
        
        # If we have visible_stage_ids, only check those that are in this phase
        if visible_stage_ids is not None:
            # Filter to only leaf IDs that are visible (picked)
            all_leaf_ids = [lid for lid in all_leaf_ids if lid in visible_stage_ids]
        
        # Check if all (visible) leaf nodes are completed
        return all(leaf_id in completed_stages for leaf_id in all_leaf_ids)
    
    def _get_all_leaf_ids_in_phase(self, phase_id: str) -> List[str]:
        """Get all leaf node IDs (tasks/stages with type) within a phase"""
        leaf_ids = []
        
        if phase_id not in self.hierarchy_map:
            return leaf_ids
        
        phase_info = self.hierarchy_map[phase_id]
        stage_ids = phase_info.get("children", [])
        
        for stage_id in stage_ids:
            if stage_id not in self.hierarchy_map:
                continue
            
            stage_info = self.hierarchy_map[stage_id]
            stage_item = stage_info.get("item", {})
            block_ids = stage_info.get("children", [])
            
            # If stage has no blocks, check if it's a direct stage with type
            if not block_ids:
                if stage_item.get("type"):
                    leaf_ids.append(stage_id)
                continue
            
            # Process blocks
            for block_id in block_ids:
                if block_id not in self.hierarchy_map:
                    continue
                
                block_info = self.hierarchy_map[block_id]
                block_item = block_info.get("item", {})
                task_ids = block_info.get("children", [])
                
                # If block has no tasks, check if it's a direct block with type
                if not task_ids:
                    if block_item.get("type"):
                        leaf_ids.append(block_id)
                    continue
                
                # Add all tasks
                leaf_ids.extend(task_ids)
        
        return leaf_ids
    
    def _validate_stage_data(
        self,
        stage_config: Dict[str, Any],
        data: Dict[str, Any],
    ) -> List[str]:
        """Validate submitted data against stage requirements"""
        errors = []
        stage_type = stage_config.get("type")
        
        if stage_type == "questionnaire":
            questions = stage_config.get("questions", [])
            for q in questions:
                q_id = q["id"]
                is_required = q.get("required", True)
                
                if is_required and q_id not in data:
                    errors.append(f"Required field missing: {q_id}")
                
                # Validate regex pattern if present
                if q_id in data and q.get("validation"):
                    import re
                    pattern = q["validation"]
                    value = str(data[q_id])
                    if not re.match(pattern, value):
                        errors.append(f"Validation failed for {q_id}: {q.get('validation_message', 'Invalid format')}")
        
        elif stage_type == "user_info":
            fields = stage_config.get("fields", [])
            for field in fields:
                field_id = field["field"]
                is_required = field.get("required", True)
                
                if is_required and field_id not in data:
                    errors.append(f"Required field missing: {field_id}")
        
        elif stage_type == "participant_identity":
            # Similar to user_info but only validates enabled fields
            fields = stage_config.get("fields", [])
            for field in fields:
                # Skip disabled fields
                if not field.get("enabled", True):
                    continue
                
                field_id = field.get("field")
                if not field_id:
                    continue
                
                is_required = field.get("required", False)
                
                if is_required:
                    value = data.get(field_id)
                    if not value or (isinstance(value, str) and not value.strip()):
                        errors.append(f"Required field missing: {field_id}")
                
                # Validate regex pattern if present and field has value
                if field_id in data and field.get("validation"):
                    import re
                    pattern = field["validation"]
                    value = str(data[field_id])
                    if value and not re.match(pattern, value):
                        errors.append(f"Validation failed for {field_id}: {field.get('validation_message', 'Invalid format')}")
        
        return errors
    
    def _filter_stage_for_client(self, stage: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Filter stage config for client (remove server-only fields)"""
        if not stage:
            return None
        
        # Create a copy and remove sensitive fields
        filtered = stage.copy()
        filtered.pop("server_config", None)
        filtered.pop("visibility_rule", None)  # Processed server-side
        
        return filtered
    
    def _is_next_available_stage(
        self,
        target_stage_id: str,
        completed_stages: List[str],
        visible_stages: List[str],
    ) -> bool:
        """
        Check if target stage is the next available stage in the sequence.
        A stage is 'next available' if:
        - It's in the visible stages
        - It's the first uncompleted stage in the sequence
        - All previous stages are completed
        """
        if target_stage_id not in visible_stages:
            return False
        
        target_index = visible_stages.index(target_stage_id)
        
        # Check if all stages before target are completed
        for i in range(target_index):
            if visible_stages[i] not in completed_stages:
                return False
        
        # Target should be uncompleted (otherwise it's just a completed stage jump)
        return target_stage_id not in completed_stages

