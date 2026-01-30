Here is a comprehensive Technical Specification Document for your platform. I have rewritten your requirements using industry-standard architectural patterns and added several critical improvements (marked as "Proposed Additions") to ensure the system is robust, scalable, and user-friendly for non-technical researchers.

---

# Technical Specification: Bar-Ilan Research Evaluation System (B-IRES)

## 1. Executive Summary

B-IRES is a distributed, configuration-driven Single Page Application (SPA) designed to orchestrate complex behavioral experiments. The system operates on an **"Infrastructure-as-Code"** model, where the entire experiment topology, logic, and content are defined in strictly typed YAML manifests.

The architecture prioritizes **portability** (containerized deployment), **resilience** (offline-first state recovery), and **granular telemetry** (dual-write logging strategy).

---

## 2. System Architecture

### 2.1 High-Level Topology

The system follows a **Microservices-lite Architecture** encapsulated within a Docker ecosystem. This ensures that non-technical users can deploy the entire stack with a single command, without worrying about dependencies (Node.js, Python, MongoDB versions).

1. **The Shell (Frontend Client):** A React-based SPA that acts as the orchestration engine. It parses the YAML configuration, builds a Directed Acyclic Graph (DAG) of the experiment flow, and manages the global state machine.
2. **The Controller (API Gateway):** A stateless REST API responsible for session management, validation, and data ingestion.
3. **The Data Layer:**
* **Hot Storage (MongoDB):** For real-time state persistence and flexible JSON logging.
* **Cold Storage (File System):** For redundant, immediately accessible CSV flat-file logging.



### 2.2 Recommended Technology Stack

* **Frontend:** **React.js + TypeScript**. TypeScript is critical here to ensure the JSON/YAML configuration is strictly typed and validated before rendering.
* **State Management:** **Zustand** or **Redux Toolkit**.
* **Backend:** **Python (FastAPI)**. Python is recommended over Node.js here because it allows for easy integration of data analysis libraries (Pandas) for the "Export" features.
* **Database:** **MongoDB** (Schema-less nature fits the variable structure of questionnaires).
* **Infrastructure:** **Docker & Docker Compose**.

---

## 3. Module 1: The Configuration Engine (The "Brain")

This module parses the user-provided YAML files to generate the experiment at runtime.

### 3.1 YAML Schema Definition

The configuration file dictates the state machine. It defines the hierarchy: `Experiment -> Stages -> Sub-Stages (Blocks)`.

**Key Attributes:**

* **`stage_id`**: Unique identifier.
* **`type`**: Determines the component renderer (e.g., `questionnaire`, `video`, `iframe`).
* **`visibility_logic`**: A predicate string evaluated against the global state.
* **`mutability`**: Enum [`always_editable`, `lock_on_submit`]. Defines if the user can change answers after clicking "Next".

### 3.2 Logic & Routing Engine

To handle the requirement for conditional branching (*"If option A, show stage Y"*), we implement a client-side **Predicate Engine** (Recommended library: **JsonLogic**).

* **Context Injection:** The engine injects three contexts for rule evaluation:
1. `session`: Current answers/choices.
2. `url_params`: Query parameters (e.g., `?source=linkedin&variant=B`).
3. `global`: System constants (timestamp, device type).



### 3.3 Proposed Improvement: The "Dry Run" Validator

**Problem:** Non-technical users often make typos in YAML, causing runtime crashes.
**Solution:** Implement a strict **Schema Validator** (using *Pydantic*) that runs on file upload. It checks:

1. **Referential Integrity:** Ensures `visible_if: stage_X` refers to a stage that actually exists.
2. **Asset Availability:** Verifies that referenced images/videos exist in the assets folder.
3. **Syntax:** Validates correct indentation and typing.

---

## 4. Module 2: The Orchestrator (Frontend Client)

### 4.1 State Management

The "Shell" maintains the **Single Source of Truth**:

* `current_stage_pointer`: Index of the active stage.
* `answers_map`: A key-value store of all user inputs.
* `flags`: System states (e.g., `is_loading`, `media_playing`).

### 4.2 Proposed Improvement: Resilience & Recovery

**Requirement:** "The user can clearly see current progress."
**Additions:**

1. **State Hydration:** On every state change, the session snapshot is serialized to `localStorage`. If the browser crashes or the user refreshes, the app re-hydrates the state to the exact last interaction.
2. **Dynamic Progress Calculation:** The progress bar must calculate `completed / total_visible` dynamically, filtering out stages hidden by conditional logic.

### 4.3 Proposed Improvement: Asset Pre-loading

For experiments involving video/images, latency invalidates reaction time data.
**Solution:** Implement a **Look-Ahead Fetcher**. While the user interacts with Stage , the system asynchronously downloads heavy assets for Stage  into the browser cache.

---

## 5. Module 3: Component Library (The "Blocks")

The UI utilizes a **Polymorphic Component Factory**. The Orchestrator reads the `type` field from the YAML and instantiates the specific block.

### 5.1 Communication Interface (API)

All blocks must implement a unified interface to "talk" to the Shell:

* **Upstream (Block  Shell):**
* `emitAction(actionType, payload)`: Logs interactions (clicks, pauses).
* `setCompleteness(isComplete)`: Unlocks the "Next" button.
* `submitData(data)`: Commits answers to the global store.


* **Downstream (Shell  Block):**
* `props.isActive`: Triggers animations or media autoplay.
* `props.isEditable`: Forces read-only mode if the stage was already submitted.



### 5.2 Specific Block Implementations

* **Likert Visual Block:**
* Config: Accepts `range: [1, 7]` and `assets_map`.
* Rendering: Maps integer values to SVG assets (faces) scaling from sad to happy.


* **Iframe Sandbox Block:**
* Usage: For external JS tasks/games.
* Sync: Uses `window.postMessage` API. The Shell listens for `{ type: "TASK_COMPLETE", score: 95 }` to enable progression.



---

## 6. Module 4: Logging & Telemetry

### 6.1 Identity Management

To satisfy unique logging requirements:

* **Session ID:** UUIDv4 generated at start.
* **Element ID:** Deterministic IDs generated from the config path (e.g., `stage_demographics.q_age.input`).

### 6.2 Dual-Write Strategy (Real-time + Backup)

**Problem:** Writing to CSV files on every click is slow and blocks the server.
**Solution:** Asynchronous Queue Architecture.

1. **Ingestion:** Client sends logs to `POST /api/log`.
2. **Hot Write:** Server immediately inserts JSON into **MongoDB** (for real-time dashboards).
3. **Cold Write:** The server pushes the payload to a background **Job Queue**. A worker process picks it up and appends it to a flat `.csv` file on the disk.

### 6.3 Proposed Addition: ETL / Data Export

Raw logs (click-streams) are hard to analyze.
**Solution:** Add an "Export" endpoint that transforms data from **Long Format** (1 row per click) to **Wide Format** (1 row per participant, columns for every question). This makes the data immediately ready for SPSS/R/Python.

---

## 7. Operational Workflow (Deployment)

**Requirement:** "Allow non-technical people to run it on their servers."
**Solution:** **Docker Compose Bundle**.

The user receives a folder structure:

```text
/experiment-platform
  ├── docker-compose.yml
  ├── config/
  │   └── experiment.yaml   <-- User edits this
  ├── assets/               <-- User drops images/videos here
  └── data/                 <-- CSV logs appear here

```

**The "One-Command" Run:**
The user installs Docker and runs: `docker-compose up -d`.
This automatically spins up the Database, Backend, and Frontend containers in a private network, exposing the experiment on port 80.

---

## 8. Example Configuration (YAML)

```yaml
meta:
  id: "exp_social_v1"
  version: "1.0"

stages:
  - id: "demographics"
    type: "questionnaire"
    mandatory: true
    questions:
      - id: "age"
        type: "number"
      - id: "group_assignment"
        type: "hidden"
        # Logic: Auto-assign based on URL param ?group=A
        default_value: "${url_params.group}" 

  - id: "emotional_response"
    type: "questionnaire"
    # Logic: Only show if age > 18 AND group is A
    visibility_rule: "demographics.age > 18 && demographics.group_assignment == 'A'"
    questions:
      - id: "happiness_scale"
        type: "likert_scale"
        range: [1, 7]
        visual_theme: "faces_set_01" # Maps 1-7 to assets/faces/1.svg...

  - id: "video_stimulus"
    type: "media_block"
    source: "videos/stimulus.mp4"
    # Sync: Block tells Shell it's done when video ends
    completion_trigger: "MEDIA_ENDED"

```