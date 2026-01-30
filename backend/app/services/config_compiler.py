"""
Configuration compiler and validator for experiment YAML
"""
from typing import Dict, List, Any, Optional
import yaml
import logging
import os

from app.core.config import settings

logger = logging.getLogger(__name__)

# Required fields for different stage types
STAGE_TYPE_REQUIREMENTS = {
    "user_info": ["fields"],
    "participant_identity": ["fields"],  # Identity fields for participant label
    "questionnaire": ["questions"],
    "content_display": [],  # content or content_file or content_asset_id
    "video_player": ["source"],
    "iframe_sandbox": ["source"],
    "likert_scale": [],  # range or likert_options - handled specially
    "consent_form": [],
    "attention_check": ["questions"],
    "external_task": ["target_url"],  # URL of external application
    "multiple_choice": ["question", "answers"],  # Question with answer options
}

VALID_STAGE_TYPES = set(STAGE_TYPE_REQUIREMENTS.keys())


def validate_experiment_config(config: Dict[str, Any]) -> List[str]:
    """
    Validate experiment configuration.
    Supports both:
    - New 4-level hierarchy: phases > stages > blocks > tasks
    - Legacy flat structure: stages
    
    Returns a list of error messages (empty if valid).
    """
    errors = []
    
    # Check meta section
    if "meta" not in config:
        errors.append("Missing 'meta' section")
    else:
        meta = config["meta"]
        if "id" not in meta:
            errors.append("Missing 'meta.id' (experiment ID)")
    
    # Check for either phases (4-level) or stages (legacy)
    has_phases = "phases" in config and isinstance(config["phases"], list) and len(config["phases"]) > 0
    has_stages = "stages" in config and isinstance(config["stages"], list) and len(config["stages"]) > 0
    
    if not has_phases and not has_stages:
        errors.append("Missing 'phases' or 'stages' section - experiment needs at least one")
        return errors
    
    # Track all IDs for uniqueness and reference validation
    all_ids = set()
    referenced_ids = set()
    
    if has_phases:
        # Validate 4-level hierarchy
        errors.extend(validate_phases(config["phases"], all_ids, referenced_ids))
    else:
        # Legacy flat stages validation
        stages = config["stages"]
        for i, stage in enumerate(stages):
            stage_errors = validate_stage(stage, i, all_ids, referenced_ids)
            errors.extend(stage_errors)
            if "id" in stage:
                all_ids.add(stage["id"])
        
        # Validate visibility rules syntax
        for stage in stages:
            if "visibility_rule" in stage:
                rule_errors = validate_visibility_rule(stage["visibility_rule"], all_ids)
                errors.extend(rule_errors)
    
    # Check that all referenced IDs exist
    for ref_id in referenced_ids:
        if ref_id not in all_ids:
            errors.append(f"Referenced ID '{ref_id}' does not exist")
    
    return errors


def validate_phases(phases: List[Dict[str, Any]], all_ids: set, referenced_ids: set) -> List[str]:
    """Validate 4-level hierarchy phases"""
    errors = []
    
    for i, phase in enumerate(phases):
        prefix = f"Phase[{i}]"
        
        # Check phase required fields
        if "id" not in phase:
            errors.append(f"{prefix}: Missing 'id'")
        elif phase["id"] in all_ids:
            errors.append(f"{prefix}: Duplicate ID '{phase['id']}'")
        else:
            all_ids.add(phase["id"])
        
        # Check for stages in phase
        if "stages" not in phase or not isinstance(phase.get("stages"), list):
            errors.append(f"{prefix}: Missing 'stages' list")
            continue
        
        if len(phase["stages"]) == 0:
            errors.append(f"{prefix}: Phase must have at least one stage")
            continue
        
        # Validate stages in phase
        for j, stage in enumerate(phase["stages"]):
            stage_prefix = f"{prefix}.Stage[{j}]"
            errors.extend(validate_hierarchy_stage(stage, stage_prefix, all_ids, referenced_ids))
    
    return errors


def validate_hierarchy_stage(stage: Dict[str, Any], prefix: str, all_ids: set, referenced_ids: set) -> List[str]:
    """Validate a stage in the 4-level hierarchy (may contain blocks)"""
    errors = []
    
    # Check stage required fields
    if "id" not in stage:
        errors.append(f"{prefix}: Missing 'id'")
    elif stage["id"] in all_ids:
        errors.append(f"{prefix}: Duplicate ID '{stage['id']}'")
    else:
        all_ids.add(stage["id"])
    
    # Stage can have blocks (container) or be a direct task (with type)
    has_blocks = "blocks" in stage and isinstance(stage.get("blocks"), list) and len(stage.get("blocks", [])) > 0
    has_type = "type" in stage
    
    if has_blocks:
        # Container stage with blocks
        for k, block in enumerate(stage["blocks"]):
            block_prefix = f"{prefix}.Block[{k}]"
            errors.extend(validate_hierarchy_block(block, block_prefix, all_ids, referenced_ids))
    elif has_type:
        # Direct task stage (legacy style within hierarchy)
        if stage["type"] not in VALID_STAGE_TYPES:
            errors.append(f"{prefix}: Invalid type '{stage['type']}'. Valid types: {VALID_STAGE_TYPES}")
        else:
            errors.extend(validate_task_content(stage, prefix))
    else:
        # Stage needs either blocks or a type
        errors.append(f"{prefix}: Stage must have either 'blocks' or 'type'")
    
    return errors


def validate_hierarchy_block(block: Dict[str, Any], prefix: str, all_ids: set, referenced_ids: set) -> List[str]:
    """Validate a block in the 4-level hierarchy (contains tasks)"""
    errors = []
    
    # Check block required fields
    if "id" not in block:
        errors.append(f"{prefix}: Missing 'id'")
    elif block["id"] in all_ids:
        errors.append(f"{prefix}: Duplicate ID '{block['id']}'")
    else:
        all_ids.add(block["id"])
    
    # Block can have tasks (container) or be a direct task (with type)
    has_tasks = "tasks" in block and isinstance(block.get("tasks"), list) and len(block.get("tasks", [])) > 0
    has_type = "type" in block
    
    if has_tasks:
        # Container block with tasks
        for m, task in enumerate(block["tasks"]):
            task_prefix = f"{prefix}.Task[{m}]"
            errors.extend(validate_hierarchy_task(task, task_prefix, all_ids, referenced_ids))
    elif has_type:
        # Direct task block
        if block["type"] not in VALID_STAGE_TYPES:
            errors.append(f"{prefix}: Invalid type '{block['type']}'. Valid types: {VALID_STAGE_TYPES}")
        else:
            errors.extend(validate_task_content(block, prefix))
    else:
        # Block needs either tasks or a type
        errors.append(f"{prefix}: Block must have either 'tasks' or 'type'")
    
    return errors


def validate_hierarchy_task(task: Dict[str, Any], prefix: str, all_ids: set, referenced_ids: set) -> List[str]:
    """Validate a task (leaf node) in the 4-level hierarchy"""
    errors = []
    
    # Check task required fields
    if "id" not in task:
        errors.append(f"{prefix}: Missing 'id'")
    elif task["id"] in all_ids:
        errors.append(f"{prefix}: Duplicate ID '{task['id']}'")
    else:
        all_ids.add(task["id"])
    
    if "type" not in task:
        errors.append(f"{prefix}: Missing 'type'")
    elif task["type"] not in VALID_STAGE_TYPES:
        errors.append(f"{prefix}: Invalid type '{task['type']}'. Valid types: {VALID_STAGE_TYPES}")
    else:
        errors.extend(validate_task_content(task, prefix))
    
    # Track quota fallback references
    if "quota" in task and "fallback_stage" in task.get("quota", {}):
        referenced_ids.add(task["quota"]["fallback_stage"])
    
    return errors


def validate_task_content(task: Dict[str, Any], prefix: str) -> List[str]:
    """Validate task-specific content based on type"""
    errors = []
    stage_type = task.get("type")
    
    if not stage_type:
        return errors
    
    # Check type-specific requirements
    required_fields = STAGE_TYPE_REQUIREMENTS.get(stage_type, [])
    for field in required_fields:
        if field not in task:
            errors.append(f"{prefix}: Type '{stage_type}' requires '{field}'")
    
    # Special validation for content_display
    if stage_type == "content_display":
        has_content = any(key in task for key in ["content", "content_file", "content_asset_id"])
        if not has_content:
            errors.append(f"{prefix}: content_display requires 'content', 'content_file', or 'content_asset_id'")
    
    # Special validation for likert_scale - requires either range or likert_options
    if stage_type == "likert_scale":
        has_scale_config = "range" in task or "likert_options" in task
        if not has_scale_config:
            errors.append(f"{prefix}: likert_scale requires either 'range' or 'likert_options'")
    
    # Validate questions if present
    if "questions" in task:
        for j, question in enumerate(task["questions"]):
            q_errors = validate_question(question, f"{prefix}.questions[{j}]")
            errors.extend(q_errors)
    
    # Validate user_info fields if present
    if "fields" in task:
        for j, field in enumerate(task["fields"]):
            f_errors = validate_user_info_field(field, f"{prefix}.fields[{j}]")
            errors.extend(f_errors)
    
    # Validate multiple_choice answers if present
    if "answers" in task:
        for j, answer in enumerate(task["answers"]):
            a_errors = validate_multiple_choice_answer(answer, f"{prefix}.answers[{j}]")
            errors.extend(a_errors)
    
    return errors


def validate_stage(
    stage: Dict[str, Any],
    index: int,
    existing_ids: set,
    referenced_ids: set,
) -> List[str]:
    """Validate a single stage configuration (legacy flat structure)"""
    errors = []
    prefix = f"Stage[{index}]"
    
    # Check required fields
    if "id" not in stage:
        errors.append(f"{prefix}: Missing 'id'")
    elif stage["id"] in existing_ids:
        errors.append(f"{prefix}: Duplicate stage ID '{stage['id']}'")
    
    if "type" not in stage:
        errors.append(f"{prefix}: Missing 'type'")
    elif stage["type"] not in VALID_STAGE_TYPES:
        errors.append(f"{prefix}: Invalid type '{stage['type']}'. Valid types: {VALID_STAGE_TYPES}")
    else:
        # Use the shared task content validation
        errors.extend(validate_task_content(stage, prefix))
    
    # Track quota fallback references
    if "quota" in stage and "fallback_stage" in stage.get("quota", {}):
        referenced_ids.add(stage["quota"]["fallback_stage"])
    
    # Validate substages recursively
    if "substages" in stage:
        for j, substage in enumerate(stage["substages"]):
            sub_errors = validate_stage(substage, j, existing_ids, referenced_ids)
            errors.extend([f"{prefix}.substages.{e}" for e in sub_errors])
            if "id" in substage:
                existing_ids.add(substage["id"])
    
    return errors


def validate_question(question: Dict[str, Any], prefix: str) -> List[str]:
    """Validate a question configuration"""
    errors = []
    
    if "id" not in question:
        errors.append(f"{prefix}: Missing 'id'")
    
    if "text" not in question:
        errors.append(f"{prefix}: Missing 'text'")
    
    if "type" not in question:
        errors.append(f"{prefix}: Missing 'type'")
    else:
        q_type = question["type"]
        # Types that require options
        if q_type in ("select", "radio", "checkbox") and "options" not in question:
            errors.append(f"{prefix}: Type '{q_type}' requires 'options'")
        
        # Likert scale requires either range or likert_options
        if q_type == "likert_scale" and "range" not in question and "likert_options" not in question:
            errors.append(f"{prefix}: Type 'likert_scale' requires either 'range' or 'likert_options'")
    
    # Validate options if present
    if "options" in question:
        for i, opt in enumerate(question["options"]):
            if "value" not in opt:
                errors.append(f"{prefix}.options[{i}]: Missing 'value'")
            if "label" not in opt:
                errors.append(f"{prefix}.options[{i}]: Missing 'label'")
    
    return errors


def validate_user_info_field(field: Dict[str, Any], prefix: str) -> List[str]:
    """Validate a user_info field configuration"""
    errors = []
    
    if "field" not in field:
        errors.append(f"{prefix}: Missing 'field'")
    
    # Label can be empty (uses placeholder instead) - just needs to exist or have placeholder
    # Removed: if "label" not in field: errors.append(...)
    
    if "type" not in field:
        errors.append(f"{prefix}: Missing 'type'")
    else:
        f_type = field["type"]
        # Header and consent types don't need options
        if f_type == "select" and "options" not in field:
            errors.append(f"{prefix}: Type 'select' requires 'options'")
    
    return errors


def validate_multiple_choice_answer(answer: Dict[str, Any], prefix: str) -> List[str]:
    """Validate a multiple_choice answer configuration"""
    errors = []
    
    if "id" not in answer:
        errors.append(f"{prefix}: Missing 'id'")
    
    if "content" not in answer:
        errors.append(f"{prefix}: Missing 'content'")
    
    # Type is optional, defaults to 'text'
    if "type" in answer:
        valid_types = {"text", "image", "text_with_image", "html", "free_text"}
        if answer["type"] not in valid_types:
            errors.append(f"{prefix}: Invalid type '{answer['type']}'. Valid types: {valid_types}")
        
        # Image types require image_url
        if answer["type"] in ("image", "text_with_image") and "image_url" not in answer:
            errors.append(f"{prefix}: Type '{answer['type']}' requires 'image_url'")
    
    # Validate badges if present
    if "badges" in answer:
        valid_colors = {"green", "blue", "yellow", "red", "gray"}
        for i, badge in enumerate(answer["badges"]):
            if "text" not in badge:
                errors.append(f"{prefix}.badges[{i}]: Missing 'text'")
            if "color" in badge and badge["color"] not in valid_colors:
                errors.append(f"{prefix}.badges[{i}]: Invalid color '{badge['color']}'. Valid colors: {valid_colors}")
    
    return errors


def validate_visibility_rule(rule: str, stage_ids: set) -> List[str]:
    """Validate visibility rule syntax (basic check)"""
    errors = []
    
    # Basic syntax check - just ensure it's not empty and has balanced quotes
    if not rule or not isinstance(rule, str):
        return errors
    
    # Check for obviously broken syntax
    if rule.count("'") % 2 != 0:
        errors.append(f"Visibility rule has unbalanced quotes: {rule}")
    if rule.count('"') % 2 != 0:
        errors.append(f"Visibility rule has unbalanced quotes: {rule}")
    
    return errors


async def flatten_template(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flatten template inheritance for publishing.
    Resolves 'extends' references and inlines all inherited content.
    """
    if "meta" not in config or "extends" not in config["meta"]:
        return config
    
    template_path = config["meta"]["extends"]
    
    # Load template (from themes directory or experiment templates)
    template_config = await load_template(template_path)
    
    if template_config is None:
        logger.warning(f"Template not found: {template_path}")
        return config
    
    # Recursively flatten the template first
    template_config = await flatten_template(template_config)
    
    # Merge configurations (config overrides template)
    flattened = deep_merge(template_config, config)
    
    return flattened


async def load_template(template_path: str) -> Optional[Dict[str, Any]]:
    """Load a template YAML file"""
    # Check themes directory first
    themes_path = os.path.join(os.path.dirname(__file__), "..", "..", "themes", template_path)
    
    if os.path.exists(themes_path):
        with open(themes_path, "r") as f:
            return yaml.safe_load(f)
    
    # Check experiments directory
    experiments_path = os.path.join(os.path.dirname(__file__), "..", "..", "experiments", template_path)
    
    if os.path.exists(experiments_path):
        with open(experiments_path, "r") as f:
            return yaml.safe_load(f)
    
    return None


def deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Deep merge two dictionaries, with override taking precedence"""
    result = base.copy()
    
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    
    return result


def interpolate_variables(
    config: Dict[str, Any],
    public_vars: Dict[str, Any],
    session_vars: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Interpolate variables in configuration.
    Only PUBLIC.* and SESSION.* variables are processed for client config.
    SERVER.* variables are stripped (never sent to client).
    """
    def process_value(value: Any) -> Any:
        if isinstance(value, str):
            # Replace ${PUBLIC.*} variables
            for var_name, var_value in public_vars.items():
                placeholder = f"${{PUBLIC.{var_name}}}"
                value = value.replace(placeholder, str(var_value))
            
            # Replace ${SESSION.*} variables
            for var_name, var_value in session_vars.items():
                placeholder = f"${{SESSION.{var_name}}}"
                value = value.replace(placeholder, str(var_value))
            
            return value
        elif isinstance(value, dict):
            return {k: process_value(v) for k, v in value.items()}
        elif isinstance(value, list):
            return [process_value(item) for item in value]
        else:
            return value
    
    # Process the config but remove server_config sections
    result = process_value(config)
    
    # Remove server-only sections
    if isinstance(result, dict):
        result.pop("server_variables", None)
        if "stages" in result:
            for stage in result["stages"]:
                if isinstance(stage, dict):
                    stage.pop("server_config", None)
    
    return result

