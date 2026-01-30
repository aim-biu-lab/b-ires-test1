Here is the comprehensive **Technical Specification Document** for the Bar-Ilan Research Evaluation System (B-IRES). This document integrates all previous requirements with the new constraints regarding concurrency, quotas, centralized logging, and pluggable architecture.

---

# Technical Specification: Bar-Ilan Research Evaluation System (B-IRES)

## 1. Executive Summary

B-IRES is a distributed, configuration-driven platform designed to orchestrate complex behavioral experiments. It is engineered to be **server-agnostic** (deployable via Docker) and **highly configurable** (via YAML).

The system handles **1 to 100+ concurrent participants**, ensuring robust performance through asynchronous I/O and atomic state management. It features a **Centralized Telemetry Hub** that aggregates logs from native UI blocks and sandboxed Iframes into a unified stream, supported by a pluggable storage architecture.

---

## 2. System Architecture

### 2.1 High-Level Topology

The system utilizes a **Microservices-lite** architecture encapsulated in a Docker ecosystem.

1. **The Shell (Frontend Client):** A React-based Single Page Application (SPA). It acts as the "State Machine," managing navigation, timers, and component rendering.
2. **The Controller (API Gateway):** A stateless Python (FastAPI) backend responsible for session validation, atomic locking (quotas), and log ingestion.
3. **The Persistence Layer:** An abstract interface managing data writes to configured storage backends.
4. **The Concurrency Engine:** Uses asynchronous task queues to handle non-blocking writes for up to 100 simultaneous users.

### 2.2 Identity & Session Model

To satisfy the requirement of tracking unique users across multiple sessions:

* **`user_id` (Persistent Actor):**
* **Source:** A UUIDv4 generated on the first visit and stored in a durable **HTTP-Only Cookie** (duration: 1 year) or `localStorage`.
* **External Linking:** If the URL contains a query param like `?worker_id=123`, the system maps this external ID to the internal `user_id`.
* **Scope:** Persists across browser restarts.


* **`session_id` (Ephemeral Run):**
* **Source:** A new UUIDv4 generated every time the experiment is launched (refresh/restart).
* **Scope:** Single run-through.



---

## 3. Module 1: Logic & Concurrency Control

### 3.1 Global Quotas (The "20 Users" Rule)

**Requirement:** "When the 20th answer is submitted, the next user will not get it."

Handling 100 concurrent users requires preventing Race Conditions (e.g., User 21 entering because User 20 hasn't finished clicking "Submit" yet).

**Technical Implementation: Atomic Reservations with TTL**

1. **Pre-Flight Check:** When a user completes Stage A, the client requests access to Stage B.
2. **Atomic Check:** The Backend performs an atomic database operation (e.g., MongoDB `findAndModify` or Redis `INCR`).
* *Check:* `if (completed + reserved) < limit`.
* *Action:* Increment `reserved` counter.


3. **Time-To-Live (TTL):** The "Reservation" is valid for  minutes (the max time defined for the stage).
* *If User Submits:* Decrement `reserved`, increment `completed`.
* *If User Timeouts/Drops:* The `reserved` key expires automatically, freeing the slot for another user.



### 3.2 Timing Constraints

The Frontend enforces timing policies defined in the YAML:

* **Min-Time (Force Read):** The "Next" button renders in a `disabled` state. A client-side timer enables it only after `min_duration_ms` has passed.
* **Max-Time (Deadline):** A visual countdown. When it hits zero, the system executes the `on_timeout` action (e.g., `auto_submit`, `skip_stage`, or `lock_interface`).

---

## 4. Module 2: The Configuration Engine

The experiment is defined by a strictly typed YAML file. This file controls the flow, content, rules, and timing.

### 4.1 YAML Schema Overview

```yaml
meta:
  experiment_id: "social_dynamics_v2"

stages:
  - id: "intro_consent"
    type: "html_display"
    content_file: "assets/consent.html"
    timing:
      min_duration: 5000         # Button disabled for 5s
      max_duration: 60000        # Auto-submit after 60s
      show_timer: true           # Visible countdown
      on_timeout: "auto_submit"

  - id: "exclusive_game_task"
    type: "iframe_sandbox"
    source: "/tasks/resource_game.html"
    
    # GLOBAL QUOTA: Dynamic disabling based on completed blocks
    quota:
      limit: 20
      strategy: "skip_if_full"   # If 20 users finished, skip to next stage
      fallback_stage: "alternative_questionnaire"
    
    # SYNC: Wait for specific message from Iframe before allowing "Next"
    completion_trigger: "GAME_COMPLETED"

  - id: "feedback"
    type: "questionnaire"
    questions:
      - id: "difficulty"
        type: "likert_scale"
        range: [1, 7]
        visual_theme: "faces"    # Renders 1=Sad -> 7=Happy faces

```

---

## 5. Module 3: Component Ecosystem & Iframe Bridge

### 5.1 The "Single Logs Center" Strategy

To ensure all data (including that from external Iframes) ends up in one place, the Shell acts as a **Proxy**.

**The Protocol (window.postMessage):**

1. **Iframe (Source):** The external game/task sends a standard message.
```javascript
// Inside the Iframe
window.parent.postMessage({
  type: "BIRES_LOG",
  payload: { event: "enemy_killed", score: 100 }
}, "*");

```


2. **Shell (Proxy):** The React app listens for this event.
* Validates origin.
* Injects Context: Adds `user_id`, `session_id`, `stage_id`, and `timestamp`.
* Forwards to Backend: `POST /api/logs`.


3. **Backend (Sink):** Writes the unified log to the configured databases.

### 5.2 Synchronization API

The system can control the block, and the block can control the system.

* **System  Block:** The Shell sends `{ type: "CMD", action: "START_TIMER" }` into the Iframe.
* **Block  System:** The Iframe sends `{ type: "STATUS", status: "COMPLETE" }` to unlock the "Next" button.

---

## 6. Module 4: Pluggable Data Layer

To satisfy the requirement *"Different DBs should be easily addable,"* the backend implements the **Strategy Design Pattern**.

### 6.1 Storage Adapters

The system loads a list of active adapters based on the environment configuration (e.g., `ACTIVE_STORAGE=mongo,csv`).

1. **`MongoAdapter` (Hot Storage):**
* Writes JSON documents to MongoDB.
* Used for real-time dashboards and atomic quota checks.


2. **`CSVAdapter` (Cold Storage):**
* Appends flattened logs to local CSV files.
* Serves as an immediate, human-readable backup.


3. **`SQLAdapter` (Future/Optional):**
* Maps logs to relational tables (PostgreSQL) using an ORM (SQLAlchemy).



### 6.2 Implementation

The Logger Service iterates through all active adapters asynchronously.

```python
# Pseudo-code for Backend Logger
async def log_event(event_data):
    tasks = []
    if 'mongo' in CONFIG: tasks.append(mongo_adapter.write(event_data))
    if 'csv' in CONFIG:   tasks.append(csv_adapter.write(event_data))
    if 'sql' in CONFIG:   tasks.append(sql_adapter.write(event_data))
    
    await asyncio.gather(*tasks) # Run all writes in parallel

```

---

## 7. Deployment & Technologies

### 7.1 Proposed Tech Stack

* **Frontend:** **React + TypeScript**. (TypeScript is critical for ensuring the YAML config matches the code expectations).
* **Backend:** **Python (FastAPI)**. Chosen for its native `async` support (handling 100 concurrent users easily) and ease of data manipulation.
* **Database:** **MongoDB** (Primary) + **File System** (CSV Backup).
* **Infrastructure:** **Docker Compose**.

### 7.2 Docker Deployment (User Experience)

The non-technical user downloads the package and runs one command:
`docker-compose up`

This spins up:

1. **App Container:** Running the Frontend and Backend.
2. **DB Container:** Running MongoDB.
3. **Nginx:** Handling routing and static files.
4. **Volume Mount:** Automatically maps a local `./logs` folder to the containers, so CSV logs appear on the host machine instantly.