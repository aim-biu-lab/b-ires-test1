"""
Dependency graph for tracking stage relationships and cascading invalidation
"""
from typing import Dict, List, Set, Any
import re
import logging

logger = logging.getLogger(__name__)


class DependencyGraph:
    """
    Builds and manages a dependency graph for experiment stages.
    Used to determine which stages need to be invalidated when
    upstream data changes.
    """
    
    def __init__(self, experiment_config: Dict[str, Any]):
        self.config = experiment_config
        self.stages = experiment_config.get("stages", [])
        
        # Maps stage_id -> list of stage_ids that depend on it
        self.dependents: Dict[str, Set[str]] = {}
        
        # Maps stage_id -> list of stage_ids it depends on
        self.dependencies: Dict[str, Set[str]] = {}
        
        self._build_graph()
    
    def _build_graph(self):
        """Build the dependency graph from visibility rules"""
        # Initialize empty sets for all stages
        for stage in self._flatten_stages(self.stages):
            stage_id = stage.get("id")
            if stage_id:
                self.dependents[stage_id] = set()
                self.dependencies[stage_id] = set()
        
        # Parse visibility rules to extract dependencies
        for stage in self._flatten_stages(self.stages):
            stage_id = stage.get("id")
            if not stage_id:
                continue
            
            visibility_rule = stage.get("visibility_rule", "")
            quota_config = stage.get("quota", {})
            
            # Extract stage references from visibility rule
            referenced_stages = self._extract_stage_references(visibility_rule)
            
            for ref_stage_id in referenced_stages:
                if ref_stage_id in self.dependents:
                    self.dependents[ref_stage_id].add(stage_id)
                    self.dependencies[stage_id].add(ref_stage_id)
            
            # Add fallback stage as dependency
            fallback = quota_config.get("fallback_stage")
            if fallback and fallback in self.dependents:
                # Fallback doesn't create a data dependency
                pass
    
    def _flatten_stages(self, stages: List[Dict]) -> List[Dict]:
        """Flatten nested stages into a single list"""
        result = []
        for stage in stages:
            result.append(stage)
            if "substages" in stage:
                result.extend(self._flatten_stages(stage["substages"]))
        return result
    
    def _extract_stage_references(self, rule: str) -> Set[str]:
        """
        Extract stage IDs referenced in a visibility rule.
        Patterns like 'stage_id.field' or 'stage_id.field == value'
        """
        if not rule or not isinstance(rule, str):
            return set()
        
        references = set()
        
        # Pattern: word.word (stage_id.field_name)
        # This matches patterns like "demographics.age" or "user_info.gender"
        pattern = r'\b([a-zA-Z_][a-zA-Z0-9_]*)\.[a-zA-Z_][a-zA-Z0-9_]*'
        matches = re.findall(pattern, rule)
        
        for match in matches:
            # Exclude common prefixes that aren't stage references
            if match not in ("url_params", "session", "global", "PUBLIC", "SERVER", "URL", "SESSION"):
                references.add(match)
        
        return references
    
    def get_dependents(self, stage_id: str) -> List[str]:
        """
        Get all stages that depend on this stage (directly or transitively).
        Returns a list in topological order (dependencies first).
        """
        all_dependents = set()
        visited = set()
        
        def collect_dependents(sid: str):
            if sid in visited:
                return
            visited.add(sid)
            
            for dependent_id in self.dependents.get(sid, set()):
                all_dependents.add(dependent_id)
                collect_dependents(dependent_id)
        
        collect_dependents(stage_id)
        
        # Return in topological order
        return self._topological_sort(list(all_dependents))
    
    def get_dependencies(self, stage_id: str) -> List[str]:
        """Get all stages that this stage depends on"""
        all_dependencies = set()
        visited = set()
        
        def collect_dependencies(sid: str):
            if sid in visited:
                return
            visited.add(sid)
            
            for dependency_id in self.dependencies.get(sid, set()):
                all_dependencies.add(dependency_id)
                collect_dependencies(dependency_id)
        
        collect_dependencies(stage_id)
        
        return list(all_dependencies)
    
    def _topological_sort(self, stage_ids: List[str]) -> List[str]:
        """Sort stage IDs in topological order (dependencies first)"""
        if not stage_ids:
            return []
        
        # Build in-degree count for subgraph
        in_degree = {sid: 0 for sid in stage_ids}
        stage_set = set(stage_ids)
        
        for sid in stage_ids:
            for dep in self.dependencies.get(sid, set()):
                if dep in stage_set:
                    in_degree[sid] += 1
        
        # Kahn's algorithm
        result = []
        queue = [sid for sid, degree in in_degree.items() if degree == 0]
        
        while queue:
            current = queue.pop(0)
            result.append(current)
            
            for dependent in self.dependents.get(current, set()):
                if dependent in in_degree:
                    in_degree[dependent] -= 1
                    if in_degree[dependent] == 0:
                        queue.append(dependent)
        
        return result
    
    def would_invalidate(self, stage_id: str) -> Dict[str, Any]:
        """
        Get information about what would be invalidated if a stage's data changes.
        Used to warn users before they edit completed stages.
        """
        dependents = self.get_dependents(stage_id)
        
        return {
            "stage_id": stage_id,
            "would_invalidate": dependents,
            "count": len(dependents),
        }



