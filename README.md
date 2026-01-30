# B-IRES - Bar-Ilan Research Evaluation System

A comprehensive web-based platform for designing, deploying, and managing behavioral experiments with YAML-driven configuration.

## Features

- **YAML-Driven Configuration**: Define experiments using structured YAML files
- **Backend-Authoritative State**: Server controls all state transitions for security
- **Offline Support**: IndexedDB queue for participant data when offline
- **Role-Based Access**: Admin, Researcher, and Viewer roles
- **Asset Management**: S3/MinIO-based media library
- **Multi-Theme Support**: Semantic themes (clinical_blue, dark_research, high_contrast)
- **Export Options**: CSV (wide/long format) and JSON export
- **Quota Management**: Atomic reservations with Redis for concurrent access

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Git

### Development Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd experiments_platrofm_v1
```

2. Copy environment file:
```bash
cp env.example .env
```

3. Start the development environment:
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

4. Access the applications:
   - **Experiment Shell**: http://localhost:3000
   - **Admin Dashboard**: http://localhost:3001
   - **API Documentation**: http://localhost:8000/api/docs
   - **MinIO Console**: http://localhost:9001 (minioadmin / minioadmin123)
   - **Mongo Express**: http://localhost:8081 (admin / admin123)

### Production Deployment

1. Update `.env` with production values (especially `JWT_SECRET`)

2. Start production services:
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

3. Configure SSL certificates in `nginx/ssl/` directory

## Project Structure

```
bires/
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── api/            # API routes
│   │   ├── core/           # Config, database, security
│   │   ├── models/         # Pydantic schemas
│   │   └── services/       # Business logic
│   └── requirements.txt
├── frontend/
│   ├── experiment-shell/   # Participant-facing SPA
│   └── admin-dashboard/    # Admin/researcher GUI
├── themes/                 # Theme definitions
├── experiments/            # Experiment configurations
├── nginx/                  # Reverse proxy config
└── docker-compose.yml      # Docker orchestration
```

## Creating an Experiment

1. Log in to the Admin Dashboard
2. Navigate to "Experiments" → "New Experiment"
3. Use the YAML editor to configure your experiment
4. Click "Save" and then "Publish"

### Example Experiment YAML

```yaml
meta:
  id: "demo_study"
  version: "1.0.0"
  name: "Demo Study"

shell_config:
  theme: "clinical_blue"
  progress:
    show_progress_bar: true

stages:
  - id: "consent"
    type: "consent_form"
    label: "Informed Consent"
    content_type: "html"
    content: |
      <h2>Research Study Consent</h2>
      <p>By checking below, you agree to participate.</p>

  - id: "demographics"
    type: "user_info"
    label: "About You"
    fields:
      - field: "age"
        label: "Age"
        type: "number"
        required: true
        min: 18
        max: 120
      - field: "gender"
        label: "Gender"
        type: "select"
        required: true
        options:
          - value: "male"
            label: "Male"
          - value: "female"
            label: "Female"
          - value: "other"
            label: "Other"

  - id: "survey"
    type: "questionnaire"
    label: "Survey"
    questions:
      - id: "satisfaction"
        text: "How satisfied are you?"
        type: "likert_scale"
        range: [1, 7]
```

## API Documentation

The API documentation is available at `/api/docs` when running in development mode.

### Key Endpoints

- `POST /api/auth/login` - User authentication
- `POST /api/sessions/start` - Start experiment session
- `POST /api/sessions/{id}/submit` - Submit stage data
- `GET /api/experiments` - List experiments
- `POST /api/assets/upload` - Upload media files
- `GET /api/export/{id}/csv` - Export data as CSV

## Block Types

| Type | Description |
|------|-------------|
| `user_info` | Demographic collection form |
| `questionnaire` | Questions with various input types |
| `content_display` | Text, HTML, or rich content |
| `video_player` | Video with playback tracking |
| `iframe_sandbox` | External tasks/games |
| `likert_scale` | Visual scale with faces |
| `consent_form` | Legal consent with checkbox |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret key for JWT tokens | Required |
| `MONGO_URL` | MongoDB connection string | `mongodb://mongo:27017` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `MINIO_ENDPOINT` | MinIO/S3 endpoint | `minio:9000` |
| `ENVIRONMENT` | `development` or `production` | `development` |

## Technology Stack

- **Backend**: FastAPI (Python 3.11+)
- **Frontend**: React 18 + TypeScript + Zustand
- **Database**: MongoDB 7
- **Cache/Sessions**: Redis
- **Object Storage**: MinIO (S3-compatible)
- **Reverse Proxy**: Nginx

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details

