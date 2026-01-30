"""
Path Simulator - Simulates multiple participant sessions to preview path distributions.

Reuses the same logic as SessionManager/Sequencer to ensure accuracy.
Uses in-memory counters instead of database for simulation.
"""
import random
import json
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, field
from collections import Counter
import logging

from app.services.visibility_engine import VisibilityEngine
from app.services.sequencer import Sequencer
from app.models.experiment import (
    OrderingMode, RulesConfig, WeightConfig, BalanceOn,
    PickStrategy, PickCondition, PickConditionOperator,
)

logger = logging.getLogger(__name__)


@dataclass
class SimulatedPath:
    """Represents a simulated participant's path through the experiment"""
    participant_index: int
    path: List[str]  # List of step IDs in order
    assignments: Dict[str, str]  # Level assignments
    context: Dict[str, Any]  # The participant's context used for simulation
    
    def path_key(self) -> str:
        """Return a hashable key for grouping paths"""
        return "→".join(self.path)


@dataclass
class PathDistribution:
    """Aggregated path distribution results"""
    unique_path: List[str]
    count: int
    percentage: float
    sample_assignments: Dict[str, str]  # Sample assignments from one participant
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.unique_path,
            "pathDisplay": " → ".join(self.unique_path),
            "count": self.count,
            "percentage": round(self.percentage, 2),
            "sampleAssignments": self.sample_assignments,
        }


@dataclass
class SimulationResult:
    """Complete simulation results"""
    total_participants: int
    path_distributions: List[PathDistribution]
    variable_summary: Dict[str, Dict[str, int]]  # Actual distribution of generated variables
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "totalParticipants": self.total_participants,
            "pathDistributions": [p.to_dict() for p in self.path_distributions],
            "variableSummary": self.variable_summary,
        }


class InMemoryCounters:
    """In-memory counters for simulation (replaces database counters)"""
    
    def __init__(self):
        self.distribution_counters: Dict[str, Dict[str, int]] = {}
        self.pick_counters: Dict[str, int] = {}
    
    def get_count(self, level_id: str, child_id: str) -> int:
        """Get started count for a child at a level"""
        if level_id not in self.distribution_counters:
            return 0
        return self.distribution_counters[level_id].get(child_id, 0)
    
    def increment_count(self, level_id: str, child_id: str) -> None:
        """Increment started count"""
        if level_id not in self.distribution_counters:
            self.distribution_counters[level_id] = {}
        if child_id not in self.distribution_counters[level_id]:
            self.distribution_counters[level_id][child_id] = 0
        self.distribution_counters[level_id][child_id] += 1
    
    def get_pick_counter(self, level_id: str) -> int:
        """Get round-robin counter for a level"""
        return self.pick_counters.get(level_id, 0)
    
    def increment_pick_counter(self, level_id: str) -> int:
        """Increment and return round-robin counter"""
        if level_id not in self.pick_counters:
            self.pick_counters[level_id] = 0
        self.pick_counters[level_id] += 1
        return self.pick_counters[level_id] - 1


class SimulationSequencer:
    """
    Modified Sequencer that uses in-memory counters for simulation.
    Reuses the core logic from the main Sequencer.
    """
    
    def __init__(self, counters: InMemoryCounters):
        self.counters = counters
    
    def get_ordered_children(
        self,
        children: List[Dict[str, Any]],
        rules: Optional[RulesConfig],
        session_id: str,
        level_id: str,
        existing_assignment: Optional[str] = None,
        randomization_seed: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
        """Get ordered list of children based on rules (synchronous version)"""
        if not children:
            return [], None, None
        
        if not rules:
            return children, None, "No rules specified, using sequential"
        
        mode = rules.ordering
        
        # If there's an existing assignment for this level, use it
        if existing_assignment and mode in [OrderingMode.BALANCED, OrderingMode.WEIGHTED, OrderingMode.LATIN_SQUARE]:
            assigned = next((c for c in children if c.get("id") == existing_assignment), None)
            if assigned:
                return [assigned], existing_assignment, f"Restored previous assignment: {existing_assignment}"
        
        if mode == OrderingMode.SEQUENTIAL:
            return children, None, "Sequential ordering"
        
        elif mode == OrderingMode.RANDOMIZED:
            return self._randomize(children, session_id, randomization_seed), None, "Randomized ordering"
        
        elif mode == OrderingMode.BALANCED:
            return self._balanced_select(children, level_id, rules)
        
        elif mode == OrderingMode.WEIGHTED:
            return self._weighted_select(children, rules, session_id, randomization_seed)
        
        elif mode == OrderingMode.LATIN_SQUARE:
            return self._latin_square_select(children, level_id, session_id, randomization_seed)
        
        return children, None, "Default sequential ordering"
    
    def pick_children(
        self,
        children: List[Dict[str, Any]],
        rules: Optional[RulesConfig],
        session_id: str,
        level_id: str,
        existing_picks: Optional[List[str]] = None,
        randomization_seed: Optional[int] = None,
        pick_assignments: Optional[Dict[str, List[Any]]] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[List[str]], Optional[str], Optional[Dict[str, Any]]]:
        """Pick a subset of children based on rules (synchronous version)"""
        if not children:
            return [], None, "No children to pick from", None
        
        if not rules or rules.pick_count is None:
            all_assigns = self._collect_pick_assigns(children)
            return children, None, "No pick_count specified, using all children", all_assigns
        
        pick_count = rules.pick_count
        
        if pick_count <= 0:
            all_assigns = self._collect_pick_assigns(children)
            return children, None, "pick_count must be positive, using all children", all_assigns
        
        # If there are existing picks for this level, restore them
        if existing_picks:
            picked = [c for c in children if c.get("id") in existing_picks]
            if len(picked) == pick_count:
                assigns = self._collect_pick_assigns(picked)
                return picked, existing_picks, f"Restored previous picks: {existing_picks}", assigns
        
        # Filter candidates by pick_conditions
        candidates = children
        if rules.pick_conditions and pick_assignments is not None:
            candidates = self._filter_by_conditions(children, rules.pick_conditions, pick_assignments)
            if not candidates:
                return [], [], "No candidates satisfy pick_conditions", None
        
        if pick_count >= len(candidates):
            picked_ids = [c.get("id") for c in candidates]
            assigns = self._collect_pick_assigns(candidates)
            return candidates, picked_ids, f"pick_count >= filtered candidates, using all", assigns
        
        strategy = rules.pick_strategy or PickStrategy.RANDOM
        
        if strategy == PickStrategy.RANDOM:
            picked, picked_ids, reason = self._pick_random(candidates, pick_count, session_id, randomization_seed)
        elif strategy == PickStrategy.ROUND_ROBIN:
            picked, picked_ids, reason = self._pick_round_robin(candidates, pick_count, level_id)
        elif strategy == PickStrategy.WEIGHTED_RANDOM:
            picked, picked_ids, reason = self._pick_weighted_random(candidates, pick_count, rules, session_id, randomization_seed)
        else:
            picked, picked_ids, reason = self._pick_random(candidates, pick_count, session_id, randomization_seed)
        
        assigns = self._collect_pick_assigns(picked)
        return picked, picked_ids, reason, assigns
    
    def _randomize(
        self,
        children: List[Dict[str, Any]],
        session_id: str,
        seed: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Randomize children order using a deterministic seed"""
        if seed is None:
            seed = hash(session_id) % (2**32)
        shuffled = children.copy()
        rng = random.Random(seed)
        rng.shuffle(shuffled)
        return shuffled
    
    def _balanced_select(
        self,
        children: List[Dict[str, Any]],
        level_id: str,
        rules: RulesConfig,
    ) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
        """Select child using least-filled (balanced) algorithm with in-memory counters"""
        child_ids = [c.get("id") for c in children]
        counts = {cid: self.counters.get_count(level_id, cid) for cid in child_ids}
        
        min_count = min(counts.values())
        candidates = [cid for cid, count in counts.items() if count == min_count]
        
        selected_id = random.choice(candidates)
        self.counters.increment_count(level_id, selected_id)
        
        selected = next((c for c in children if c.get("id") == selected_id), children[0])
        reason = f"Balanced: counts={counts}, selected={selected_id}"
        
        return [selected], selected_id, reason
    
    def _weighted_select(
        self,
        children: List[Dict[str, Any]],
        rules: RulesConfig,
        session_id: str,
        seed: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
        """Select child using weighted probability"""
        weights = {}
        if rules.weights:
            for w in rules.weights:
                weights[w.id] = w.value
        
        for child in children:
            child_id = child.get("id")
            if child_id not in weights:
                weights[child_id] = 1
        
        total_weight = sum(weights.get(c.get("id"), 1) for c in children)
        
        if seed is None:
            seed = hash(session_id) % (2**32)
        rng = random.Random(seed)
        
        roll = rng.randint(1, total_weight)
        cumulative = 0
        
        for child in children:
            child_id = child.get("id")
            cumulative += weights.get(child_id, 1)
            if roll <= cumulative:
                reason = f"Weighted: roll={roll}, total={total_weight}, assigned={child_id}"
                return [child], child_id, reason
        
        selected = children[-1]
        return [selected], selected.get("id"), "Weighted (fallback)"
    
    def get_weighted_order_all(
        self,
        children: List[Dict[str, Any]],
        rules: Optional[RulesConfig],
        session_id: str,
        level_id: str,
        existing_assignment: Optional[str] = None,
        randomization_seed: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
        """
        Order ALL children using weighted shuffle.
        Higher weight = more likely to appear earlier in the order.
        Returns full ordered list (all children).
        """
        if not children:
            return [], None, None
        
        # If there's an existing assignment, restore that order
        if existing_assignment:
            order_ids = existing_assignment.split(",")
            ordered = []
            for oid in order_ids:
                child = next((c for c in children if c.get("id") == oid), None)
                if child:
                    ordered.append(child)
            for child in children:
                if child not in ordered:
                    ordered.append(child)
            if len(ordered) == len(children):
                return ordered, existing_assignment, f"Restored previous weighted order"
        
        # Build weight map
        weights = {}
        if rules and rules.weights:
            for w in rules.weights:
                weights[w.id] = w.value
        
        for child in children:
            child_id = child.get("id")
            if child_id not in weights:
                weights[child_id] = 1
        
        # Use deterministic random
        if randomization_seed is None:
            randomization_seed = hash(session_id) % (2**32)
        rng = random.Random(randomization_seed)
        
        # Weighted shuffle
        remaining = children.copy()
        ordered = []
        
        while remaining:
            if len(remaining) == 1:
                ordered.append(remaining[0])
                break
            
            total_weight = sum(weights.get(c.get("id"), 1) for c in remaining)
            roll = rng.uniform(0, total_weight)
            cumulative = 0
            
            for i, child in enumerate(remaining):
                child_id = child.get("id")
                cumulative += weights.get(child_id, 1)
                if roll <= cumulative:
                    ordered.append(child)
                    remaining.pop(i)
                    break
        
        order_ids = [c.get("id") for c in ordered]
        assignment = ",".join(order_ids)
        reason = f"Weighted order: {order_ids}"
        
        return ordered, assignment, reason
    
    def _latin_square_select(
        self,
        children: List[Dict[str, Any]],
        level_id: str,
        session_id: str,
        seed: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
        """Select order using Latin Square counterbalancing"""
        n = len(children)
        if n == 0:
            return [], None, "No children for Latin Square"
        
        orderings = self._generate_latin_square(n)
        
        # Use balanced selection for which ordering to use
        order_counts = {i: self.counters.get_count(f"{level_id}_ls", str(i)) for i in range(len(orderings))}
        min_count = min(order_counts.values())
        candidates = [i for i, count in order_counts.items() if count == min_count]
        order_idx = random.choice(candidates)
        self.counters.increment_count(f"{level_id}_ls", str(order_idx))
        
        ordering = orderings[order_idx]
        ordered_children = [children[i] for i in ordering]
        order_ids = [c.get("id") for c in ordered_children]
        
        reason = f"Latin Square: order {order_idx + 1} of {len(orderings)}"
        assignment = ",".join(order_ids)
        
        return ordered_children, assignment, reason
    
    def _generate_latin_square(self, n: int) -> List[List[int]]:
        """Generate a Latin Square of size n"""
        if n <= 0:
            return []
        square = []
        for i in range(n):
            row = [(i + j) % n for j in range(n)]
            square.append(row)
        return square
    
    def _pick_random(
        self,
        children: List[Dict[str, Any]],
        pick_count: int,
        session_id: str,
        seed: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], List[str], str]:
        """Pick children randomly"""
        if seed is None:
            seed = hash(session_id) % (2**32)
        rng = random.Random(seed)
        picked = rng.sample(children, pick_count)
        picked_ids = [c.get("id") for c in picked]
        return picked, picked_ids, f"Random pick: {picked_ids}"
    
    def _pick_round_robin(
        self,
        children: List[Dict[str, Any]],
        pick_count: int,
        level_id: str,
    ) -> Tuple[List[Dict[str, Any]], List[str], str]:
        """Pick children using round-robin"""
        from itertools import combinations
        
        all_combinations = list(combinations(range(len(children)), pick_count))
        counter = self.counters.get_pick_counter(f"{level_id}_pick_rr")
        self.counters.increment_pick_counter(f"{level_id}_pick_rr")
        
        combo_idx = counter % len(all_combinations)
        combo = all_combinations[combo_idx]
        picked = [children[i] for i in combo]
        picked_ids = [c.get("id") for c in picked]
        
        return picked, picked_ids, f"Round-robin: combo {combo_idx + 1} of {len(all_combinations)}"
    
    def _pick_weighted_random(
        self,
        children: List[Dict[str, Any]],
        pick_count: int,
        rules: RulesConfig,
        session_id: str,
        seed: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], List[str], str]:
        """Pick children using weighted random selection"""
        weights = {}
        if rules.pick_weights:
            for w in rules.pick_weights:
                weights[w.id] = w.value
        
        for child in children:
            child_id = child.get("id")
            if child_id not in weights:
                weights[child_id] = 1
        
        if seed is None:
            seed = hash(session_id) % (2**32)
        rng = random.Random(seed)
        
        remaining = children.copy()
        picked = []
        
        for _ in range(pick_count):
            if not remaining:
                break
            
            total_weight = sum(weights.get(c.get("id"), 1) for c in remaining)
            roll = rng.uniform(0, total_weight)
            cumulative = 0
            
            for i, child in enumerate(remaining):
                child_id = child.get("id")
                cumulative += weights.get(child_id, 1)
                if roll <= cumulative:
                    picked.append(child)
                    remaining.pop(i)
                    break
        
        picked_ids = [c.get("id") for c in picked]
        return picked, picked_ids, f"Weighted random pick: {picked_ids}"
    
    def _filter_by_conditions(
        self,
        children: List[Dict[str, Any]],
        conditions: List[PickCondition],
        pick_assignments: Dict[str, List[Any]],
    ) -> List[Dict[str, Any]]:
        """Filter children based on pick conditions"""
        filtered = []
        
        for child in children:
            child_assigns = self._get_effective_pick_assigns(child)
            passes_all = True
            
            for condition in conditions:
                variable = condition.variable
                operator = condition.operator
                
                child_values = child_assigns.get(variable, [])
                accumulated_values = pick_assignments.get(variable, [])
                
                if not child_values:
                    continue
                
                for child_value in child_values:
                    if operator in (PickConditionOperator.NOT_IN, PickConditionOperator.NOT_EQUAL):
                        if child_value in accumulated_values:
                            passes_all = False
                            break
                    elif operator in (PickConditionOperator.IN, PickConditionOperator.EQUAL):
                        if child_value not in accumulated_values:
                            passes_all = False
                            break
                
                if not passes_all:
                    break
            
            if passes_all:
                filtered.append(child)
        
        return filtered
    
    def _get_effective_pick_assigns(self, item: Dict[str, Any]) -> Dict[str, List[Any]]:
        """Get effective pick_assigns for an item"""
        result: Dict[str, List[Any]] = {}
        
        direct_assigns = item.get("pick_assigns")
        if direct_assigns:
            for key, value in direct_assigns.items():
                result[key] = [value]
            return result
        
        # Aggregate from children
        for task in item.get("tasks", []):
            task_assigns = task.get("pick_assigns")
            if task_assigns:
                for key, value in task_assigns.items():
                    if key not in result:
                        result[key] = []
                    if value not in result[key]:
                        result[key].append(value)
        
        for block in item.get("blocks", []):
            block_assigns = self._get_effective_pick_assigns(block)
            for key, values in block_assigns.items():
                if key not in result:
                    result[key] = []
                for value in values:
                    if value not in result[key]:
                        result[key].append(value)
        
        return result
    
    def _collect_pick_assigns(self, children: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Collect pick_assigns from all children"""
        if not children:
            return None
        
        result = {}
        for child in children:
            child_assigns = child.get("pick_assigns")
            if child_assigns:
                for key, value in child_assigns.items():
                    if key not in result:
                        result[key] = []
                    result[key].append(value)
        
        return result if result else None


class PathSimulator:
    """
    Simulates multiple participant sessions to preview path distributions.
    """
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize simulator with experiment config.
        
        Args:
            config: Full experiment configuration dictionary
        """
        self.config = config
        self.is_hierarchical = "phases" in config and config.get("phases")
        self.phases = config.get("phases", []) if self.is_hierarchical else []
        self.stages = config.get("stages", [])
        
        self.visibility_engine = VisibilityEngine()
    
    def simulate(
        self,
        participant_count: int,
        variable_distributions: Dict[str, Dict[str, Any]],
    ) -> SimulationResult:
        """
        Run simulation for multiple participants.
        
        Args:
            participant_count: Number of participants to simulate
            variable_distributions: Distribution config for each variable
            
        Returns:
            SimulationResult with aggregated path distributions
        """
        # Create fresh counters for this simulation batch
        counters = InMemoryCounters()
        sequencer = SimulationSequencer(counters)
        
        # Track all simulated paths
        simulated_paths: List[SimulatedPath] = []
        
        # Track generated variable values for summary
        variable_summary: Dict[str, Counter] = {}
        
        for i in range(participant_count):
            # Generate participant context based on variable distributions
            context = self._generate_participant_context(i, variable_distributions)
            
            # Track generated values
            for var_path, value in self._flatten_context(context):
                if var_path not in variable_summary:
                    variable_summary[var_path] = Counter()
                variable_summary[var_path][str(value)] += 1
            
            # Generate unique session ID for randomization
            session_id = f"sim_{i}"
            randomization_seed = hash(session_id) % (2**32)
            
            # Compute path for this participant
            path, assignments = self._compute_path(
                sequencer=sequencer,
                session_id=session_id,
                context=context,
                randomization_seed=randomization_seed,
            )
            
            simulated_paths.append(SimulatedPath(
                participant_index=i,
                path=path,
                assignments=assignments,
                context=context,
            ))
        
        # Aggregate results
        path_distributions = self._aggregate_paths(simulated_paths, participant_count)
        
        # Convert variable summary to serializable format
        var_summary_dict = {
            var: dict(counts) for var, counts in variable_summary.items()
        }
        
        return SimulationResult(
            total_participants=participant_count,
            path_distributions=path_distributions,
            variable_summary=var_summary_dict,
        )
    
    def _generate_participant_context(
        self,
        participant_index: int,
        variable_distributions: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Generate a participant context based on variable distributions"""
        context = {
            "session": {},
            "participant": {},
            "url_params": {},
            "scores": {},
            "assignments": {},
        }
        
        rng = random.Random(participant_index * 12345)
        
        for var_path, dist_config in variable_distributions.items():
            value = self._generate_value(dist_config, rng)
            
            # Parse path and set in context
            parts = var_path.split(".")
            if len(parts) >= 2:
                prefix = parts[0]
                
                if prefix == "participant":
                    field = ".".join(parts[1:])
                    self._set_nested(context["participant"], parts[1:], value)
                elif prefix in ("session", "responses"):
                    self._set_nested(context["session"], parts[1:], value)
                elif prefix == "scores":
                    self._set_nested(context["scores"], parts[1:], value)
                elif prefix == "url_params" or prefix == "url":
                    context["url_params"][parts[1]] = value
                elif prefix == "assignments":
                    context["assignments"][parts[1]] = value
                elif prefix == "pick_assigns":
                    # Pick assigns are handled differently - store for condition evaluation
                    if "_pick_assigns" not in context:
                        context["_pick_assigns"] = {}
                    context["_pick_assigns"][parts[1]] = value
                else:
                    # Assume it's a stage reference
                    self._set_nested(context["session"], parts, value)
        
        return context
    
    def _generate_value(
        self,
        dist_config: Dict[str, Any],
        rng: random.Random,
    ) -> Any:
        """Generate a value based on distribution config"""
        var_type = dist_config.get("type", "categorical")
        
        if var_type == "categorical":
            distribution = dist_config.get("distribution", {})
            if distribution:
                options = list(distribution.keys())
                weights = list(distribution.values())
                return rng.choices(options, weights=weights)[0]
            options = dist_config.get("options", [])
            if options:
                return rng.choice(options)
            return None
        
        elif var_type == "numeric":
            min_val = dist_config.get("min", 0)
            max_val = dist_config.get("max", 100)
            distribution = dist_config.get("distribution", "uniform")
            
            if distribution == "uniform":
                return rng.uniform(min_val, max_val)
            elif distribution == "normal":
                mean = (min_val + max_val) / 2
                std = (max_val - min_val) / 6  # 99.7% within range
                value = rng.gauss(mean, std)
                return max(min_val, min(max_val, value))
            else:
                return rng.uniform(min_val, max_val)
        
        elif var_type == "boolean":
            true_prob = dist_config.get("truePercentage", 0.5)
            return rng.random() < true_prob
        
        return None
    
    def _set_nested(self, obj: Dict, path_parts: List[str], value: Any) -> None:
        """Set a nested value in a dictionary"""
        for part in path_parts[:-1]:
            if part not in obj:
                obj[part] = {}
            obj = obj[part]
        if path_parts:
            obj[path_parts[-1]] = value
    
    def _flatten_context(self, context: Dict[str, Any], prefix: str = "") -> List[Tuple[str, Any]]:
        """Flatten context dict to list of (path, value) tuples"""
        result = []
        for key, value in context.items():
            full_key = f"{prefix}.{key}" if prefix else key
            if isinstance(value, dict):
                result.extend(self._flatten_context(value, full_key))
            else:
                result.append((full_key, value))
        return result
    
    def _compute_path(
        self,
        sequencer: SimulationSequencer,
        session_id: str,
        context: Dict[str, Any],
        randomization_seed: int,
    ) -> Tuple[List[str], Dict[str, str]]:
        """Compute the path for a single simulated participant"""
        if self.is_hierarchical:
            return self._compute_hierarchical_path(
                sequencer, session_id, context, randomization_seed
            )
        else:
            return self._compute_flat_path(
                sequencer, session_id, context, randomization_seed
            )
    
    def _compute_hierarchical_path(
        self,
        sequencer: SimulationSequencer,
        session_id: str,
        context: Dict[str, Any],
        randomization_seed: int,
    ) -> Tuple[List[str], Dict[str, str]]:
        """Compute path for hierarchical experiment"""
        visible_ids = []
        assignments: Dict[str, str] = {}
        pick_assignments: Dict[str, List[Any]] = {}
        
        for phase in self.phases:
            phase_id = phase.get("id")
            phase_rules = phase.get("rules") or {}
            
            # Check phase visibility
            phase_rule = phase_rules.get("visibility") or phase.get("visibility_rule")
            if not self.visibility_engine.evaluate(phase_rule or "true", context):
                continue
            
            stages = phase.get("stages", [])
            
            # Apply pick_count if specified
            rules_config = self._dict_to_rules_config(phase_rules)
            if rules_config and rules_config.pick_count is not None:
                picked_stages, picked_ids, _, new_assigns = sequencer.pick_children(
                    children=[{"id": s.get("id"), **s} for s in stages],
                    rules=rules_config,
                    session_id=session_id,
                    level_id=phase_id,
                    randomization_seed=randomization_seed,
                    pick_assignments=pick_assignments,
                )
                
                if picked_ids:
                    assignments[f"{phase_id}_picks"] = ",".join(picked_ids)
                
                if new_assigns:
                    self._accumulate_pick_assignments(pick_assignments, new_assigns)
                
                stages = picked_stages
            
            # Apply ordering
            ordering = phase_rules.get("ordering", "sequential")
            if ordering in ["balanced", "weighted", "latin_square", "randomized"]:
                ordered, assigned_id, _ = sequencer.get_ordered_children(
                    children=[{"id": s.get("id"), **s} for s in stages],
                    rules=rules_config,
                    session_id=session_id,
                    level_id=phase_id,
                    randomization_seed=randomization_seed,
                )
                if assigned_id:
                    assignments[phase_id] = assigned_id
                stages = ordered
            
            # Process stages
            for stage in stages:
                stage_id = stage.get("id")
                stage_rules = stage.get("rules") or {}
                
                stage_rule = stage_rules.get("visibility") or stage.get("visibility_rule")
                if not self.visibility_engine.evaluate(stage_rule or "true", context):
                    continue
                
                blocks = stage.get("blocks", [])
                if blocks:
                    visible_ids.extend(self._process_blocks(
                        blocks, stage_id, context, sequencer, session_id,
                        randomization_seed, assignments, pick_assignments
                    ))
                else:
                    if stage.get("type"):
                        visible_ids.append(stage_id)
        
        return visible_ids, assignments
    
    def _compute_flat_path(
        self,
        sequencer: SimulationSequencer,
        session_id: str,
        context: Dict[str, Any],
        randomization_seed: int,
    ) -> Tuple[List[str], Dict[str, str]]:
        """Compute path for flat (legacy) experiment"""
        visible_ids = []
        assignments: Dict[str, str] = {}
        
        for stage in self.stages:
            stage_id = stage.get("id")
            stage_rules = stage.get("rules") or {}
            
            visibility = stage_rules.get("visibility") or stage.get("visibility_rule")
            if not self.visibility_engine.evaluate(visibility or "true", context):
                continue
            
            visible_ids.append(stage_id)
        
        return visible_ids, assignments
    
    def _process_blocks(
        self,
        blocks: List[Dict],
        stage_id: str,
        context: Dict[str, Any],
        sequencer: SimulationSequencer,
        session_id: str,
        randomization_seed: int,
        assignments: Dict[str, str],
        pick_assignments: Dict[str, List[Any]],
    ) -> List[str]:
        """Process blocks within a stage"""
        visible_ids = []
        stage_rules = {}
        
        # Find the stage to get its rules
        for phase in self.phases:
            for stage in phase.get("stages", []):
                if stage.get("id") == stage_id:
                    stage_rules = stage.get("rules") or {}
                    break
        
        # Get rules config for pick_count and ordering
        rules_config = self._dict_to_rules_config(stage_rules)
        
        # Step 1: Apply pick_count for blocks if specified
        if rules_config and rules_config.pick_count is not None:
            picked_blocks, picked_ids, _, new_assigns = sequencer.pick_children(
                children=[{"id": b.get("id"), **b} for b in blocks],
                rules=rules_config,
                session_id=session_id,
                level_id=stage_id,
                randomization_seed=randomization_seed,
                pick_assignments=pick_assignments,
            )
            
            if picked_ids:
                assignments[f"{stage_id}_picks"] = ",".join(picked_ids)
            
            if new_assigns:
                self._accumulate_pick_assignments(pick_assignments, new_assigns)
            
            blocks = picked_blocks
        
        # Step 2: Apply ordering to blocks
        # Note: For blocks, we want to ORDER all items, not SELECT one.
        # balanced/weighted/latin_square should all return ALL blocks in a counterbalanced order.
        ordering = stage_rules.get("ordering", "sequential")
        
        if ordering in ["balanced", "latin_square"]:
            # Use latin_square to get counterbalanced ordering of ALL blocks
            # "balanced" for ordering means counterbalanced order (same as latin_square)
            latin_square_rules = self._dict_to_rules_config({"ordering": "latin_square"})
            ordered, assigned_id, _ = sequencer.get_ordered_children(
                children=[{"id": b.get("id"), **b} for b in blocks],
                rules=latin_square_rules,
                session_id=session_id,
                level_id=f"{stage_id}_blocks",
                existing_assignment=assignments.get(f"{stage_id}_blocks"),
                randomization_seed=randomization_seed,
            )
            if assigned_id:
                assignments[f"{stage_id}_blocks"] = assigned_id
            blocks = ordered
        elif ordering == "weighted":
            # Use weighted shuffle: order ALL blocks by weighted probability
            ordering_rules_config = rules_config or self._dict_to_rules_config(stage_rules)
            ordered, assigned_id, _ = sequencer.get_weighted_order_all(
                children=[{"id": b.get("id"), **b} for b in blocks],
                rules=ordering_rules_config,
                session_id=session_id,
                level_id=f"{stage_id}_blocks",
                existing_assignment=assignments.get(f"{stage_id}_blocks"),
                randomization_seed=randomization_seed,
            )
            if assigned_id:
                assignments[f"{stage_id}_blocks"] = assigned_id
            blocks = ordered
        elif ordering in ["randomized", "random"]:
            # Support both "randomized" (official) and "random" (common alias)
            ordered, _, _ = sequencer.get_ordered_children(
                children=[{"id": b.get("id"), **b} for b in blocks],
                rules=self._dict_to_rules_config({"ordering": "randomized"}),
                session_id=session_id,
                level_id=f"{stage_id}_blocks",
                randomization_seed=randomization_seed,
            )
            blocks = ordered
        
        for block in blocks:
            block_id = block.get("id")
            block_rules = block.get("rules") or {}
            
            block_rule = block_rules.get("visibility") or block.get("visibility_rule")
            if not self.visibility_engine.evaluate(block_rule or "true", context):
                continue
            
            tasks = block.get("tasks", [])
            if tasks:
                block_rules_config = self._dict_to_rules_config(block_rules)
                if block_rules_config and block_rules_config.pick_count is not None:
                    picked_tasks, picked_ids, _, new_assigns = sequencer.pick_children(
                        children=[{"id": t.get("id"), **t} for t in tasks],
                        rules=block_rules_config,
                        session_id=session_id,
                        level_id=block_id,
                        randomization_seed=randomization_seed,
                        pick_assignments=pick_assignments,
                    )
                    
                    if picked_ids:
                        assignments[f"{block_id}_picks"] = ",".join(picked_ids)
                    
                    if new_assigns:
                        self._accumulate_pick_assignments(pick_assignments, new_assigns)
                    
                    tasks = picked_tasks
                
                for task in tasks:
                    task_id = task.get("id")
                    task_rules = task.get("rules") or {}
                    task_rule = task_rules.get("visibility") or task.get("visibility_rule")
                    
                    if self.visibility_engine.evaluate(task_rule or "true", context):
                        visible_ids.append(task_id)
            else:
                if block.get("type"):
                    visible_ids.append(block_id)
        
        return visible_ids
    
    def _dict_to_rules_config(self, rules_dict: Dict) -> Optional[RulesConfig]:
        """Convert dict to RulesConfig model"""
        if not rules_dict:
            return None
        
        try:
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
            
            pick_strategy = rules_dict.get("pick_strategy", "random")
            if isinstance(pick_strategy, str):
                pick_strategy = PickStrategy(pick_strategy)
            
            pick_weights = None
            if rules_dict.get("pick_weights"):
                pick_weights = [
                    WeightConfig(id=w.get("id"), value=w.get("value", 1))
                    for w in rules_dict["pick_weights"]
                ]
            
            pick_conditions = None
            if rules_dict.get("pick_conditions"):
                pick_conditions = []
                for cond in rules_dict["pick_conditions"]:
                    variable = cond.get("variable")
                    if not variable:
                        continue
                    operator = cond.get("operator", "not_in")
                    if isinstance(operator, str):
                        try:
                            operator = PickConditionOperator(operator)
                        except ValueError:
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
    
    def _accumulate_pick_assignments(
        self,
        accumulated: Dict[str, List[Any]],
        new_assigns: Dict[str, Any],
    ) -> None:
        """Accumulate new assignments into the accumulated dict"""
        if not new_assigns:
            return
        
        for key, values in new_assigns.items():
            if key not in accumulated:
                accumulated[key] = []
            if isinstance(values, list):
                accumulated[key].extend(values)
            else:
                accumulated[key].append(values)
    
    def _aggregate_paths(
        self,
        simulated_paths: List[SimulatedPath],
        total_count: int,
    ) -> List[PathDistribution]:
        """Aggregate simulated paths into distributions"""
        path_counts: Dict[str, Tuple[int, SimulatedPath]] = {}
        
        for sim_path in simulated_paths:
            key = sim_path.path_key()
            if key in path_counts:
                count, sample = path_counts[key]
                path_counts[key] = (count + 1, sample)
            else:
                path_counts[key] = (1, sim_path)
        
        distributions = []
        for key, (count, sample) in sorted(path_counts.items(), key=lambda x: -x[1][0]):
            distributions.append(PathDistribution(
                unique_path=sample.path,
                count=count,
                percentage=(count / total_count) * 100,
                sample_assignments=sample.assignments,
            ))
        
        return distributions

