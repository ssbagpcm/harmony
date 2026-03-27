# Harmony Project Docs

## Overview

Harmony is a Discord-like real-time chat application built with:

- FastAPI for the HTTP API and WebSocket gateway
- SQLAlchemy with SQLite for persistence
- A vanilla HTML/CSS/JavaScript frontend

This `new/` version keeps the same behavior as the main app, but the structure is cleaner and easier to navigate.

## Run The App

From the repository root:

```bash
cd new
../venv/bin/python main.py
```

The app will be available at:

- `http://localhost:8000/`
- Swagger: `http://localhost:8000/docs`

## Folder Structure

```text
new/
├── main.py
├── chatapp/
│   ├── __init__.py
│   ├── app.py
│   └── core.py
└── static/
    ├── index.html
    ├── styles.css
    ├── app.js
    └── PROJECT_DOCS.md
```

## Backend Structure

### `main.py`

Small launch entrypoint only.

### `chatapp/core.py`

Contains the shared backend foundation:

- configuration
- database engine and session factory
- ORM models
- Pydantic schemas
- permission helpers
- message helpers
- gateway manager
- shared utility functions

### `chatapp/app.py`

Contains the actual FastAPI application:

- lifespan setup
- static mounts
- REST routes
- WebSocket route exposure through the imported gateway manager

## Frontend Structure

### `static/index.html`

Contains the application markup only.

### `static/styles.css`

Contains the full UI styling.

### `static/app.js`

Contains all client-side logic:

- auth flow
- state management
- WebSocket handling
- server, DM, group, and message rendering
- modals, context menus, mentions, pins, and member list logic

## Core Features

- authentication with username and password
- direct messages
- group conversations
- server channels and categories
- roles and permissions
- replies, reactions, pins, and search
- live presence updates
- mentions and reply counters
- invite links and permanent share links
- server nicknames and role-based member ordering

## Quick Start Example

### Start the restructured app

```bash
cd new
../venv/bin/python main.py
```

### Open the application

```text
http://localhost:8000/
```

### Open the API docs

```text
http://localhost:8000/docs
```

## API Examples

### Register

```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"demo_user","password":"secret123"}'
```

### Login

```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo_user","password":"secret123"}'
```

### Create a server

```bash
curl -X POST http://localhost:8000/servers \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Server"}'
```

### Create a group chat

```bash
curl -X POST http://localhost:8000/users/@me/groups \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Weekend Plans","member_ids":["usr_x","usr_y"]}'
```

## WebSocket Example

### Gateway URL

```text
ws://localhost:8000/gateway?token=<JWT>
```

### Example payload

```json
{
  "op": "START_TYPING",
  "data": {
    "channel_id": "chn_123"
  }
}
```

## Frontend Notes

### Docs view

The bottom rail docs icon opens this Markdown file inside the main content area.
It is rendered as part of the UI, not as a raw file download page.

### Media handling

- images open in the enhanced media viewer
- audio files use embedded HTML audio players
- video files use embedded HTML video players only when the file is under `100MB`
- larger videos fall back to a downloadable file card

### Image viewer behavior

- mouse wheel zoom
- drag to pan when zoomed in
- toolbar buttons for zoom in, zoom out, reset, and open original

## Data Notes

This version keeps all runtime data inside the Harmony project root:

- database: `../database/discord.db`
- uploads: `../uploads/`

The required directories are created automatically when the app loads.

## Development Notes

- The frontend is still intentionally framework-free.
- Route behavior should remain aligned with the original application.
- The structure is cleaner, but the app is still feature-dense and fairly stateful.
- If you want the next cleanup pass, the best target is splitting `app.js` into modules by feature area.

## Practical Debug Checklist

1. Confirm the API starts without import errors.
2. Confirm `/static/index.html`, `/static/styles.css`, and `/static/app.js` are served.
3. Confirm login works and the token is stored locally.
4. Confirm the gateway connects after boot.
5. Confirm DMs, groups, and servers all still load from the shared database.
6. Confirm image, audio, and video attachments render with the correct viewer/player behavior.

## Suggested Next Refactors

1. Split API routes into files by domain:
   - auth
   - users
   - servers
   - channels
   - messages
   - invites
   - DMs
2. Split frontend logic into modules:
   - auth
   - rail/sidebar
   - messages
   - settings
   - invites/groups/friends
3. Reduce string-built HTML and move repeated UI blocks into render helpers.
4. Introduce end-to-end smoke tests for the most important real-time flows.
