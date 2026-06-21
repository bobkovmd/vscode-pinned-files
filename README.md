# Pinned Files — VS Code Extension

> Pin files to the sidebar, grouped by **Project → Folder → File**

[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85-blue)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/version-1.3.0-green)]()

## Features

- 📌 **Pin files** from Explorer (right-click), editor tab, or Command Palette
- 🗂️ **Grouped tree**: Project → Folder → File
- 💾 **Two storage modes**: `global` (shared across all workspaces) or `workspace` (per-project)
- ✕ **Unpin** at file, folder, or project level via right-click menu
- 🌐 **External Files** group for files outside any workspace folder
- 🔄 **LRU auto-close**: limit open tabs while protecting pinned files
- 📊 **Status bar** indicator showing current storage mode

## Panel view

```
PINNED FILES                          [⊖] [🗑]
▾ 📁 my-backend
  ▾ 📂 service
      📄 InsuranceService.java
      📄 PolicyMapper.java
  ▾ 📂 config
      📄 AppConfig.java
▾ 📁 frontend-app
  ▾ 📂 src/components
      📄 Dashboard.tsx
▾ 🌐 External Files
      📄 notes.md
```

## Storage scope (v1.3)

```jsonc
// settings.json
"pinnedFiles.storageScope": "global"   // or "workspace"
```

| Mode | Behaviour |
|------|-----------|
| `global` | One shared list across all workspaces. Closed projects shown as *not open*. |
| `workspace` | Separate list per workspace folder. Switch project — get its own pins. |

Both modes store data independently. Switching never loses data.

## All settings

| Setting | Default | Description |
|---------|:-------:|-------------|
| `pinnedFiles.storageScope` | `global` | `global` / `workspace` |
| `pinnedFiles.groupByFolder` | `true` | Group files by subfolder |
| `pinnedFiles.showRelativePath` | `true` | Show path (flat mode only) |
| `pinnedFiles.sortOrder` | `pinned` | `pinned` / `name` / `type` |
| `pinnedFiles.maxOpenEditors` | `0` | Max open tabs (0 = off) |
| `pinnedFiles.maxOpenEditorsNotify` | `true` | Notify on auto-close |

## Getting started

### Run in debug (F5)

```bash
npm install
# Open folder in VS Code → press F5
```

### Build .vsix and install

```bash
npm install
npm install -g @vscode/vsce
vsce package
# VS Code: Extensions → ··· → Install from VSIX
```

> Before publishing to Marketplace, set your `publisher` ID in `package.json`.
