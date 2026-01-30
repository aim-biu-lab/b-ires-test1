"""
Visibility engine for evaluating conditional display rules.

Supports:
- Comparison operators: ==, !=, >, <, >=, <=
- Logical operators: &&, ||, !, AND, OR, NOT
- Array operators: contains, in, not_in
- Inheritance: parent visibility propagates to children
"""
from typing import Dict, Any, List, Optional
import re
import operator
import logging

logger = logging.getLogger(__name__)


class VisibilityEngine:
    """
    Evaluates visibility rules to determine if stages/blocks should be shown.
    
    Supports:
    - Simple comparison expressions
    - Logical operators (&&, ||, AND, OR, NOT)
    - Array operations (contains, in)
    - Inheritance from parent levels
    """
    
    # Supported comparison operators
    OPERATORS = {
        "==": operator.eq,
        "!=": operator.ne,
        ">": operator.gt,
        "<": operator.lt,
        ">=": operator.ge,
        "<=": operator.le,
    }
    
    # Array/collection operators
    ARRAY_OPERATORS = {"contains", "in", "not_in"}
    
    def evaluate(
        self,
        rule: str,
        context: Dict[str, Any],
        parent_visible: bool = True,
    ) -> bool:
        """
        Evaluate a visibility rule against the given context.
        
        Context should include:
        - session: Dict of stage_id -> {field: value} for collected data
        - url_params: Dict of URL query parameters
        - user_id: The user's ID
        - participant: Dict of participant demographic data
        - scores: Dict of computed scores
        - assignments: Dict of level_id -> assigned_child_id
        
        Args:
            rule: The visibility expression to evaluate
            context: Dictionary with session data and parameters
            parent_visible: Whether the parent level is visible (inheritance)
        
        Returns:
            True if the item should be visible, False otherwise
        """
        # Inheritance: if parent is not visible, children are not visible
        if not parent_visible:
            return False
        
        if not rule or not isinstance(rule, str):
            return True
        
        rule = rule.strip()
        
        # Handle literal true/false
        if rule.lower() == "true":
            return True
        if rule.lower() == "false":
            return False
        
        try:
            # Handle AND keyword (case insensitive)
            if " AND " in rule.upper():
                # Split on AND (case insensitive)
                parts = re.split(r'\s+AND\s+', rule, flags=re.IGNORECASE)
                return all(self.evaluate(part.strip(), context) for part in parts)
            
            # Handle OR keyword (case insensitive)
            if " OR " in rule.upper():
                parts = re.split(r'\s+OR\s+', rule, flags=re.IGNORECASE)
                return any(self.evaluate(part.strip(), context) for part in parts)
            
            # Handle && and || operators
            if " && " in rule:
                parts = rule.split(" && ")
                return all(self.evaluate(part.strip(), context) for part in parts)
            
            if " || " in rule:
                parts = rule.split(" || ")
                return any(self.evaluate(part.strip(), context) for part in parts)
            
            # Handle NOT/! operator
            if rule.upper().startswith("NOT "):
                return not self.evaluate(rule[4:].strip(), context)
            
            if rule.startswith("!"):
                return not self.evaluate(rule[1:].strip(), context)
            
            # Handle parentheses
            if rule.startswith("(") and rule.endswith(")"):
                return self.evaluate(rule[1:-1], context)
            
            # Handle array operators
            if " contains " in rule.lower():
                return self._evaluate_contains(rule, context)
            
            if " in " in rule.lower():
                return self._evaluate_in(rule, context)
            
            if " not_in " in rule.lower():
                return not self._evaluate_in(rule.replace("not_in", "in"), context)
            
            # Parse comparison expression
            return self._evaluate_comparison(rule, context)
            
        except Exception as e:
            logger.warning(f"Error evaluating visibility rule '{rule}': {e}")
            return True  # Default to visible on error
    
    def evaluate_with_inheritance(
        self,
        rules_chain: List[Optional[str]],
        context: Dict[str, Any],
    ) -> bool:
        """
        Evaluate a chain of rules with inheritance.
        
        Args:
            rules_chain: List of rules from parent to child 
                         (e.g., [phase_rule, stage_rule, block_rule, task_rule])
            context: Evaluation context
        
        Returns:
            True if all rules in chain pass
        """
        visible = True
        for rule in rules_chain:
            if rule:
                visible = self.evaluate(rule, context, parent_visible=visible)
            if not visible:
                return False
        return visible
    
    def _evaluate_comparison(self, expr: str, context: Dict[str, Any]) -> bool:
        """Evaluate a simple comparison expression"""
        # Find the operator
        for op_str, op_func in self.OPERATORS.items():
            if op_str in expr:
                parts = expr.split(op_str, 1)
                if len(parts) == 2:
                    left = self._resolve_value(parts[0].strip(), context)
                    right = self._resolve_value(parts[1].strip(), context)
                    
                    # Type coercion for comparison
                    left, right = self._coerce_types(left, right)
                    
                    try:
                        return op_func(left, right)
                    except TypeError:
                        return False
        
        # No operator found - treat as boolean check
        value = self._resolve_value(expr, context)
        return bool(value)
    
    def _evaluate_contains(self, expr: str, context: Dict[str, Any]) -> bool:
        """
        Evaluate 'contains' operator for array membership.
        Syntax: array_path contains value
        Example: "assignments.groups contains 'treatment'"
        """
        parts = re.split(r'\s+contains\s+', expr, flags=re.IGNORECASE)
        if len(parts) != 2:
            return False
        
        array_value = self._resolve_value(parts[0].strip(), context)
        check_value = self._resolve_value(parts[1].strip(), context)
        
        if isinstance(array_value, (list, tuple, set)):
            return check_value in array_value
        elif isinstance(array_value, str):
            # String contains
            return str(check_value) in array_value
        elif isinstance(array_value, dict):
            # Check if key exists in dict
            return str(check_value) in array_value
        
        return False
    
    def _evaluate_in(self, expr: str, context: Dict[str, Any]) -> bool:
        """
        Evaluate 'in' operator for checking if value is in array.
        Syntax: value in array_path
        Example: "participant.group in ['control', 'treatment']"
        """
        parts = re.split(r'\s+in\s+', expr, flags=re.IGNORECASE)
        if len(parts) != 2:
            return False
        
        check_value = self._resolve_value(parts[0].strip(), context)
        array_value = self._resolve_value(parts[1].strip(), context)
        
        # Handle inline array syntax like ['a', 'b', 'c']
        array_str = parts[1].strip()
        if array_str.startswith("[") and array_str.endswith("]"):
            try:
                import json
                array_value = json.loads(array_str.replace("'", '"'))
            except:
                pass
        
        if isinstance(array_value, (list, tuple, set)):
            return check_value in array_value
        elif isinstance(array_value, str):
            return str(check_value) in array_value
        
        return False
    
    def _resolve_value(self, token: str, context: Dict[str, Any]) -> Any:
        """Resolve a token to its actual value"""
        token = token.strip()
        
        # Handle string literals
        if (token.startswith("'") and token.endswith("'")) or \
           (token.startswith('"') and token.endswith('"')):
            return token[1:-1]
        
        # Handle numeric literals
        try:
            if "." in token:
                return float(token)
            return int(token)
        except ValueError:
            pass
        
        # Handle boolean literals
        if token.lower() == "true":
            return True
        if token.lower() == "false":
            return False
        if token.lower() == "null" or token.lower() == "none":
            return None
        
        # Handle context references
        return self._get_from_context(token, context)
    
    def _get_from_context(self, path: str, context: Dict[str, Any]) -> Any:
        """Get a value from context using dot notation path"""
        parts = path.split(".")
        
        if not parts:
            return None
        
        # Check for special prefixes
        first = parts[0].lower()
        first_original = parts[0]
        
        # URL parameters
        if first in ("url_params", "url"):
            return self._get_nested(context.get("url_params", {}), parts[1:])
        
        # Session/response data
        if first in ("session", "responses"):
            return self._get_nested(context.get("session", {}), parts[1:])
        
        # Participant demographics
        if first == "participant":
            return self._get_nested(context.get("participant", {}), parts[1:])
        
        # Computed scores
        if first == "scores":
            return self._get_nested(context.get("scores", {}), parts[1:])
        
        # Assignments (balanced/weighted)
        if first == "assignments":
            return self._get_nested(context.get("assignments", {}), parts[1:])
        
        # Environment info
        if first == "environment":
            return self._get_nested(context.get("environment", {}), parts[1:])
        
        # Default: treat first part as stage_id, look in session data
        session_data = context.get("session", {})
        
        if first_original in session_data:
            stage_data = session_data[first_original]
            if isinstance(stage_data, dict):
                return self._get_nested(stage_data, parts[1:])
            return stage_data
        
        # Also check participant data
        participant_data = context.get("participant", {})
        if first_original in participant_data:
            if len(parts) == 1:
                return participant_data[first_original]
            return self._get_nested(participant_data, parts)
        
        return None
    
    def _get_nested(self, data: Dict, path_parts: list) -> Any:
        """Get a nested value from a dictionary"""
        current = data
        
        for part in path_parts:
            if isinstance(current, dict):
                current = current.get(part)
            else:
                return None
            
            if current is None:
                return None
        
        return current
    
    def _coerce_types(self, left: Any, right: Any) -> tuple:
        """Coerce types for comparison"""
        # If one is a number and the other is a string that looks like a number
        if isinstance(left, (int, float)) and isinstance(right, str):
            try:
                right = float(right) if "." in right else int(right)
            except ValueError:
                pass
        
        if isinstance(right, (int, float)) and isinstance(left, str):
            try:
                left = float(left) if "." in left else int(left)
            except ValueError:
                pass
        
        # String comparison should be case-insensitive
        if isinstance(left, str) and isinstance(right, str):
            left = left.lower()
            right = right.lower()
        
        return left, right


