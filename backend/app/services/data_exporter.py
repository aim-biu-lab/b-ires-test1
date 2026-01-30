"""
Data exporter for CSV and JSON export of experiment data
"""
from typing import Dict, List, Any, Optional
import csv
import io
import logging

logger = logging.getLogger(__name__)


class DataExporter:
    """
    Exports experiment data in various formats.
    Supports wide format (1 row per participant) and long format (1 row per response).
    """
    
    def __init__(self, experiment_config: Dict[str, Any]):
        self.config = experiment_config
        self.stages = experiment_config.get("stages", [])
        self.stage_map = {s["id"]: s for s in self._flatten_stages(self.stages)}
    
    def _flatten_stages(self, stages: List[Dict]) -> List[Dict]:
        """Flatten nested stages"""
        result = []
        for stage in stages:
            result.append(stage)
            if "substages" in stage:
                result.extend(self._flatten_stages(stage["substages"]))
        return result
    
    def to_wide_csv(
        self,
        sessions: List[Dict[str, Any]],
        stage_filter: Optional[List[str]] = None,
    ) -> str:
        """
        Export data in wide format (1 row per participant).
        Columns: session_id, user_id, status, created_at, completed_at, [stage_field columns]
        """
        if not sessions:
            return ""
        
        # Determine all possible columns from stage configurations
        columns = ["session_id", "user_id", "status", "created_at", "completed_at"]
        field_columns = []
        
        for stage in self._flatten_stages(self.stages):
            stage_id = stage.get("id")
            
            if stage_filter and stage_id not in stage_filter:
                continue
            
            stage_type = stage.get("type")
            
            if stage_type == "questionnaire":
                for q in stage.get("questions", []):
                    col_name = f"{stage_id}.{q['id']}"
                    field_columns.append(col_name)
            
            elif stage_type == "user_info":
                for f in stage.get("fields", []):
                    col_name = f"{stage_id}.{f['field']}"
                    field_columns.append(col_name)
            
            elif stage_type in ("likert_scale", "consent_form"):
                col_name = f"{stage_id}.response"
                field_columns.append(col_name)
        
        columns.extend(field_columns)
        
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
                
                if isinstance(stage_data, dict):
                    for field_id, value in stage_data.items():
                        col_name = f"{stage_id}.{field_id}"
                        if col_name in columns:
                            row[col_name] = self._format_value(value)
                else:
                    col_name = f"{stage_id}.response"
                    if col_name in columns:
                        row[col_name] = self._format_value(stage_data)
            
            writer.writerow(row)
        
        return output.getvalue()
    
    def to_long_csv(
        self,
        sessions: List[Dict[str, Any]],
        stage_filter: Optional[List[str]] = None,
    ) -> str:
        """
        Export data in long format (1 row per response).
        Columns: session_id, user_id, stage_id, field_id, value, timestamp
        """
        output = io.StringIO()
        columns = ["session_id", "user_id", "stage_id", "field_id", "value", "completed_at"]
        writer = csv.DictWriter(output, fieldnames=columns)
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
                
                if isinstance(stage_data, dict):
                    for field_id, value in stage_data.items():
                        if field_id.startswith("_"):
                            continue  # Skip internal fields
                        
                        writer.writerow({
                            "session_id": session_id,
                            "user_id": user_id,
                            "stage_id": stage_id,
                            "field_id": field_id,
                            "value": self._format_value(value),
                            "completed_at": completed_at,
                        })
                else:
                    writer.writerow({
                        "session_id": session_id,
                        "user_id": user_id,
                        "stage_id": stage_id,
                        "field_id": "response",
                        "value": self._format_value(stage_data),
                        "completed_at": completed_at,
                    })
        
        return output.getvalue()
    
    def _format_value(self, value: Any) -> str:
        """Format a value for CSV output"""
        if value is None:
            return ""
        if isinstance(value, bool):
            return "1" if value else "0"
        if isinstance(value, (list, dict)):
            import json
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



