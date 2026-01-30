"""
Sequencer service for ordering children at each hierarchy level.

Supports:
- Sequential: Fixed order (1, 2, 3...)
- Randomized: Seeded shuffle per participant
- Balanced: Least-filled algorithm for equal groups
- Weighted: Probability-based assignment
- Latin Square: Order counterbalancing
"""
import random
import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.experiment import (
    OrderingMode, 
    RulesConfig, 
    WeightConfig, 
    PickStrategy,
    PickCondition,
    PickConditionOperator,
)

logger = logging.getLogger(__name__)


class Sequencer:
    """
    Handles ordering and assignment of children at each hierarchy level.
    Also handles picking a subset of children (pick N out of M).
    """
    
    def __init__(self, db: Optional[AsyncIOMotorDatabase] = None):
        self.db = db
        self._counters_collection = "distribution_counters" if db is not None else None
        self._pick_counters_collection = "pick_counters" if db is not None else None
    
    async def get_ordered_children(
        self,
        children: List[Dict[str, Any]],
        rules: Optional[RulesConfig],
        session_id: str,
        level_id: str,
        existing_assignment: Optional[str] = None,
        randomization_seed: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
        """
        Get ordered list of children based on rules.
        
        Returns:
            Tuple of (ordered_children, assigned_child_id, reason)
            - For balanced/weighted: returns single-item list with assigned child
            - For sequential/randomized: returns full ordered list
        """
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
            return await self._balanced_select(children, level_id, rules)
        
        elif mode == OrderingMode.WEIGHTED:
            return self._weighted_select(children, rules, session_id, randomization_seed)
        
        elif mode == OrderingMode.LATIN_SQUARE:
            return await self._latin_square_select(children, level_id, session_id, randomization_seed)
        
        # Default to sequential
        return children, None, "Default sequential ordering"
    
    async def pick_children(
        self,
        children: List[Dict[str, Any]],
        rules: Optional[RulesConfig],
        session_id: str,
        level_id: str,
        existing_picks: Optional[List[str]] = None,
        randomization_seed: Optional[int] = None,
        pick_assignments: Optional[Dict[str, List[Any]]] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[List[str]], Optional[str], Optional[Dict[str, Any]]]:
        """
        Pick a subset of children based on rules.pick_count and rules.pick_strategy.
        
        Args:
            children: List of child items to pick from
            rules: Rules configuration with pick_count and pick_strategy
            session_id: Session identifier for deterministic picking
            level_id: Level identifier for round-robin tracking
            existing_picks: Previously picked child IDs (for consistency)
            randomization_seed: Seed for deterministic random operations
            pick_assignments: Accumulated variable assignments from previous picks
        
        Returns:
            Tuple of (picked_children, picked_ids, reason, new_assignments)
            - picked_children: List of picked child items
            - picked_ids: List of picked child IDs
            - reason: Explanation of pick result
            - new_assignments: Dict of variable assignments from picked children
        """
        if not children:
            return [], None, "No children to pick from", None
        
        if not rules or rules.pick_count is None:
            # No pick_count, return all with their pick_assigns accumulated
            all_assigns = self._collect_pick_assigns(children)
            return children, None, "No pick_count specified, using all children", all_assigns
        
        pick_count = rules.pick_count
        
        # Validate pick_count
        if pick_count <= 0:
            all_assigns = self._collect_pick_assigns(children)
            return children, None, "pick_count must be positive, using all children", all_assigns
        
        # If there are existing picks for this level, restore them
        if existing_picks:
            logger.info(f"Found existing picks for level {level_id}: {existing_picks}")
            picked = [c for c in children if c.get("id") in existing_picks]
            if len(picked) == pick_count:
                assigns = self._collect_pick_assigns(picked)
                logger.info(f"Restored {len(picked)} picks: {existing_picks}")
                return picked, existing_picks, f"Restored previous picks: {existing_picks}", assigns
            else:
                logger.info(f"Existing picks count mismatch: {len(picked)} != {pick_count}, will re-pick")
        
        # Filter candidates by pick_conditions
        candidates = children
        if rules.pick_conditions and pick_assignments is not None:
            logger.info(f"Applying pick_conditions: {[(c.variable, c.operator.value) for c in rules.pick_conditions]}")
            logger.info(f"Current pick_assignments: {pick_assignments}")
            candidates = self._filter_by_conditions(children, rules.pick_conditions, pick_assignments)
            logger.info(f"Filtered {len(children)} -> {len(candidates)} candidates by conditions")
            
            if not candidates:
                # No candidates satisfy conditions - return empty
                logger.info(f"No candidates satisfy pick_conditions, returning empty")
                return [], [], "No candidates satisfy pick_conditions", None
        
        # After filtering, check if we have enough candidates
        if pick_count >= len(candidates):
            picked_ids = [c.get("id") for c in candidates]
            assigns = self._collect_pick_assigns(candidates)
            return candidates, picked_ids, f"pick_count ({pick_count}) >= filtered candidates ({len(candidates)}), using all", assigns
        
        strategy = rules.pick_strategy or PickStrategy.RANDOM
        
        if strategy == PickStrategy.RANDOM:
            picked, picked_ids, reason = self._pick_random(candidates, pick_count, session_id, randomization_seed)
        
        elif strategy == PickStrategy.ROUND_ROBIN:
            picked, picked_ids, reason = await self._pick_round_robin(candidates, pick_count, level_id)
        
        elif strategy == PickStrategy.WEIGHTED_RANDOM:
            picked, picked_ids, reason = self._pick_weighted_random(candidates, pick_count, rules, session_id, randomization_seed)
        
        else:
            # Default to random
            picked, picked_ids, reason = self._pick_random(candidates, pick_count, session_id, randomization_seed)
        
        # Collect pick_assigns from picked children
        assigns = self._collect_pick_assigns(picked)
        
        logger.info(f"Pick result for {level_id}: picked_ids={picked_ids}, assigns={assigns}")
        return picked, picked_ids, reason, assigns
    
    def _filter_by_conditions(
        self,
        children: List[Dict[str, Any]],
        conditions: List[PickCondition],
        pick_assignments: Dict[str, List[Any]],
    ) -> List[Dict[str, Any]]:
        """
        Filter children based on pick conditions.
        
        Each condition checks if a child's pick_assigns[variable] satisfies
        the condition against accumulated pick_assignments[variable].
        
        If a child doesn't have pick_assigns directly, we look at its nested
        children (tasks inside blocks, blocks inside stages, etc.) to aggregate
        pick_assigns values.
        """
        if not conditions:
            return children
        
        logger.info(f"[_filter_by_conditions] Filtering {len(children)} children with {len(conditions)} conditions")
        logger.info(f"[_filter_by_conditions] Accumulated pick_assignments: {pick_assignments}")
        
        filtered = []
        
        for child in children:
            child_id = child.get("id", "unknown")
            child_label = child.get("label", child_id)
            
            # Get pick_assigns from child, or aggregate from nested children
            child_assigns = self._get_effective_pick_assigns(child)
            logger.info(f"[_filter_by_conditions] Child '{child_label}' ({child_id}) effective pick_assigns: {child_assigns}")
            
            passes_all = True
            
            for condition in conditions:
                variable = condition.variable
                operator = condition.operator
                
                # Get child's value(s) for this variable
                child_values = child_assigns.get(variable, [])
                
                # Get accumulated values for this variable
                accumulated_values = pick_assignments.get(variable, [])
                
                # If child doesn't have this variable at all, skip this condition
                if not child_values:
                    logger.info(f"[_filter_by_conditions]   - Condition {variable} {operator}: child has no value, skipping")
                    continue
                
                # Evaluate condition against ALL values from child (in case of aggregation)
                for child_value in child_values:
                    if operator in (PickConditionOperator.NOT_IN, PickConditionOperator.NOT_EQUAL):
                        # Child's value must NOT be in accumulated values
                        if child_value in accumulated_values:
                            logger.info(f"[_filter_by_conditions]   - Condition {variable} {operator}: FAILED - '{child_value}' is in {accumulated_values}")
                            passes_all = False
                            break
                        else:
                            logger.info(f"[_filter_by_conditions]   - Condition {variable} {operator}: PASSED - '{child_value}' not in {accumulated_values}")
                    
                    elif operator in (PickConditionOperator.IN, PickConditionOperator.EQUAL):
                        # Child's value must BE in accumulated values
                        if child_value not in accumulated_values:
                            logger.info(f"[_filter_by_conditions]   - Condition {variable} {operator}: FAILED - '{child_value}' not in {accumulated_values}")
                            passes_all = False
                            break
                        else:
                            logger.info(f"[_filter_by_conditions]   - Condition {variable} {operator}: PASSED - '{child_value}' in {accumulated_values}")
                
                if not passes_all:
                    break
            
            if passes_all:
                logger.info(f"[_filter_by_conditions] -> Child '{child_label}' PASSES filter")
                filtered.append(child)
            else:
                logger.info(f"[_filter_by_conditions] -> Child '{child_label}' EXCLUDED by filter")
        
        logger.info(f"[_filter_by_conditions] Result: {len(filtered)} children passed filter")
        return filtered
    
    def _get_effective_pick_assigns(self, item: Dict[str, Any]) -> Dict[str, List[Any]]:
        """
        Get effective pick_assigns for an item.
        
        If the item has pick_assigns directly, use those.
        Otherwise, aggregate pick_assigns from nested children (tasks, blocks).
        
        Returns a dict where each key maps to a LIST of values (for aggregation).
        """
        result: Dict[str, List[Any]] = {}
        
        # First, check direct pick_assigns
        direct_assigns = item.get("pick_assigns")
        if direct_assigns:
            for key, value in direct_assigns.items():
                result[key] = [value]
            return result
        
        # If no direct pick_assigns, aggregate from children
        # Check for tasks (inside blocks)
        tasks = item.get("tasks", [])
        for task in tasks:
            task_assigns = task.get("pick_assigns")
            if task_assigns:
                for key, value in task_assigns.items():
                    if key not in result:
                        result[key] = []
                    if value not in result[key]:
                        result[key].append(value)
        
        # Check for blocks (inside stages)
        blocks = item.get("blocks", [])
        for block in blocks:
            # Recursively get effective assigns from blocks
            block_assigns = self._get_effective_pick_assigns(block)
            for key, values in block_assigns.items():
                if key not in result:
                    result[key] = []
                for value in values:
                    if value not in result[key]:
                        result[key].append(value)
        
        return result
    
    def _collect_pick_assigns(
        self,
        children: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """
        Collect pick_assigns from all children into a single dict.
        Values are accumulated into lists.
        """
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
    
    def _pick_random(
        self,
        children: List[Dict[str, Any]],
        pick_count: int,
        session_id: str,
        seed: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], List[str], str]:
        """Pick children randomly using deterministic seed"""
        if seed is None:
            seed = hash(session_id) % (2**32)
        
        rng = random.Random(seed)
        
        # Sample without replacement
        picked = rng.sample(children, pick_count)
        picked_ids = [c.get("id") for c in picked]
        
        reason = f"Random pick: selected {pick_count} of {len(children)} children, ids={picked_ids}"
        return picked, picked_ids, reason
    
    async def _pick_round_robin(
        self,
        children: List[Dict[str, Any]],
        pick_count: int,
        level_id: str,
    ) -> Tuple[List[Dict[str, Any]], List[str], str]:
        """
        Pick children using round-robin across participants.
        Uses database counters to track which combination to use next.
        """
        from itertools import combinations
        
        # Generate all possible combinations of pick_count items
        child_ids = [c.get("id") for c in children]
        all_combinations = list(combinations(range(len(children)), pick_count))
        num_combinations = len(all_combinations)
        
        if self.db is None:
            # No database - fall back to first combination
            combo = all_combinations[0]
            picked = [children[i] for i in combo]
            picked_ids = [picked_child.get("id") for picked_child in picked]
            return picked, picked_ids, f"Round-robin (no DB): first combination, ids={picked_ids}"
        
        try:
            counters_col = self.db[self._pick_counters_collection]
            
            # Atomic get-and-increment counter
            doc = await counters_col.find_one_and_update(
                {"level_id": f"{level_id}_pick_rr", "type": "round_robin"},
                {
                    "$inc": {"counter": 1},
                    "$set": {"last_updated": datetime.utcnow()},
                    "$setOnInsert": {
                        "level_id": f"{level_id}_pick_rr",
                        "type": "round_robin",
                        "created_at": datetime.utcnow(),
                    }
                },
                upsert=True,
                return_document=True,
            )
            
            # Get counter and wrap around
            counter = (doc.get("counter", 1) - 1) % num_combinations
            combo = all_combinations[counter]
            
            picked = [children[i] for i in combo]
            picked_ids = [picked_child.get("id") for picked_child in picked]
            
            reason = f"Round-robin: combination {counter + 1} of {num_combinations}, ids={picked_ids}"
            return picked, picked_ids, reason
            
        except Exception as e:
            logger.error(f"Error in round-robin pick: {e}")
            combo = all_combinations[0]
            picked = [children[i] for i in combo]
            picked_ids = [picked_child.get("id") for picked_child in picked]
            return picked, picked_ids, f"Round-robin (error fallback): {e}"
    
    def _pick_weighted_random(
        self,
        children: List[Dict[str, Any]],
        pick_count: int,
        rules: RulesConfig,
        session_id: str,
        seed: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], List[str], str]:
        """
        Pick children using weighted random selection.
        Higher weight = higher probability of being picked.
        """
        # Build weight map
        weights = {}
        if rules.pick_weights:
            for w in rules.pick_weights:
                weights[w.id] = w.value
        
        # Assign default weight of 1 to children without explicit weights
        for child in children:
            child_id = child.get("id")
            if child_id not in weights:
                weights[child_id] = 1
        
        # Use deterministic random
        if seed is None:
            seed = hash(session_id) % (2**32)
        rng = random.Random(seed)
        
        # Weighted sampling without replacement
        remaining = children.copy()
        picked = []
        
        for _ in range(pick_count):
            if not remaining:
                break
            
            # Calculate total weight of remaining items
            total_weight = sum(weights.get(c.get("id"), 1) for c in remaining)
            
            # Generate random roll
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
        reason = f"Weighted random pick: selected {pick_count} of {len(children)}, weights={weights}, ids={picked_ids}"
        
        return picked, picked_ids, reason
    
    def _randomize(
        self,
        children: List[Dict[str, Any]],
        session_id: str,
        seed: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Randomize children order using a deterministic seed"""
        # Use provided seed or generate from session_id
        if seed is None:
            seed = hash(session_id) % (2**32)
        
        shuffled = children.copy()
        rng = random.Random(seed)
        rng.shuffle(shuffled)
        
        return shuffled
    
    async def _balanced_select(
        self,
        children: List[Dict[str, Any]],
        level_id: str,
        rules: RulesConfig,
    ) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
        """
        Select child using least-filled (balanced) algorithm.
        Returns single-item list with the assigned child.
        """
        if self.db is None:
            # No database - fall back to random selection
            selected = random.choice(children)
            return [selected], selected.get("id"), "Balanced (no DB, random fallback)"
        
        try:
            counters_col = self.db[self._counters_collection]
            
            # Get current counts for all children
            child_ids = [c.get("id") for c in children]
            counts = {}
            
            for child_id in child_ids:
                doc = await counters_col.find_one({
                    "level_id": level_id,
                    "child_id": child_id,
                })
                counts[child_id] = doc.get("started_count", 0) if doc else 0
            
            # Find minimum count
            min_count = min(counts.values())
            candidates = [cid for cid, count in counts.items() if count == min_count]
            
            # Random selection among tied candidates
            selected_id = random.choice(candidates)
            
            # Atomic increment counter
            count_field = "started_count" if rules.balance_on.value == "started" else "completed_count"
            await counters_col.find_one_and_update(
                {"level_id": level_id, "child_id": selected_id},
                {
                    "$inc": {count_field: 1},
                    "$set": {"last_updated": datetime.utcnow()},
                    "$setOnInsert": {
                        "level_id": level_id,
                        "child_id": selected_id,
                        "created_at": datetime.utcnow(),
                    }
                },
                upsert=True,
            )
            
            selected = next((c for c in children if c.get("id") == selected_id), children[0])
            reason = f"Balanced: counts={counts}, selected={selected_id} (min={min_count})"
            
            return [selected], selected_id, reason
            
        except Exception as e:
            logger.error(f"Error in balanced selection: {e}")
            selected = random.choice(children)
            return [selected], selected.get("id"), f"Balanced (error fallback): {e}"
    
    def _weighted_select(
        self,
        children: List[Dict[str, Any]],
        rules: RulesConfig,
        session_id: str,
        seed: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
        """
        Select child using weighted probability.
        Returns single-item list with the assigned child.
        """
        # Build weight map
        weights = {}
        if rules.weights:
            for w in rules.weights:
                weights[w.id] = w.value
        
        # Assign default weight of 1 to children without explicit weights
        for child in children:
            child_id = child.get("id")
            if child_id not in weights:
                weights[child_id] = 1
        
        # Calculate total weight
        total_weight = sum(weights.get(c.get("id"), 1) for c in children)
        
        # Use deterministic random
        if seed is None:
            seed = hash(session_id) % (2**32)
        rng = random.Random(seed)
        
        # Generate random number and select
        roll = rng.randint(1, total_weight)
        cumulative = 0
        
        for child in children:
            child_id = child.get("id")
            cumulative += weights.get(child_id, 1)
            if roll <= cumulative:
                reason = f"Weighted: roll={roll}, total={total_weight}, assigned={child_id}"
                return [child], child_id, reason
        
        # Fallback (shouldn't reach here)
        selected = children[-1]
        return [selected], selected.get("id"), "Weighted (fallback to last)"
    
    async def get_weighted_order_all(
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
        
        This is different from _weighted_select which returns only ONE child.
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
            # Add any children not in the assignment (in case of config changes)
            for child in children:
                if child not in ordered:
                    ordered.append(child)
            if len(ordered) == len(children):
                return ordered, existing_assignment, f"Restored previous weighted order: {existing_assignment}"
        
        # Build weight map
        weights = {}
        if rules and rules.weights:
            for w in rules.weights:
                weights[w.id] = w.value
        
        # Assign default weight of 1 to children without explicit weights
        for child in children:
            child_id = child.get("id")
            if child_id not in weights:
                weights[child_id] = 1
        
        # Use deterministic random
        if randomization_seed is None:
            randomization_seed = hash(session_id) % (2**32)
        rng = random.Random(randomization_seed)
        
        # Weighted shuffle: repeatedly pick from remaining items weighted by probability
        remaining = children.copy()
        ordered = []
        
        while remaining:
            if len(remaining) == 1:
                ordered.append(remaining[0])
                break
            
            # Calculate total weight of remaining items
            total_weight = sum(weights.get(c.get("id"), 1) for c in remaining)
            
            # Generate random roll
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
        reason = f"Weighted order: weights={weights}, order={order_ids}"
        
        return ordered, assignment, reason
    
    async def _latin_square_select(
        self,
        children: List[Dict[str, Any]],
        level_id: str,
        session_id: str,
        seed: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
        """
        Select order using Latin Square counterbalancing.
        Returns full ordered list (all children, but in a specific order).
        """
        n = len(children)
        if n == 0:
            return [], None, "No children for Latin Square"
        
        # Generate Latin Square orderings
        orderings = self._generate_latin_square(n)
        
        if self.db is None:
            # No database - select random ordering
            if seed is None:
                seed = hash(session_id) % (2**32)
            rng = random.Random(seed)
            order_idx = rng.randint(0, len(orderings) - 1)
        else:
            # Use balanced selection for which ordering to use
            order_idx = await self._get_balanced_latin_square_index(level_id, len(orderings))
        
        # Apply ordering
        ordering = orderings[order_idx]
        ordered_children = [children[i] for i in ordering]
        order_ids = [c.get("id") for c in ordered_children]
        
        reason = f"Latin Square: order {order_idx + 1} of {len(orderings)}, sequence={order_ids}"
        
        # Return the order as comma-separated IDs for the assignment
        assignment = ",".join(order_ids)
        
        return ordered_children, assignment, reason
    
    def _generate_latin_square(self, n: int) -> List[List[int]]:
        """Generate a Latin Square of size n (first row method)"""
        if n <= 0:
            return []
        
        # Simple Latin Square: each row is a rotation of the first
        square = []
        for i in range(n):
            row = [(i + j) % n for j in range(n)]
            square.append(row)
        
        return square
    
    async def _get_balanced_latin_square_index(self, level_id: str, num_orderings: int) -> int:
        """Get the next balanced index for Latin Square ordering"""
        if self.db is None:
            return 0
        
        try:
            counters_col = self.db[self._counters_collection]
            
            # Get counts for each ordering
            counts = []
            for i in range(num_orderings):
                doc = await counters_col.find_one({
                    "level_id": f"{level_id}_ls",
                    "child_id": str(i),
                })
                counts.append(doc.get("started_count", 0) if doc else 0)
            
            # Find minimum count
            min_count = min(counts)
            candidates = [i for i, count in enumerate(counts) if count == min_count]
            
            # Random selection among tied
            selected_idx = random.choice(candidates)
            
            # Increment counter
            await counters_col.find_one_and_update(
                {"level_id": f"{level_id}_ls", "child_id": str(selected_idx)},
                {
                    "$inc": {"started_count": 1},
                    "$set": {"last_updated": datetime.utcnow()},
                    "$setOnInsert": {
                        "level_id": f"{level_id}_ls",
                        "child_id": str(selected_idx),
                        "created_at": datetime.utcnow(),
                    }
                },
                upsert=True,
            )
            
            return selected_idx
            
        except Exception as e:
            logger.error(f"Error getting Latin Square index: {e}")
            return 0
    
    async def increment_completed_count(
        self,
        level_id: str,
        child_id: str,
    ) -> None:
        """
        Increment the completed count for a child (called when participant finishes).
        Used for balance_on: completed mode.
        """
        if self.db is None:
            return
        
        try:
            counters_col = self.db[self._counters_collection]
            await counters_col.find_one_and_update(
                {"level_id": level_id, "child_id": child_id},
                {
                    "$inc": {"completed_count": 1},
                    "$set": {"last_updated": datetime.utcnow()},
                },
            )
        except Exception as e:
            logger.error(f"Error incrementing completed count: {e}")
    
    async def decrement_started_count(
        self,
        level_id: str,
        child_id: str,
    ) -> None:
        """
        Decrement the started count (for timeout cleanup).
        Called when a participant abandons before completing.
        """
        if self.db is None:
            return
        
        try:
            counters_col = self.db[self._counters_collection]
            await counters_col.find_one_and_update(
                {"level_id": level_id, "child_id": child_id},
                {
                    "$inc": {"started_count": -1},
                    "$set": {"last_updated": datetime.utcnow()},
                },
            )
        except Exception as e:
            logger.error(f"Error decrementing started count: {e}")
    
    async def get_distribution_stats(
        self,
        level_id: str,
    ) -> Dict[str, Dict[str, int]]:
        """
        Get distribution statistics for a level (for debugging/monitoring).
        """
        if self.db is None:
            return {}
        
        try:
            counters_col = self.db[self._counters_collection]
            cursor = counters_col.find({"level_id": level_id})
            
            stats = {}
            async for doc in cursor:
                child_id = doc.get("child_id")
                stats[child_id] = {
                    "started": doc.get("started_count", 0),
                    "completed": doc.get("completed_count", 0),
                }
            
            return stats
            
        except Exception as e:
            logger.error(f"Error getting distribution stats: {e}")
            return {}
    
    async def reset_counters(
        self,
        level_id: str,
    ) -> None:
        """Reset all counters for a level (for experiment restart)"""
        if self.db is None:
            return
        
        try:
            counters_col = self.db[self._counters_collection]
            await counters_col.delete_many({"level_id": level_id})
            # Also delete Latin Square counters
            await counters_col.delete_many({"level_id": f"{level_id}_ls"})
        except Exception as e:
            logger.error(f"Error resetting counters: {e}")

