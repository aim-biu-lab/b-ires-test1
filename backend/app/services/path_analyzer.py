"""
Path Analyzer - Analyzes experiment configs to extract all possible paths.

Reuses the same logic as SessionManager/Sequencer to ensure consistency
between what's shown in preview and what happens at runtime.
"""
from typing import Dict, List, Any, Optional
import logging

from app.services.session_manager import SessionManager
from app.models.experiment import OrderingMode, PickStrategy

logger = logging.getLogger(__name__)


class PathAnalyzer:
    """
    Analyzes experiment configuration to build a tree of all possible paths.
    
    Uses the same config parsing as SessionManager to ensure the preview
    exactly matches runtime behavior.
    """
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize analyzer with experiment config.
        
        Args:
            config: Experiment configuration dict (same format as runtime)
        """
        self.config = config
        # Reuse SessionManager's config parsing (without database)
        self.session_manager = SessionManager(config)
        self.is_hierarchical = self.session_manager.is_hierarchical
    
    def analyze(self) -> Dict[str, Any]:
        """
        Analyze the experiment config and return a path tree.
        
        Returns:
            Path tree structure with nodes and annotations
        """
        if self.is_hierarchical:
            return self._analyze_hierarchical()
        else:
            return self._analyze_flat()
    
    def _analyze_hierarchical(self) -> Dict[str, Any]:
        """Analyze hierarchical (4-level) experiment structure"""
        phases = self.config.get("phases", [])
        
        root_node = {
            "id": "root",
            "type": "root",
            "label": self.config.get("meta", {}).get("title", "Experiment"),
            "children": [],
        }
        
        for phase in phases:
            phase_node = self._analyze_phase(phase)
            root_node["children"].append(phase_node)
        
        return root_node
    
    def _analyze_flat(self) -> Dict[str, Any]:
        """Analyze flat (legacy) experiment structure"""
        stages = self.config.get("stages", [])
        
        root_node = {
            "id": "root",
            "type": "root",
            "label": self.config.get("meta", {}).get("title", "Experiment"),
            "children": [],
        }
        
        for stage in stages:
            stage_node = self._analyze_stage_flat(stage)
            root_node["children"].append(stage_node)
        
        return root_node
    
    def _analyze_phase(self, phase: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze a phase and its stages"""
        phase_id = phase.get("id", "unknown")
        phase_rules = phase.get("rules") or {}
        
        node = {
            "id": phase_id,
            "type": "phase",
            "label": phase.get("label") or phase.get("title") or phase_id,
            "children": [],
            "rules": self._extract_rules(phase_rules),
        }
        
        stages = phase.get("stages", [])
        
        # Check if phase has pick_count - creates a branch point
        pick_count = phase_rules.get("pick_count")
        if pick_count is not None and pick_count > 0 and pick_count < len(stages):
            # Wrap stages in a pick group
            pick_group = self._create_pick_group(
                parent_id=phase_id,
                children=stages,
                pick_count=pick_count,
                pick_strategy=phase_rules.get("pick_strategy", "random"),
                pick_conditions=phase_rules.get("pick_conditions"),
                child_analyzer=self._analyze_stage,
            )
            node["children"].append(pick_group)
        else:
            # Check ordering mode
            ordering = phase_rules.get("ordering", "sequential")
            if ordering in ["randomized", "balanced", "weighted", "latin_square"]:
                # Wrap in ordering group
                ordering_group = self._create_ordering_group(
                    parent_id=phase_id,
                    children=stages,
                    ordering=ordering,
                    child_analyzer=self._analyze_stage,
                )
                node["children"].append(ordering_group)
            else:
                # Sequential - just add children directly
                for stage in stages:
                    stage_node = self._analyze_stage(stage)
                    node["children"].append(stage_node)
        
        return node
    
    def _analyze_stage(self, stage: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze a stage and its blocks"""
        stage_id = stage.get("id", "unknown")
        stage_rules = stage.get("rules") or {}
        
        node = {
            "id": stage_id,
            "type": "stage",
            "label": stage.get("label") or stage.get("title") or stage_id,
            "children": [],
            "rules": self._extract_rules(stage_rules),
        }
        
        # Add visibility annotation if present
        visibility = stage_rules.get("visibility") or stage.get("visibility_rule")
        if visibility:
            node["visibility"] = visibility
            node["isConditional"] = True
        
        blocks = stage.get("blocks", [])
        
        # If no blocks, stage might be a direct task
        if not blocks:
            if stage.get("type"):
                # This is a leaf stage (direct task)
                node["type"] = "task"
                node["stageType"] = stage.get("type")
            return node
        
        # Check if stage has pick_count for its blocks
        pick_count = stage_rules.get("pick_count")
        if pick_count is not None and pick_count > 0 and pick_count < len(blocks):
            pick_group = self._create_pick_group(
                parent_id=stage_id,
                children=blocks,
                pick_count=pick_count,
                pick_strategy=stage_rules.get("pick_strategy", "random"),
                pick_conditions=stage_rules.get("pick_conditions"),
                child_analyzer=self._analyze_block,
            )
            node["children"].append(pick_group)
        else:
            ordering = stage_rules.get("ordering", "sequential")
            if ordering in ["randomized", "balanced", "weighted", "latin_square"]:
                ordering_group = self._create_ordering_group(
                    parent_id=stage_id,
                    children=blocks,
                    ordering=ordering,
                    child_analyzer=self._analyze_block,
                )
                node["children"].append(ordering_group)
            else:
                for block in blocks:
                    block_node = self._analyze_block(block)
                    node["children"].append(block_node)
        
        return node
    
    def _analyze_stage_flat(self, stage: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze a stage in flat structure (no phases)"""
        stage_id = stage.get("id", "unknown")
        
        node = {
            "id": stage_id,
            "type": "task",
            "label": stage.get("label") or stage.get("title") or stage_id,
            "stageType": stage.get("type"),
            "rules": self._extract_rules(stage.get("rules") or {}),
        }
        
        visibility = (stage.get("rules") or {}).get("visibility") or stage.get("visibility_rule")
        if visibility:
            node["visibility"] = visibility
            node["isConditional"] = True
        
        return node
    
    def _analyze_block(self, block: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze a block and its tasks"""
        block_id = block.get("id", "unknown")
        block_rules = block.get("rules") or {}
        
        node = {
            "id": block_id,
            "type": "block",
            "label": block.get("label") or block.get("title") or block_id,
            "children": [],
            "rules": self._extract_rules(block_rules),
        }
        
        visibility = block_rules.get("visibility") or block.get("visibility_rule")
        if visibility:
            node["visibility"] = visibility
            node["isConditional"] = True
        
        tasks = block.get("tasks", [])
        
        # If no tasks, block might be a direct task
        if not tasks:
            if block.get("type"):
                node["type"] = "task"
                node["stageType"] = block.get("type")
            return node
        
        # Check if block has pick_count for its tasks
        pick_count = block_rules.get("pick_count")
        if pick_count is not None and pick_count > 0 and pick_count < len(tasks):
            pick_group = self._create_pick_group(
                parent_id=block_id,
                children=tasks,
                pick_count=pick_count,
                pick_strategy=block_rules.get("pick_strategy", "random"),
                pick_conditions=block_rules.get("pick_conditions"),
                child_analyzer=self._analyze_task,
            )
            node["children"].append(pick_group)
        else:
            ordering = block_rules.get("ordering", "sequential")
            if ordering in ["randomized", "balanced", "weighted", "latin_square"]:
                ordering_group = self._create_ordering_group(
                    parent_id=block_id,
                    children=tasks,
                    ordering=ordering,
                    child_analyzer=self._analyze_task,
                )
                node["children"].append(ordering_group)
            else:
                for task in tasks:
                    task_node = self._analyze_task(task)
                    node["children"].append(task_node)
        
        return node
    
    def _analyze_task(self, task: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze a task (leaf node)"""
        task_id = task.get("id", "unknown")
        task_rules = task.get("rules") or {}
        
        node = {
            "id": task_id,
            "type": "task",
            "label": task.get("label") or task.get("title") or task_id,
            "stageType": task.get("type"),
            "rules": self._extract_rules(task_rules),
        }
        
        # Add pick_assigns if present (for pick_conditions)
        pick_assigns = task.get("pick_assigns")
        if pick_assigns:
            node["pickAssigns"] = pick_assigns
        
        visibility = task_rules.get("visibility") or task.get("visibility_rule")
        if visibility:
            node["visibility"] = visibility
            node["isConditional"] = True
        
        return node
    
    def _create_pick_group(
        self,
        parent_id: str,
        children: List[Dict[str, Any]],
        pick_count: int,
        pick_strategy: str,
        pick_conditions: Optional[List[Dict[str, Any]]],
        child_analyzer,
    ) -> Dict[str, Any]:
        """Create a pick group node representing a branching point"""
        group_id = f"{parent_id}_pick_group"
        
        # Format pick conditions for display
        conditions_display = None
        if pick_conditions:
            conditions_display = [
                {"variable": c.get("variable"), "operator": c.get("operator", "not_in")}
                for c in pick_conditions
            ]
        
        group = {
            "id": group_id,
            "type": "pickGroup",
            "label": f"Pick {pick_count} of {len(children)}",
            "branchType": "pick",
            "pickCount": pick_count,
            "pickStrategy": pick_strategy,
            "totalCandidates": len(children),
            "candidates": [c.get("id") for c in children],
            "children": [],
        }
        
        if conditions_display:
            group["pickConditions"] = conditions_display
        
        # Add all candidate children
        for child in children:
            child_node = child_analyzer(child)
            group["children"].append(child_node)
        
        return group
    
    def _create_ordering_group(
        self,
        parent_id: str,
        children: List[Dict[str, Any]],
        ordering: str,
        child_analyzer,
    ) -> Dict[str, Any]:
        """Create an ordering group node for non-sequential ordering"""
        group_id = f"{parent_id}_order_group"
        
        ordering_labels = {
            "randomized": "Random Order",
            "balanced": "Balanced Distribution",
            "weighted": "Weighted Distribution",
            "latin_square": "Latin Square",
        }
        
        group = {
            "id": group_id,
            "type": "orderGroup",
            "label": ordering_labels.get(ordering, ordering),
            "branchType": "ordering",
            "ordering": ordering,
            "children": [],
        }
        
        for child in children:
            child_node = child_analyzer(child)
            group["children"].append(child_node)
        
        return group
    
    def _extract_rules(self, rules_dict: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Extract relevant rules for display"""
        if not rules_dict:
            return None
        
        extracted = {}
        
        if rules_dict.get("ordering") and rules_dict.get("ordering") != "sequential":
            extracted["ordering"] = rules_dict["ordering"]
        
        if rules_dict.get("pick_count"):
            extracted["pickCount"] = rules_dict["pick_count"]
            extracted["pickStrategy"] = rules_dict.get("pick_strategy", "random")
        
        if rules_dict.get("pick_conditions"):
            extracted["pickConditions"] = [
                {"variable": c.get("variable"), "operator": c.get("operator")}
                for c in rules_dict["pick_conditions"]
            ]
        
        if rules_dict.get("visibility"):
            extracted["visibility"] = rules_dict["visibility"]
        
        if rules_dict.get("quota"):
            extracted["quota"] = rules_dict["quota"]
        
        return extracted if extracted else None

