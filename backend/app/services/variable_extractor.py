"""
Variable Extractor - Extracts all variables referenced in experiment visibility rules and pick conditions.

Used by the path simulator to determine which variables need distributions for simulation.
"""
import re
from typing import Dict, List, Any, Optional, Set
from dataclasses import dataclass, field
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class VariableType(str, Enum):
    """Type of extracted variable"""
    CATEGORICAL = "categorical"
    NUMERIC = "numeric"
    BOOLEAN = "boolean"
    UNKNOWN = "unknown"


@dataclass
class ExtractedVariable:
    """Represents a variable extracted from visibility rules or pick conditions"""
    path: str  # Full path like "participant.gender" or "session.questionnaire_1.score"
    var_type: VariableType = VariableType.UNKNOWN
    options: Optional[List[str]] = None  # For categorical variables
    min_value: Optional[float] = None  # For numeric variables
    max_value: Optional[float] = None  # For numeric variables
    source: str = "visibility_rule"  # Where this variable was found
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response"""
        result = {
            "path": self.path,
            "type": self.var_type.value,
            "source": self.source,
        }
        if self.options:
            result["options"] = self.options
        if self.min_value is not None:
            result["min"] = self.min_value
        if self.max_value is not None:
            result["max"] = self.max_value
        return result


class VariableExtractor:
    """
    Extracts all variables referenced in experiment configuration.
    
    Scans:
    - Visibility rules at all hierarchy levels (phases, stages, blocks, tasks)
    - Pick conditions for pick_count features
    - Can also extract field definitions from user_info stages to enrich type info
    """
    
    # Patterns for extracting variable references from visibility expressions
    # Matches: participant.field, session.stage.field, responses.stage.field, scores.name, assignments.level
    VARIABLE_PATTERNS = [
        r'participant\.(\w+(?:\.\w+)*)',  # participant.gender, participant.demographics.age
        r'session\.(\w+(?:\.\w+)*)',  # session.stage_id.field
        r'responses\.(\w+(?:\.\w+)*)',  # responses.stage_id.field
        r'scores\.(\w+(?:\.\w+)*)',  # scores.depression_score
        r'assignments\.(\w+(?:\.\w+)*)',  # assignments.level_id
        r'url_params\.(\w+)',  # url_params.condition
        r'url\.(\w+)',  # url.condition (alias)
    ]
    
    # Pattern to match direct stage references (stage_id.field)
    # This is trickier - we need to know valid stage IDs to distinguish from other patterns
    STAGE_FIELD_PATTERN = r'(\w+)\.(\w+)'
    
    # Pattern to extract comparison values (for inferring options)
    COMPARISON_PATTERN = r'(["\'])([^"\']+)\1'  # Matches 'value' or "value"
    NUMERIC_COMPARISON_PATTERN = r'([<>=!]+)\s*(\d+(?:\.\d+)?)'  # Matches > 50, == 100, etc.
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize extractor with experiment config.
        
        Args:
            config: Full experiment configuration dictionary
        """
        self.config = config
        self.is_hierarchical = "phases" in config and config.get("phases")
        
        # Collect all stage/block/task IDs for reference validation
        self.all_item_ids: Set[str] = set()
        self._collect_all_ids()
        
        # Collect field definitions from user_info stages
        self.field_definitions: Dict[str, Dict[str, Any]] = {}
        self._collect_field_definitions()
    
    def _collect_all_ids(self) -> None:
        """Collect all item IDs from the config for stage reference detection"""
        if self.is_hierarchical:
            for phase in self.config.get("phases", []):
                self.all_item_ids.add(phase.get("id", ""))
                for stage in phase.get("stages", []):
                    self.all_item_ids.add(stage.get("id", ""))
                    for block in stage.get("blocks", []):
                        self.all_item_ids.add(block.get("id", ""))
                        for task in block.get("tasks", []):
                            self.all_item_ids.add(task.get("id", ""))
        else:
            for stage in self.config.get("stages", []):
                self.all_item_ids.add(stage.get("id", ""))
    
    def _collect_field_definitions(self) -> None:
        """Collect field definitions from user_info stages for type inference"""
        def process_item(item: Dict[str, Any]) -> None:
            if item.get("type") == "user_info":
                item_id = item.get("id", "")
                for field_def in item.get("fields", []):
                    field_name = field_def.get("field", "")
                    if field_name:
                        # Store with multiple possible paths
                        paths = [
                            f"participant.{field_name}",
                            f"session.{item_id}.{field_name}",
                            f"responses.{item_id}.{field_name}",
                            f"{item_id}.{field_name}",
                        ]
                        for path in paths:
                            self.field_definitions[path] = field_def
        
        if self.is_hierarchical:
            for phase in self.config.get("phases", []):
                for stage in phase.get("stages", []):
                    process_item(stage)
                    for block in stage.get("blocks", []):
                        process_item(block)
                        for task in block.get("tasks", []):
                            process_item(task)
        else:
            for stage in self.config.get("stages", []):
                process_item(stage)
    
    def extract_all(self) -> List[ExtractedVariable]:
        """
        Extract all variables from the experiment config.
        
        Returns:
            List of ExtractedVariable objects with type information
        """
        variables: Dict[str, ExtractedVariable] = {}
        
        # Extract from visibility rules
        self._extract_from_visibility_rules(variables)
        
        # Extract from pick conditions
        self._extract_from_pick_conditions(variables)
        
        # Enrich with field definitions
        self._enrich_with_field_definitions(variables)
        
        return list(variables.values())
    
    def _extract_from_visibility_rules(self, variables: Dict[str, ExtractedVariable]) -> None:
        """Extract variables from all visibility rules in the config"""
        
        def process_rules(rules: Optional[Dict[str, Any]], item: Dict[str, Any]) -> None:
            # Check for visibility in rules
            visibility = None
            if rules:
                visibility = rules.get("visibility")
            # Also check legacy visibility_rule
            if not visibility:
                visibility = item.get("visibility_rule")
            
            if visibility and isinstance(visibility, str):
                self._parse_visibility_expression(visibility, variables)
        
        if self.is_hierarchical:
            for phase in self.config.get("phases", []):
                process_rules(phase.get("rules"), phase)
                for stage in phase.get("stages", []):
                    process_rules(stage.get("rules"), stage)
                    for block in stage.get("blocks", []):
                        process_rules(block.get("rules"), block)
                        for task in block.get("tasks", []):
                            process_rules(task.get("rules"), task)
        else:
            for stage in self.config.get("stages", []):
                process_rules(stage.get("rules"), stage)
    
    def _extract_from_pick_conditions(self, variables: Dict[str, ExtractedVariable]) -> None:
        """Extract variables from pick_conditions in rules"""
        
        def process_pick_conditions(rules: Optional[Dict[str, Any]]) -> None:
            if not rules:
                return
            
            pick_conditions = rules.get("pick_conditions", [])
            for condition in pick_conditions:
                variable = condition.get("variable")
                if variable:
                    # Pick conditions reference pick_assigns variables
                    # These are typically simple names, not paths
                    path = f"pick_assigns.{variable}"
                    if path not in variables:
                        variables[path] = ExtractedVariable(
                            path=path,
                            var_type=VariableType.CATEGORICAL,
                            source="pick_condition",
                        )
        
        if self.is_hierarchical:
            for phase in self.config.get("phases", []):
                process_pick_conditions(phase.get("rules"))
                for stage in phase.get("stages", []):
                    process_pick_conditions(stage.get("rules"))
                    for block in stage.get("blocks", []):
                        process_pick_conditions(block.get("rules"))
                        for task in block.get("tasks", []):
                            process_pick_conditions(task.get("rules"))
        else:
            for stage in self.config.get("stages", []):
                process_pick_conditions(stage.get("rules"))
        
        # Also collect pick_assigns values to know the options
        self._collect_pick_assigns_options(variables)
    
    def _collect_pick_assigns_options(self, variables: Dict[str, ExtractedVariable]) -> None:
        """Collect all pick_assigns values from tasks to determine options"""
        pick_assigns_values: Dict[str, Set[str]] = {}
        
        def collect_from_item(item: Dict[str, Any]) -> None:
            pick_assigns = item.get("pick_assigns", {})
            for var_name, value in pick_assigns.items():
                if var_name not in pick_assigns_values:
                    pick_assigns_values[var_name] = set()
                pick_assigns_values[var_name].add(str(value))
        
        if self.is_hierarchical:
            for phase in self.config.get("phases", []):
                for stage in phase.get("stages", []):
                    collect_from_item(stage)
                    for block in stage.get("blocks", []):
                        collect_from_item(block)
                        for task in block.get("tasks", []):
                            collect_from_item(task)
        else:
            for stage in self.config.get("stages", []):
                collect_from_item(stage)
        
        # Update variables with collected options
        for var_name, values in pick_assigns_values.items():
            path = f"pick_assigns.{var_name}"
            if path in variables:
                variables[path].options = sorted(list(values))
    
    def _parse_visibility_expression(
        self, 
        expression: str, 
        variables: Dict[str, ExtractedVariable]
    ) -> None:
        """Parse a visibility expression and extract variable references"""
        
        # Try each pattern
        for pattern in self.VARIABLE_PATTERNS:
            for match in re.finditer(pattern, expression):
                prefix = pattern.split(r'\.')[0].replace('\\', '')
                suffix = match.group(1)
                full_path = f"{prefix}.{suffix}"
                
                if full_path not in variables:
                    var_type = self._infer_type_from_expression(expression, full_path)
                    options = self._extract_options_from_expression(expression, full_path)
                    
                    variables[full_path] = ExtractedVariable(
                        path=full_path,
                        var_type=var_type,
                        options=options,
                        source="visibility_rule",
                    )
                elif variables[full_path].options is None:
                    # Try to add options if we find more
                    options = self._extract_options_from_expression(expression, full_path)
                    if options:
                        if variables[full_path].options:
                            variables[full_path].options = list(
                                set(variables[full_path].options) | set(options)
                            )
                        else:
                            variables[full_path].options = options
        
        # Also try to match direct stage references
        for match in re.finditer(self.STAGE_FIELD_PATTERN, expression):
            potential_stage_id = match.group(1)
            field_name = match.group(2)
            
            # Check if this looks like a stage ID reference
            if potential_stage_id in self.all_item_ids:
                full_path = f"{potential_stage_id}.{field_name}"
                if full_path not in variables:
                    var_type = self._infer_type_from_expression(expression, full_path)
                    options = self._extract_options_from_expression(expression, full_path)
                    
                    variables[full_path] = ExtractedVariable(
                        path=full_path,
                        var_type=var_type,
                        options=options,
                        source="visibility_rule",
                    )
    
    def _infer_type_from_expression(self, expression: str, var_path: str) -> VariableType:
        """Infer variable type from how it's used in the expression"""
        # Check for numeric comparisons
        escaped_path = re.escape(var_path)
        numeric_pattern = rf'{escaped_path}\s*[<>=!]+\s*\d'
        if re.search(numeric_pattern, expression):
            return VariableType.NUMERIC
        
        # Check for boolean-like comparisons
        bool_pattern = rf'{escaped_path}\s*==\s*(true|false|True|False)'
        if re.search(bool_pattern, expression, re.IGNORECASE):
            return VariableType.BOOLEAN
        
        # Check for string comparisons (likely categorical)
        string_pattern = rf'{escaped_path}\s*==\s*["\']'
        if re.search(string_pattern, expression):
            return VariableType.CATEGORICAL
        
        # Check for 'in' operator (categorical)
        in_pattern = rf'{escaped_path}\s+in\s+\['
        if re.search(in_pattern, expression, re.IGNORECASE):
            return VariableType.CATEGORICAL
        
        return VariableType.UNKNOWN
    
    def _extract_options_from_expression(
        self, 
        expression: str, 
        var_path: str
    ) -> Optional[List[str]]:
        """Extract possible values for a categorical variable from the expression"""
        options: Set[str] = set()
        escaped_path = re.escape(var_path)
        
        # Match: var_path == 'value' or var_path == "value"
        eq_pattern = rf'{escaped_path}\s*==\s*["\']([^"\']+)["\']'
        for match in re.finditer(eq_pattern, expression):
            options.add(match.group(1))
        
        # Match: var_path != 'value' (the value is still a valid option)
        neq_pattern = rf'{escaped_path}\s*!=\s*["\']([^"\']+)["\']'
        for match in re.finditer(neq_pattern, expression):
            options.add(match.group(1))
        
        # Match: var_path in ['value1', 'value2']
        in_pattern = rf'{escaped_path}\s+in\s+\[([^\]]+)\]'
        for match in re.finditer(in_pattern, expression, re.IGNORECASE):
            array_content = match.group(1)
            for value_match in re.finditer(r'["\']([^"\']+)["\']', array_content):
                options.add(value_match.group(1))
        
        return sorted(list(options)) if options else None
    
    def _enrich_with_field_definitions(self, variables: Dict[str, ExtractedVariable]) -> None:
        """Enrich extracted variables with information from field definitions"""
        for path, var in variables.items():
            if path in self.field_definitions:
                field_def = self.field_definitions[path]
                
                # Infer type from field definition
                field_type = field_def.get("type", "")
                
                if field_type == "number":
                    var.var_type = VariableType.NUMERIC
                    var.min_value = field_def.get("min")
                    var.max_value = field_def.get("max")
                elif field_type == "select":
                    var.var_type = VariableType.CATEGORICAL
                    options = field_def.get("options", [])
                    if options:
                        var.options = [opt.get("value", "") for opt in options if opt.get("value")]
                elif field_type in ("checkbox", "consent"):
                    var.var_type = VariableType.BOOLEAN
                elif field_type == "text":
                    # Text fields are typically categorical if used in visibility
                    if var.var_type == VariableType.UNKNOWN:
                        var.var_type = VariableType.CATEGORICAL

