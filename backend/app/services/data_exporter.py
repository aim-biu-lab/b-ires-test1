"""
Data exporter for CSV and JSON export of experiment data
"""
from typing import Dict, List, Any, Optional, Set
import csv
import io
import json
import logging

logger = logging.getLogger(__name__)

# Fields to always exclude from export (truly redundant internal state)
ALWAYS_SKIP_FIELD_IDS = {"_submitted"}

# Field IDs that are disabled by default in export filters
DEFAULT_DISABLED_FIELD_IDS = {"selected_answers", "free_text_values"}

# Known field IDs produced by each stage type
STAGE_TYPE_FIELDS = {
    "multiple_choice": ["response", "selected_answers"],
    "likert_scale": ["response"],
    "consent_form": ["response"],
    "attention_check": ["response", "_passed", "_failed", "_attempts", "_attempts_to_pass", "_disqualified"],
    "external_task": ["_external_task_completed", "_external_task_completion_time", "_external_task_data",
                      "_external_task_timed_out", "_external_task_manual_complete", "_external_task_skipped"],
    "iframe_sandbox": ["_iframe_completed", "_iframe_completion_time", "_iframe_timed_out"],
    "video_player": ["_video_completed"],
}

# Enrichment field IDs (derived from config, not session data)
ENRICHMENT_FIELD_IDS = {"correct_answer", "is_correct"}


class DataExporter:
    """
    Exports experiment data in various formats.
    Supports wide format (1 row per participant) and long format (1 row per response).
    """
    
    def __init__(self, experiment_config: Dict[str, Any]):
        self.config = experiment_config
        self.is_hierarchical = "phases" in experiment_config and bool(experiment_config.get("phases"))
        
        # Get stages - handle both flat and hierarchical configs
        if self.is_hierarchical:
            self.stages = self._flatten_phases_to_stages(experiment_config.get("phases", []))
        else:
            self.stages = experiment_config.get("stages", [])
        
        self.stage_map = {s["id"]: s for s in self._flatten_all(self.stages)}
    
    def _flatten_phases_to_stages(self, phases: List[Dict]) -> List[Dict]:
        """Convert hierarchical phases to flat stage list"""
        result = []
        for phase in phases:
            for stage in phase.get("stages", []):
                stage_copy = dict(stage)
                stage_copy["_phase_id"] = phase.get("id")
                result.append(stage_copy)
        return result
    
    def _flatten_all(self, stages: List[Dict]) -> List[Dict]:
        """Flatten all levels: stages, substages, blocks, tasks"""
        result = []
        for stage in stages:
            # Add the stage itself if it has a type (renderable)
            if stage.get("type"):
                result.append(stage)
            
            # Legacy substages
            if "substages" in stage:
                result.extend(self._flatten_all(stage["substages"]))
            
            # Hierarchical blocks
            if "blocks" in stage:
                for block in stage["blocks"]:
                    if block.get("type"):
                        result.append(block)
                    # Tasks within blocks
                    if "tasks" in block:
                        for task in block["tasks"]:
                            if task.get("type"):
                                result.append(task)
        return result
    
    def _flatten_stages(self, stages: List[Dict]) -> List[Dict]:
        """Flatten nested stages (backward compatibility alias)"""
        return self._flatten_all(stages)
    
    def _should_skip_field(self, field_id: str) -> bool:
        """Check if a field should be always skipped (truly redundant internal state)."""
        return field_id in ALWAYS_SKIP_FIELD_IDS
    
    def _get_stage_correct_answer(self, stage_id: str) -> Optional[Any]:
        """Get the correct answer for a stage from its config, if defined."""
        stage = self.stage_map.get(stage_id)
        if not stage:
            return None
        
        stage_type = stage.get("type")
        
        if stage_type == "multiple_choice":
            config = stage.get("config", {})
            return config.get("correct_answer")
        elif stage_type == "attention_check":
            return stage.get("correct_answer")
        
        return None
    
    def _is_multiple_selection(self, stage_id: str) -> bool:
        """Check if a stage allows multiple selection."""
        stage = self.stage_map.get(stage_id)
        if not stage:
            return False
        config = stage.get("config", {})
        return config.get("allow_multiple_selection", False)
    
    def _check_is_correct(self, stage_id: str, selected_answers: Any) -> Optional[int]:
        """
        Check if the selected answers match the correct answer.
        Returns 1 (correct), 0 (incorrect), or None (no correct answer defined).
        """
        correct_answer = self._get_stage_correct_answer(stage_id)
        if correct_answer is None:
            return None
        
        # Normalize correct_answer to a set
        if isinstance(correct_answer, list):
            correct_set = set(correct_answer)
        else:
            correct_set = {str(correct_answer)}
        
        # Normalize selected_answers to a set
        if isinstance(selected_answers, list):
            selected_set = set(str(a) for a in selected_answers)
        elif selected_answers is not None:
            selected_set = {str(selected_answers)}
        else:
            selected_set = set()
        
        return 1 if selected_set == correct_set else 0
    
    def _format_selected_answers(self, stage_id: str, value: Any) -> Any:
        """
        Format selected_answers value. For single-select questions,
        convert the list to a single value.
        """
        if isinstance(value, list) and not self._is_multiple_selection(stage_id):
            return value[0] if value else ""
        return value
    
    def _discover_columns_from_data(
        self,
        sessions: List[Dict[str, Any]],
        stage_filter: Optional[List[str]] = None,
        excluded_field_ids: Optional[Set[str]] = None,
    ) -> List[str]:
        """
        Scan session data to discover all unique {stage_id}.{field_id} columns.
        Returns columns NOT already known from config, in stable order.
        """
        if excluded_field_ids is None:
            excluded_field_ids = set()
        
        seen = set()
        ordered = []
        
        for session in sessions:
            session_data = session.get("data", {})
            for stage_id, stage_data in session_data.items():
                if stage_filter and stage_id not in stage_filter:
                    continue
                if isinstance(stage_data, dict):
                    for field_id in stage_data.keys():
                        if self._should_skip_field(field_id):
                            continue
                        if field_id in excluded_field_ids:
                            continue
                        col_name = f"{stage_id}.{field_id}"
                        if col_name not in seen:
                            seen.add(col_name)
                            ordered.append(col_name)
        
        return ordered
    
    def get_available_columns(
        self,
        stage_filter: Optional[List[str]] = None,
        sessions: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get all available columns with metadata for the export filter UI.
        Returns a list of column descriptors with:
        - column: the full column name (e.g., "mc_question.response")
        - stage_id: the stage this column belongs to (None for base columns)
        - field_id: the field ID within the stage
        - category: "base", "data", or "enrichment"
        - default_enabled: whether this column should be enabled by default
        """
        columns = []
        known_columns = set()
        
        # Base columns (always available)
        for base_col in ["session_id", "user_id", "status", "created_at", "completed_at"]:
            columns.append({
                "column": base_col,
                "stage_id": None,
                "field_id": base_col,
                "category": "base",
                "default_enabled": True,
            })
        
        for stage in self._flatten_stages(self.stages):
            stage_id = stage.get("id")
            
            if stage_filter and stage_id not in stage_filter:
                continue
            
            stage_type = stage.get("type")
            correct_answer = self._get_stage_correct_answer(stage_id)
            
            # Get field_ids for this stage type
            field_ids = []
            
            if stage_type == "questionnaire":
                for q in stage.get("questions", []):
                    field_ids.append(q["id"])
            elif stage_type == "user_info":
                for f in stage.get("fields", []):
                    field_ids.append(f["field"])
            elif stage_type in STAGE_TYPE_FIELDS:
                field_ids = list(STAGE_TYPE_FIELDS[stage_type])
            else:
                # Unknown stage type - add a generic "response" field
                field_ids = ["response"]
            
            # Add data columns
            for field_id in field_ids:
                col_name = f"{stage_id}.{field_id}"
                known_columns.add(col_name)
                columns.append({
                    "column": col_name,
                    "stage_id": stage_id,
                    "field_id": field_id,
                    "category": "data",
                    "default_enabled": field_id not in DEFAULT_DISABLED_FIELD_IDS,
                })
            
            # Add enrichment columns if correct_answer is defined
            if correct_answer is not None:
                columns.append({
                    "column": f"{stage_id}.correct_answer",
                    "stage_id": stage_id,
                    "field_id": "correct_answer",
                    "category": "enrichment",
                    "default_enabled": False,
                })
                columns.append({
                    "column": f"{stage_id}.is_correct",
                    "stage_id": stage_id,
                    "field_id": "is_correct",
                    "category": "enrichment",
                    "default_enabled": False,
                })
        
        # If session data is provided, discover additional columns not in config
        if sessions:
            discovered = self._discover_columns_from_data(sessions, stage_filter)
            for col_name in discovered:
                if col_name not in known_columns:
                    parts = col_name.split(".", 1)
                    if len(parts) == 2:
                        columns.append({
                            "column": col_name,
                            "stage_id": parts[0],
                            "field_id": parts[1],
                            "category": "data",
                            "default_enabled": parts[1] not in DEFAULT_DISABLED_FIELD_IDS,
                        })
        
        return columns
    
    def to_wide_csv(
        self,
        sessions: List[Dict[str, Any]],
        stage_filter: Optional[List[str]] = None,
        excluded_field_ids: Optional[Set[str]] = None,
        include_correct_answer: bool = False,
        include_is_correct: bool = False,
    ) -> str:
        """
        Export data in wide format (1 row per participant).
        Columns: session_id, user_id, status, created_at, completed_at, [stage_field columns]
        
        Columns are determined from both config metadata AND actual session data,
        so all stage types (including external_task, iframe, etc.) are covered.
        """
        if not sessions:
            return ""
        
        if excluded_field_ids is None:
            excluded_field_ids = set()
        
        # Determine columns from stage configurations
        base_columns = ["session_id", "user_id", "status", "created_at", "completed_at"]
        field_columns = []
        config_columns_set = set()
        
        for stage in self._flatten_stages(self.stages):
            stage_id = stage.get("id")
            
            if stage_filter and stage_id not in stage_filter:
                continue
            
            stage_type = stage.get("type")
            correct_answer = self._get_stage_correct_answer(stage_id)
            
            if stage_type == "questionnaire":
                for q in stage.get("questions", []):
                    field_id = q["id"]
                    if field_id not in excluded_field_ids:
                        col = f"{stage_id}.{field_id}"
                        field_columns.append(col)
                        config_columns_set.add(col)
                    if include_correct_answer and correct_answer is not None and "correct_answer" not in excluded_field_ids:
                        col = f"{stage_id}.{field_id}.correct_answer"
                        field_columns.append(col)
                        config_columns_set.add(col)
                    if include_is_correct and correct_answer is not None and "is_correct" not in excluded_field_ids:
                        col = f"{stage_id}.{field_id}.is_correct"
                        field_columns.append(col)
                        config_columns_set.add(col)
            
            elif stage_type == "user_info":
                for f in stage.get("fields", []):
                    field_id = f["field"]
                    if field_id not in excluded_field_ids:
                        col = f"{stage_id}.{field_id}"
                        field_columns.append(col)
                        config_columns_set.add(col)
            
            elif stage_type in STAGE_TYPE_FIELDS:
                for field_id in STAGE_TYPE_FIELDS[stage_type]:
                    if field_id not in excluded_field_ids:
                        col = f"{stage_id}.{field_id}"
                        field_columns.append(col)
                        config_columns_set.add(col)
                
                # Add enrichment columns for stages with correct_answer
                if correct_answer is not None:
                    if include_correct_answer and "correct_answer" not in excluded_field_ids:
                        col = f"{stage_id}.correct_answer"
                        field_columns.append(col)
                        config_columns_set.add(col)
                    if include_is_correct and "is_correct" not in excluded_field_ids:
                        col = f"{stage_id}.is_correct"
                        field_columns.append(col)
                        config_columns_set.add(col)
            
            else:
                # Fallback for unknown types - add response if it's not excluded
                if "response" not in excluded_field_ids:
                    col = f"{stage_id}.response"
                    field_columns.append(col)
                    config_columns_set.add(col)
        
        # Discover additional columns from session data not covered by config
        discovered = self._discover_columns_from_data(sessions, stage_filter, excluded_field_ids)
        for col_name in discovered:
            if col_name not in config_columns_set:
                field_columns.append(col_name)
        
        columns = base_columns + field_columns
        columns_set = set(columns)
        
        # Build rows
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        
        for session in sessions:
            row = {
                "session_id": session.get("session_id"),
                "user_id": session.get("user_id"),
                "status": session.get("status"),
                "created_at": session.get("created_at", "").isoformat() if session.get("created_at") else "",
                "completed_at": session.get("completed_at", "").isoformat() if session.get("completed_at") else "",
            }
            
            # Fill in data fields
            session_data = session.get("data", {})
            
            for stage_id, stage_data in session_data.items():
                if stage_filter and stage_id not in stage_filter:
                    continue
                
                correct_answer = self._get_stage_correct_answer(stage_id)
                
                if isinstance(stage_data, dict):
                    for field_id, value in stage_data.items():
                        if self._should_skip_field(field_id):
                            continue
                        if field_id in excluded_field_ids:
                            continue
                        
                        col_name = f"{stage_id}.{field_id}"
                        if col_name in columns_set:
                            # Format selected_answers for single-select
                            if field_id == "selected_answers":
                                value = self._format_selected_answers(stage_id, value)
                            row[col_name] = self._format_value(value)
                    
                    # Add enrichment columns
                    if correct_answer is not None:
                        answer_value = stage_data.get("selected_answers") or stage_data.get("selected_answer") or stage_data.get("response")
                        
                        if include_correct_answer and "correct_answer" not in excluded_field_ids:
                            ca_col = f"{stage_id}.correct_answer"
                            if ca_col in columns_set:
                                formatted_ca = correct_answer
                                if isinstance(formatted_ca, list) and len(formatted_ca) == 1:
                                    formatted_ca = formatted_ca[0]
                                row[ca_col] = self._format_value(formatted_ca)
                        
                        if include_is_correct and "is_correct" not in excluded_field_ids:
                            ic_col = f"{stage_id}.is_correct"
                            if ic_col in columns_set:
                                row[ic_col] = self._check_is_correct(stage_id, answer_value)
                else:
                    if "response" not in excluded_field_ids:
                        col_name = f"{stage_id}.response"
                        if col_name in columns_set:
                            row[col_name] = self._format_value(stage_data)
            
            writer.writerow(row)
        
        return output.getvalue()
    
    def to_long_csv(
        self,
        sessions: List[Dict[str, Any]],
        stage_filter: Optional[List[str]] = None,
        excluded_field_ids: Optional[Set[str]] = None,
        include_correct_answer: bool = False,
        include_is_correct: bool = False,
    ) -> str:
        """
        Export data in long format (1 row per response).
        Columns: session_id, user_id, stage_id, field_id, value,
                 [correct_answer], [is_correct], completed_at
        
        correct_answer and is_correct are added as extra columns (not rows)
        so each response row has the answer alongside it for easy counting.
        """
        if excluded_field_ids is None:
            excluded_field_ids = set()
        
        output = io.StringIO()
        csv_columns = ["session_id", "user_id", "stage_id", "field_id", "value"]
        if include_correct_answer:
            csv_columns.append("correct_answer")
        if include_is_correct:
            csv_columns.append("is_correct")
        csv_columns.append("completed_at")
        
        writer = csv.DictWriter(output, fieldnames=csv_columns)
        writer.writeheader()
        
        for session in sessions:
            session_id = session.get("session_id")
            user_id = session.get("user_id")
            session_data = session.get("data", {})
            stage_progress = session.get("stage_progress", {})
            
            for stage_id, stage_data in session_data.items():
                if stage_filter and stage_id not in stage_filter:
                    continue
                
                # Get completion timestamp
                progress = stage_progress.get(stage_id, {})
                completed_at = progress.get("completed_at", "")
                correct_answer = self._get_stage_correct_answer(stage_id)
                
                # Pre-compute enrichment values for this stage
                enrichment = {}
                if correct_answer is not None:
                    if include_correct_answer:
                        formatted_ca = correct_answer
                        if isinstance(formatted_ca, list) and len(formatted_ca) == 1:
                            formatted_ca = formatted_ca[0]
                        enrichment["correct_answer"] = self._format_value(formatted_ca)
                    
                    if include_is_correct and isinstance(stage_data, dict):
                        answer_value = stage_data.get("selected_answers") or stage_data.get("selected_answer") or stage_data.get("response")
                        is_correct = self._check_is_correct(stage_id, answer_value)
                        enrichment["is_correct"] = is_correct if is_correct is not None else ""
                
                if isinstance(stage_data, dict):
                    for field_id, value in stage_data.items():
                        if self._should_skip_field(field_id):
                            continue
                        if field_id in excluded_field_ids:
                            continue
                        
                        # Format selected_answers for single-select
                        if field_id == "selected_answers":
                            value = self._format_selected_answers(stage_id, value)
                        
                        row = {
                            "session_id": session_id,
                            "user_id": user_id,
                            "stage_id": stage_id,
                            "field_id": field_id,
                            "value": self._format_value(value),
                            "completed_at": completed_at,
                        }
                        # Add enrichment columns to every row of this stage
                        row.update(enrichment)
                        writer.writerow(row)
                else:
                    if "response" not in excluded_field_ids:
                        row = {
                            "session_id": session_id,
                            "user_id": user_id,
                            "stage_id": stage_id,
                            "field_id": "response",
                            "value": self._format_value(stage_data),
                            "completed_at": completed_at,
                        }
                        row.update(enrichment)
                        writer.writerow(row)
        
        return output.getvalue()
    
    def enrich_json_sessions(
        self,
        sessions: List[Dict[str, Any]],
        include_correct_answer: bool = False,
        include_is_correct: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Enrich JSON session data with correct_answer and is_correct fields.
        Also formats selected_answers for single-select questions.
        """
        enriched = []
        
        for session in sessions:
            session_copy = dict(session)
            session_data = session_copy.get("data", {})
            enriched_data = {}
            
            for stage_id, stage_data in session_data.items():
                if isinstance(stage_data, dict):
                    enriched_stage = dict(stage_data)
                    correct_answer = self._get_stage_correct_answer(stage_id)
                    
                    # Format selected_answers for single-select
                    if "selected_answers" in enriched_stage:
                        enriched_stage["selected_answers"] = self._format_selected_answers(
                            stage_id, enriched_stage["selected_answers"]
                        )
                    
                    # Add enrichment fields
                    if correct_answer is not None:
                        answer_value = stage_data.get("selected_answers") or stage_data.get("selected_answer") or stage_data.get("response")
                        
                        if include_correct_answer:
                            formatted_ca = correct_answer
                            if isinstance(formatted_ca, list) and len(formatted_ca) == 1:
                                formatted_ca = formatted_ca[0]
                            enriched_stage["correct_answer"] = formatted_ca
                        
                        if include_is_correct:
                            enriched_stage["is_correct"] = self._check_is_correct(stage_id, answer_value)
                    
                    enriched_data[stage_id] = enriched_stage
                else:
                    enriched_data[stage_id] = stage_data
            
            session_copy["data"] = enriched_data
            enriched.append(session_copy)
        
        return enriched
    
    def _format_value(self, value: Any) -> str:
        """Format a value for CSV output"""
        if value is None:
            return ""
        if isinstance(value, bool):
            return "1" if value else "0"
        if isinstance(value, (list, dict)):
            return json.dumps(value)
        return str(value)
    
    def get_column_mapping(self) -> Dict[str, Dict[str, str]]:
        """
        Get a mapping of column names to their metadata.
        Useful for documentation and SPSS import.
        """
        mapping = {}
        
        for stage in self._flatten_stages(self.stages):
            stage_id = stage.get("id")
            stage_type = stage.get("type")
            stage_label = stage.get("label", stage_id)
            
            if stage_type == "questionnaire":
                for q in stage.get("questions", []):
                    col_name = f"{stage_id}.{q['id']}"
                    mapping[col_name] = {
                        "stage_id": stage_id,
                        "stage_label": stage_label,
                        "field_id": q["id"],
                        "field_label": q.get("text", q["id"]),
                        "field_type": q.get("type"),
                        "options": q.get("options"),
                    }
            
            elif stage_type == "user_info":
                for f in stage.get("fields", []):
                    col_name = f"{stage_id}.{f['field']}"
                    mapping[col_name] = {
                        "stage_id": stage_id,
                        "stage_label": stage_label,
                        "field_id": f["field"],
                        "field_label": f.get("label", f["field"]),
                        "field_type": f.get("type"),
                        "options": f.get("options"),
                    }
        
        return mapping
