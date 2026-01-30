"""
Experiment management API routes
"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status, Depends, Query, UploadFile, File
from fastapi.responses import Response
from uuid import uuid4
import yaml
import logging

from app.core.database import get_collection
from app.core.security import get_current_user, require_researcher
from app.models.user import UserInDB, UserRole
from app.models.experiment import (
    ExperimentCreate,
    ExperimentUpdate,
    ExperimentResponse,
    ExperimentListResponse,
    ExperimentStatus,
    ExperimentConfig,
    ExperimentVersionCreate,
    ExperimentVersionResponse,
    ExperimentImport,
)
from app.services.config_compiler import validate_experiment_config, flatten_template
from app.services.path_analyzer import PathAnalyzer
from app.services.variable_extractor import VariableExtractor
from app.services.path_simulator import PathSimulator

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/public", response_model=List[ExperimentListResponse])
async def list_public_experiments(
    limit: int = Query(10, ge=1, le=100),
):
    """List published experiments (public endpoint, no auth required)"""
    experiments = get_collection("experiments")
    
    # Only return published experiments
    query = {"status": ExperimentStatus.PUBLISHED.value}
    
    cursor = experiments.find(query).limit(limit).sort("published_at", -1)
    
    result = []
    async for exp_doc in cursor:
        result.append(ExperimentListResponse(
            id=exp_doc["_id"],
            experiment_id=exp_doc["experiment_id"],
            version=exp_doc["version"],
            name=exp_doc["name"],
            description=exp_doc.get("description"),
            status=ExperimentStatus(exp_doc["status"]),
            owner_id=exp_doc["owner_id"],  # Include for consistency, but not sensitive
            created_at=exp_doc["created_at"],
            updated_at=exp_doc["updated_at"],
            published_at=exp_doc.get("published_at"),
        ))
    
    return result


@router.get("", response_model=List[ExperimentListResponse])
async def list_experiments(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    status_filter: Optional[ExperimentStatus] = Query(None, alias="status"),
    current_user: UserInDB = Depends(get_current_user),
):
    """List experiments (filtered by ownership for non-admins)"""
    experiments = get_collection("experiments")
    
    # Build query
    query = {}
    
    # Non-admins can only see their own experiments
    if current_user.role != UserRole.ADMIN:
        query["owner_id"] = current_user.id
    
    if status_filter:
        query["status"] = status_filter.value
    
    cursor = experiments.find(query).skip(skip).limit(limit).sort("updated_at", -1)
    
    result = []
    async for exp_doc in cursor:
        result.append(ExperimentListResponse(
            id=exp_doc["_id"],
            experiment_id=exp_doc["experiment_id"],
            version=exp_doc["version"],
            name=exp_doc["name"],
            description=exp_doc.get("description"),
            status=ExperimentStatus(exp_doc["status"]),
            owner_id=exp_doc["owner_id"],
            created_at=exp_doc["created_at"],
            updated_at=exp_doc["updated_at"],
            published_at=exp_doc.get("published_at"),
        ))
    
    return result


@router.get("/{experiment_id}", response_model=ExperimentResponse)
async def get_experiment(
    experiment_id: str,
    current_user: UserInDB = Depends(get_current_user),
):
    """Get a specific experiment"""
    experiments = get_collection("experiments")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Check access (admins can see all, others only their own)
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    return ExperimentResponse(
        id=exp_doc["_id"],
        experiment_id=exp_doc["experiment_id"],
        version=exp_doc["version"],
        name=exp_doc["name"],
        description=exp_doc.get("description"),
        status=ExperimentStatus(exp_doc["status"]),
        owner_id=exp_doc["owner_id"],
        config=exp_doc["config"],
        created_at=exp_doc["created_at"],
        updated_at=exp_doc["updated_at"],
        published_at=exp_doc.get("published_at"),
    )


@router.get("/{experiment_id}/yaml")
async def get_experiment_yaml(
    experiment_id: str,
    current_user: UserInDB = Depends(get_current_user),
):
    """Get experiment YAML configuration"""
    experiments = get_collection("experiments")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Check access
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    return {"yaml": exp_doc.get("config_yaml", "")}


@router.post("", response_model=ExperimentResponse, status_code=status.HTTP_201_CREATED)
async def create_experiment(
    experiment_data: ExperimentCreate,
    current_user: UserInDB = Depends(require_researcher),
):
    """Create a new experiment"""
    experiments = get_collection("experiments")
    
    # Parse and validate YAML
    try:
        config = yaml.safe_load(experiment_data.config_yaml)
    except yaml.YAMLError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid YAML syntax: {str(e)}"
        )
    
    # Validate config structure
    validation_errors = validate_experiment_config(config)
    if validation_errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": "Configuration validation failed", "errors": validation_errors}
        )
    
    # Generate IDs
    doc_id = str(uuid4())
    experiment_id = config.get("meta", {}).get("id", f"exp_{uuid4().hex[:8]}")
    version = config.get("meta", {}).get("version", "1.0.0")
    
    # Check if experiment_id already exists
    existing = await experiments.find_one({"experiment_id": experiment_id})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Experiment with ID '{experiment_id}' already exists"
        )
    
    now = datetime.utcnow()
    
    exp_doc = {
        "_id": doc_id,
        "experiment_id": experiment_id,
        "version": version,
        "name": experiment_data.name,
        "description": experiment_data.description,
        "status": ExperimentStatus.DRAFT.value,
        "owner_id": current_user.id,
        "config": config,
        "config_yaml": experiment_data.config_yaml,
        "created_at": now,
        "updated_at": now,
    }
    
    await experiments.insert_one(exp_doc)
    
    return ExperimentResponse(
        id=doc_id,
        experiment_id=experiment_id,
        version=version,
        name=experiment_data.name,
        description=experiment_data.description,
        status=ExperimentStatus.DRAFT,
        owner_id=current_user.id,
        config=config,
        created_at=now,
        updated_at=now,
    )


@router.patch("/{experiment_id}", response_model=ExperimentResponse)
async def update_experiment(
    experiment_id: str,
    update_data: ExperimentUpdate,
    current_user: UserInDB = Depends(require_researcher),
):
    """Update an experiment"""
    experiments = get_collection("experiments")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Check ownership (admins can edit any)
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Cannot edit published experiments (except to archive)
    if exp_doc["status"] == ExperimentStatus.PUBLISHED.value:
        if update_data.status != ExperimentStatus.ARCHIVED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot edit published experiment. Archive it first or create a new version."
            )
    
    update_doc = {"updated_at": datetime.utcnow()}
    
    if update_data.name is not None:
        update_doc["name"] = update_data.name
    
    if update_data.description is not None:
        update_doc["description"] = update_data.description
    
    if update_data.status is not None:
        update_doc["status"] = update_data.status.value
        if update_data.status == ExperimentStatus.PUBLISHED:
            update_doc["published_at"] = datetime.utcnow()
    
    # Track if experiment_id changes (for proper query after update)
    new_experiment_id = experiment_id
    
    if update_data.config_yaml is not None:
        # Parse and validate YAML
        try:
            config = yaml.safe_load(update_data.config_yaml)
        except yaml.YAMLError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid YAML syntax: {str(e)}"
            )
        
        validation_errors = validate_experiment_config(config)
        if validation_errors:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"message": "Configuration validation failed", "errors": validation_errors}
            )
        
        update_doc["config"] = config
        update_doc["config_yaml"] = update_data.config_yaml
        update_doc["version"] = config.get("meta", {}).get("version", exp_doc["version"])
        
        # Sync experiment_id with meta.id if it changed
        meta_id = config.get("meta", {}).get("id")
        if meta_id and meta_id != experiment_id:
            # Check if the new ID already exists (avoid duplicates)
            existing = await experiments.find_one({"experiment_id": meta_id})
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot change experiment ID: an experiment with ID '{meta_id}' already exists"
                )
            update_doc["experiment_id"] = meta_id
            new_experiment_id = meta_id
    
    await experiments.update_one(
        {"experiment_id": experiment_id},
        {"$set": update_doc}
    )
    
    updated_doc = await experiments.find_one({"experiment_id": new_experiment_id})
    
    return ExperimentResponse(
        id=updated_doc["_id"],
        experiment_id=updated_doc["experiment_id"],
        version=updated_doc["version"],
        name=updated_doc["name"],
        description=updated_doc.get("description"),
        status=ExperimentStatus(updated_doc["status"]),
        owner_id=updated_doc["owner_id"],
        config=updated_doc["config"],
        created_at=updated_doc["created_at"],
        updated_at=updated_doc["updated_at"],
        published_at=updated_doc.get("published_at"),
    )


@router.post("/{experiment_id}/publish", response_model=ExperimentResponse)
async def publish_experiment(
    experiment_id: str,
    current_user: UserInDB = Depends(require_researcher),
):
    """Publish an experiment (flattens templates, makes immutable)"""
    experiments = get_collection("experiments")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Check ownership
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    if exp_doc["status"] == ExperimentStatus.PUBLISHED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Experiment is already published"
        )
    
    # Flatten template inheritance
    config = exp_doc["config"]
    flattened_config = await flatten_template(config)
    
    # Update meta
    now = datetime.utcnow()
    flattened_config["meta"]["status"] = ExperimentStatus.PUBLISHED.value
    flattened_config["meta"]["published_at"] = now.isoformat()
    flattened_config["meta"]["snapshot_id"] = f"{experiment_id}_v{exp_doc['version']}"
    
    # Remove extends reference (already flattened)
    flattened_config["meta"].pop("extends", None)
    
    await experiments.update_one(
        {"experiment_id": experiment_id},
        {"$set": {
            "status": ExperimentStatus.PUBLISHED.value,
            "config": flattened_config,
            "config_yaml": yaml.dump(flattened_config, default_flow_style=False),
            "published_at": now,
            "updated_at": now,
        }}
    )
    
    updated_doc = await experiments.find_one({"experiment_id": experiment_id})
    
    return ExperimentResponse(
        id=updated_doc["_id"],
        experiment_id=updated_doc["experiment_id"],
        version=updated_doc["version"],
        name=updated_doc["name"],
        description=updated_doc.get("description"),
        status=ExperimentStatus.PUBLISHED,
        owner_id=updated_doc["owner_id"],
        config=updated_doc["config"],
        created_at=updated_doc["created_at"],
        updated_at=updated_doc["updated_at"],
        published_at=updated_doc["published_at"],
    )


@router.post("/{experiment_id}/duplicate", response_model=ExperimentResponse)
async def duplicate_experiment(
    experiment_id: str,
    current_user: UserInDB = Depends(require_researcher),
):
    """Duplicate an experiment"""
    experiments = get_collection("experiments")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Check access
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Generate new IDs
    doc_id = str(uuid4())
    new_experiment_id = f"{experiment_id}_copy_{uuid4().hex[:6]}"
    now = datetime.utcnow()
    
    # Update config meta
    config = exp_doc["config"].copy()
    config["meta"]["id"] = new_experiment_id
    config["meta"]["status"] = ExperimentStatus.DRAFT.value
    config["meta"].pop("published_at", None)
    config["meta"].pop("snapshot_id", None)
    
    new_doc = {
        "_id": doc_id,
        "experiment_id": new_experiment_id,
        "version": "1.0.0",
        "name": f"{exp_doc['name']} (Copy)",
        "description": exp_doc.get("description"),
        "status": ExperimentStatus.DRAFT.value,
        "owner_id": current_user.id,
        "config": config,
        "config_yaml": yaml.dump(config, default_flow_style=False),
        "created_at": now,
        "updated_at": now,
    }
    
    await experiments.insert_one(new_doc)
    
    return ExperimentResponse(
        id=doc_id,
        experiment_id=new_experiment_id,
        version="1.0.0",
        name=new_doc["name"],
        description=new_doc.get("description"),
        status=ExperimentStatus.DRAFT,
        owner_id=current_user.id,
        config=config,
        created_at=now,
        updated_at=now,
    )


@router.delete("/{experiment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_experiment(
    experiment_id: str,
    current_user: UserInDB = Depends(require_researcher),
):
    """Delete an experiment (only drafts, archives published)"""
    experiments = get_collection("experiments")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Check ownership
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Published experiments can only be archived
    if exp_doc["status"] == ExperimentStatus.PUBLISHED.value:
        await experiments.update_one(
            {"experiment_id": experiment_id},
            {"$set": {
                "status": ExperimentStatus.ARCHIVED.value,
                "updated_at": datetime.utcnow()
            }}
        )
    else:
        await experiments.delete_one({"experiment_id": experiment_id})


from pydantic import BaseModel

class ClearConfirmation(BaseModel):
    confirmation: str


@router.delete("/data/all")
async def clear_all_experiments(
    data: ClearConfirmation,
    current_user: UserInDB = Depends(require_researcher),
):
    """
    Delete all experiments from the database.
    Requires typing 'yes' as confirmation.
    Only accessible by admin users.
    """
    # Only admins can clear all experiments
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can clear all experiments"
        )
    
    if data.confirmation.lower() != "yes":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please type 'yes' to confirm deletion"
        )
    
    experiments = get_collection("experiments")
    versions = get_collection("experiment_versions")
    
    # Count before deletion
    experiments_count = await experiments.count_documents({})
    versions_count = await versions.count_documents({})
    
    # Delete all experiments and versions
    await experiments.delete_many({})
    await versions.delete_many({})
    
    logger.info(f"Admin {current_user.id} cleared all experiments: {experiments_count} experiments, {versions_count} versions deleted")
    
    return {
        "experiments_deleted": experiments_count,
        "versions_deleted": versions_count,
    }


@router.get("/{experiment_id}/validate")
async def validate_experiment(
    experiment_id: str,
    current_user: UserInDB = Depends(get_current_user),
):
    """Validate experiment configuration"""
    experiments = get_collection("experiments")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    errors = validate_experiment_config(exp_doc["config"])
    
    return {
        "valid": len(errors) == 0,
        "errors": errors
    }


@router.get("/{experiment_id}/paths")
async def get_experiment_paths(
    experiment_id: str,
    current_user: UserInDB = Depends(get_current_user),
):
    """
    Get all possible paths through the experiment.
    
    Returns a tree structure showing:
    - All phases, stages, blocks, and tasks
    - Pick groups (where pick_count creates branching)
    - Ordering groups (random, balanced, etc.)
    - Visibility conditions
    - Pick conditions
    
    Uses the same logic as runtime to ensure accuracy.
    """
    experiments = get_collection("experiments")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    try:
        analyzer = PathAnalyzer(exp_doc["config"])
        path_tree = analyzer.analyze()
        
        return {
            "experiment_id": experiment_id,
            "title": exp_doc["config"].get("meta", {}).get("title", "Untitled"),
            "pathTree": path_tree,
        }
    except Exception as e:
        logger.error(f"Error analyzing experiment paths: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to analyze experiment paths: {str(e)}"
        )


@router.get("/{experiment_id}/simulate/variables")
async def get_simulation_variables(
    experiment_id: str,
    current_user: UserInDB = Depends(get_current_user),
):
    """
    Get all variables referenced in visibility rules and pick conditions.
    
    Returns a list of variables that can be configured for simulation,
    with inferred types and options where available.
    
    This helps the frontend build appropriate input controls for the
    simulation configuration panel.
    """
    experiments = get_collection("experiments")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    try:
        extractor = VariableExtractor(exp_doc["config"])
        variables = extractor.extract_all()
        
        return {
            "experiment_id": experiment_id,
            "variables": [v.to_dict() for v in variables],
        }
    except Exception as e:
        logger.error(f"Error extracting simulation variables: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to extract simulation variables: {str(e)}"
        )


@router.post("/{experiment_id}/simulate")
async def run_simulation(
    experiment_id: str,
    simulation_config: dict,
    current_user: UserInDB = Depends(get_current_user),
):
    """
    Run a path simulation for the experiment.
    
    Simulates multiple participant sessions to preview path distributions.
    Uses the same logic as the real experiment runtime to ensure accuracy.
    
    Request body:
    {
        "participant_count": 100,
        "variable_distributions": {
            "participant.gender": {
                "type": "categorical",
                "distribution": {"male": 0.5, "female": 0.45, "other": 0.05}
            },
            "session.questionnaire_1.score": {
                "type": "numeric",
                "min": 0,
                "max": 100,
                "distribution": "uniform"
            }
        }
    }
    
    Returns aggregated path distributions with counts and percentages.
    """
    experiments = get_collection("experiments")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Extract simulation parameters
    participant_count = simulation_config.get("participant_count", 100)
    variable_distributions = simulation_config.get("variable_distributions", {})
    
    # Validate participant count
    if participant_count < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="participant_count must be at least 1"
        )
    if participant_count > 10000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="participant_count cannot exceed 10000"
        )
    
    try:
        simulator = PathSimulator(exp_doc["config"])
        result = simulator.simulate(
            participant_count=participant_count,
            variable_distributions=variable_distributions,
        )
        
        return {
            "experiment_id": experiment_id,
            "simulation": result.to_dict(),
        }
    except Exception as e:
        logger.error(f"Error running simulation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to run simulation: {str(e)}"
        )


@router.get("/{experiment_id}/export")
async def export_experiment(
    experiment_id: str,
    current_user: UserInDB = Depends(get_current_user),
):
    """Export experiment as a YAML file for download"""
    experiments = get_collection("experiments")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Check access
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Build export data with metadata
    export_data = {
        "export_meta": {
            "exported_at": datetime.utcnow().isoformat(),
            "experiment_name": exp_doc["name"],
            "experiment_description": exp_doc.get("description"),
            "original_experiment_id": exp_doc["experiment_id"],
            "version": exp_doc["version"],
            "status": exp_doc["status"],
        },
        "config": exp_doc["config"],
    }
    
    yaml_content = yaml.dump(export_data, default_flow_style=False, allow_unicode=True, sort_keys=False)
    
    # Create filename from experiment name
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in exp_doc["name"])
    filename = f"{safe_name}_export.yaml"
    
    return Response(
        content=yaml_content,
        media_type="application/x-yaml",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
        }
    )


@router.post("/import", response_model=ExperimentResponse, status_code=status.HTTP_201_CREATED)
async def import_experiment(
    import_data: ExperimentImport,
    current_user: UserInDB = Depends(require_researcher),
):
    """Import an experiment from YAML configuration"""
    experiments = get_collection("experiments")
    
    # Parse YAML
    try:
        parsed = yaml.safe_load(import_data.config_yaml)
    except yaml.YAMLError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid YAML syntax: {str(e)}"
        )
    
    # Handle both export format (with export_meta) and direct config format
    if "export_meta" in parsed and "config" in parsed:
        config = parsed["config"]
    else:
        config = parsed
    
    # Validate config structure
    validation_errors = validate_experiment_config(config)
    if validation_errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": "Configuration validation failed", "errors": validation_errors}
        )
    
    # Generate new IDs
    doc_id = str(uuid4())
    base_experiment_id = config.get("meta", {}).get("id", f"exp_{uuid4().hex[:8]}")
    experiment_id = f"{base_experiment_id}_imported_{uuid4().hex[:6]}"
    version = config.get("meta", {}).get("version", "1.0.0")
    
    # Update the config meta with new ID
    config["meta"]["id"] = experiment_id
    config["meta"]["status"] = ExperimentStatus.DRAFT.value
    config["meta"].pop("published_at", None)
    config["meta"].pop("snapshot_id", None)
    
    now = datetime.utcnow()
    
    # Generate YAML from modified config
    config_yaml = yaml.dump(config, default_flow_style=False, allow_unicode=True)
    
    exp_doc = {
        "_id": doc_id,
        "experiment_id": experiment_id,
        "version": version,
        "name": import_data.name,
        "description": import_data.description,
        "status": ExperimentStatus.DRAFT.value,
        "owner_id": current_user.id,
        "config": config,
        "config_yaml": config_yaml,
        "created_at": now,
        "updated_at": now,
    }
    
    await experiments.insert_one(exp_doc)
    
    return ExperimentResponse(
        id=doc_id,
        experiment_id=experiment_id,
        version=version,
        name=import_data.name,
        description=import_data.description,
        status=ExperimentStatus.DRAFT,
        owner_id=current_user.id,
        config=config,
        created_at=now,
        updated_at=now,
    )


@router.post("/{experiment_id}/versions", response_model=ExperimentVersionResponse, status_code=status.HTTP_201_CREATED)
async def save_experiment_version(
    experiment_id: str,
    version_data: ExperimentVersionCreate,
    current_user: UserInDB = Depends(require_researcher),
):
    """Save a named version/snapshot of the experiment"""
    experiments = get_collection("experiments")
    versions = get_collection("experiment_versions")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Check ownership
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Create version document
    doc_id = str(uuid4())
    now = datetime.utcnow()
    
    version_doc = {
        "_id": doc_id,
        "experiment_id": experiment_id,
        "version_name": version_data.version_name,
        "description": version_data.description,
        "config": exp_doc["config"],
        "config_yaml": exp_doc.get("config_yaml", ""),
        "created_by": current_user.id,
        "created_at": now,
    }
    
    await versions.insert_one(version_doc)
    
    return ExperimentVersionResponse(
        id=doc_id,
        experiment_id=experiment_id,
        version_name=version_data.version_name,
        description=version_data.description,
        created_by=current_user.id,
        created_at=now,
    )


@router.get("/{experiment_id}/versions", response_model=List[ExperimentVersionResponse])
async def list_experiment_versions(
    experiment_id: str,
    current_user: UserInDB = Depends(get_current_user),
):
    """List all saved versions of an experiment"""
    experiments = get_collection("experiments")
    versions = get_collection("experiment_versions")
    
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Check access
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    cursor = versions.find({"experiment_id": experiment_id}).sort("created_at", -1)
    
    result = []
    async for version_doc in cursor:
        result.append(ExperimentVersionResponse(
            id=version_doc["_id"],
            experiment_id=version_doc["experiment_id"],
            version_name=version_doc["version_name"],
            description=version_doc.get("description"),
            created_by=version_doc["created_by"],
            created_at=version_doc["created_at"],
        ))
    
    return result


@router.post("/versions/{version_id}/restore", response_model=ExperimentResponse, status_code=status.HTTP_201_CREATED)
async def restore_experiment_version(
    version_id: str,
    name: str = Query(..., description="Name for the restored experiment"),
    description: Optional[str] = Query(None, description="Description for the restored experiment"),
    current_user: UserInDB = Depends(require_researcher),
):
    """Restore a saved version as a new experiment"""
    experiments = get_collection("experiments")
    versions = get_collection("experiment_versions")
    
    version_doc = await versions.find_one({"_id": version_id})
    if not version_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found"
        )
    
    # Check access to original experiment
    exp_doc = await experiments.find_one({"experiment_id": version_doc["experiment_id"]})
    if exp_doc:
        if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    # Generate new IDs
    doc_id = str(uuid4())
    base_experiment_id = version_doc["config"].get("meta", {}).get("id", f"exp_{uuid4().hex[:8]}")
    experiment_id = f"{base_experiment_id}_restored_{uuid4().hex[:6]}"
    
    # Update config meta
    config = version_doc["config"].copy()
    config["meta"]["id"] = experiment_id
    config["meta"]["status"] = ExperimentStatus.DRAFT.value
    config["meta"].pop("published_at", None)
    config["meta"].pop("snapshot_id", None)
    
    now = datetime.utcnow()
    
    # Generate YAML from modified config
    config_yaml = yaml.dump(config, default_flow_style=False, allow_unicode=True)
    
    new_doc = {
        "_id": doc_id,
        "experiment_id": experiment_id,
        "version": config.get("meta", {}).get("version", "1.0.0"),
        "name": name,
        "description": description,
        "status": ExperimentStatus.DRAFT.value,
        "owner_id": current_user.id,
        "config": config,
        "config_yaml": config_yaml,
        "created_at": now,
        "updated_at": now,
    }
    
    await experiments.insert_one(new_doc)
    
    return ExperimentResponse(
        id=doc_id,
        experiment_id=experiment_id,
        version=new_doc["version"],
        name=name,
        description=description,
        status=ExperimentStatus.DRAFT,
        owner_id=current_user.id,
        config=config,
        created_at=now,
        updated_at=now,
    )

