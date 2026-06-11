# Runtime Data Layout

Runtime persistence should be stored under:

`data/users/{userId}/projects/{projectId}/sessions/{sessionId}/`

Recommended subpaths:

- `user_memory.md`
- `projects/{projectId}/project_memory.md`
- `projects/{projectId}/task_contract.json`
- `projects/{projectId}/workspace/raw/`
- `projects/{projectId}/workspace/processed/`
- `projects/{projectId}/workspace/charts/`
- `projects/{projectId}/workspace/reports/`
- `projects/{projectId}/sessions/{sessionId}/messages.json`
- `projects/{projectId}/sessions/{sessionId}/session_memory.md`
