# Changelog

## [1.3.0]
- **New**: `pinnedFiles.storageScope` setting — choose `global` or `workspace` storage
- Each scope stores data independently; switching never loses pins
- Status bar shows current scope with click-to-settings action
- In `global` mode, closed projects displayed with *not open* label

## [1.2.0]
- **New**: Tree grouped by Project → Folder → File
- **New**: Unpin at folder level and project level via right-click
- **New**: External Files group for files outside any workspace
- Store migrated from flat array to `Record<projectKey, string[]>`

## [1.1.0]
- **New**: LRU auto-close with pinned file protection
- **New**: `maxOpenEditors` and `maxOpenEditorsNotify` settings

## [1.0.0]
- Initial release: pin/unpin files, flat list in sidebar
