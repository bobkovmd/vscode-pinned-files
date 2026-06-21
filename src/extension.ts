import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ═══════════════════════════════════════════════════════════════════════════════
//  Storage abstraction
//  Switches between globalState and workspaceState via settings.
//  Each scope stores data independently — switching never loses data.
// ═══════════════════════════════════════════════════════════════════════════════

type Store = Record<string, string[]>;

class PinnedStorage {
    private readonly KEY = 'pinnedFiles.store';
    constructor(private ctx: vscode.ExtensionContext) {}

    private get scope(): 'global' | 'workspace' {
        return vscode.workspace
            .getConfiguration('pinnedFiles')
            .get<'global' | 'workspace'>('storageScope', 'global');
    }

    read(): Store {
        const raw = this.scope === 'global'
            ? this.ctx.globalState.get<Store>(this.KEY, {})
            : this.ctx.workspaceState.get<Store>(this.KEY, {});
        for (const key of Object.keys(raw)) {
            raw[key] = raw[key].filter(p => fs.existsSync(p));
            if (raw[key].length === 0) { delete raw[key]; }
        }
        return raw;
    }

    write(store: Store): void {
        if (this.scope === 'global') {
            this.ctx.globalState.update(this.KEY, store);
        } else {
            this.ctx.workspaceState.update(this.KEY, store);
        }
    }

    scopeLabel(): string {
        return this.scope === 'global' ? '$(globe) Global' : '$(folder) Workspace';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Node types
// ═══════════════════════════════════════════════════════════════════════════════

export type NodeKind = 'project' | 'folder' | 'file';

export class TreeNode extends vscode.TreeItem {
    public children: TreeNode[] = [];
    constructor(
        public readonly kind: NodeKind,
        label: string,
        collapsible: vscode.TreeItemCollapsibleState,
        public readonly fsPath?: string
    ) {
        super(label, collapsible);
        this.contextValue = kind === 'file' ? 'pinnedFile'
                          : kind === 'folder' ? 'pinnedFolder'
                          : 'pinnedProject';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LRU Editor Manager
// ═══════════════════════════════════════════════════════════════════════════════

class LruEditorManager {
    private lruQueue: string[] = [];
    private disposables: vscode.Disposable[] = [];

    constructor(private getPinnedFiles: () => Set<string>) { this.enable(); }

    private syncOpenEditors(): void {
        const open = new Set(
            vscode.window.tabGroups.all.flatMap(g => g.tabs)
                .filter(t => t.input instanceof vscode.TabInputText)
                .map(t => (t.input as vscode.TabInputText).uri.fsPath)
        );
        this.lruQueue = this.lruQueue.filter(p => open.has(p));
        for (const p of open) { if (!this.lruQueue.includes(p)) { this.lruQueue.push(p); } }
    }

    enable(): void {
        const onActive = vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor || editor.document.uri.scheme !== 'file') { return; }
            const fp = editor.document.uri.fsPath;
            this.lruQueue = this.lruQueue.filter(p => p !== fp);
            this.lruQueue.push(fp);
        });
        const onTabChange = vscode.window.tabGroups.onDidChangeTabs(async e => {
            for (const tab of e.closed) {
                if (tab.input instanceof vscode.TabInputText) {
                    this.lruQueue = this.lruQueue.filter(
                        p => p !== (tab.input as vscode.TabInputText).uri.fsPath);
                }
            }
            for (const tab of e.opened) {
                if (!(tab.input instanceof vscode.TabInputText)) { continue; }
                const fp = (tab.input as vscode.TabInputText).uri.fsPath;
                if (!this.lruQueue.includes(fp)) { this.lruQueue.push(fp); }
                await this.enforceLimit();
            }
        });
        this.disposables.push(onActive, onTabChange);
        this.syncOpenEditors();
    }

    private async enforceLimit(): Promise<void> {
        const cfg = vscode.workspace.getConfiguration('pinnedFiles');
        const limit = cfg.get<number>('maxOpenEditors', 0);
        if (limit <= 0) { return; }
        const pinned = this.getPinnedFiles();
        const allTabs = vscode.window.tabGroups.all.flatMap(g => g.tabs)
            .filter(t => t.input instanceof vscode.TabInputText);
        if (allTabs.length <= limit) { return; }
        const victim = this.lruQueue.find(fp => !pinned.has(fp));
        if (!victim) { return; }
        const tab = allTabs.find(t => (t.input as vscode.TabInputText).uri.fsPath === victim);
        if (!tab) { return; }
        await vscode.window.tabGroups.close(tab, false);
        if (cfg.get<boolean>('maxOpenEditorsNotify', true)) {
            vscode.window.setStatusBarMessage(
                `$(close) Auto-closed: ${path.basename(victim)}  (limit: ${limit} tabs)`, 4000);
        }
    }

    disable(): void { this.disposables.forEach(d => d.dispose()); this.disposables = []; }
    dispose(): void { this.disable(); }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Pinned Files Provider
// ═══════════════════════════════════════════════════════════════════════════════

export class PinnedFilesProvider implements vscode.TreeDataProvider<TreeNode> {
    private _change = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._change.event;

    private store: Store = {};
    private storage: PinnedStorage;

    constructor(private ctx: vscode.ExtensionContext) {
        this.storage = new PinnedStorage(ctx);
        this.store = this.storage.read();
    }

    reloadStore(): void { this.store = this.storage.read(); this._change.fire(); }
    private save(): void { this.storage.write(this.store); }
    refresh(): void { this._change.fire(); }

    private projectKeyFor(filePath: string): { key: string; root: string | undefined } {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            if (filePath.startsWith(folder.uri.fsPath)) {
                return { key: folder.name, root: folder.uri.fsPath };
            }
        }
        return { key: '__external__', root: undefined };
    }

    getPinnedSet(): Set<string> { return new Set(Object.values(this.store).flat()); }
    scopeLabel(): string { return this.storage.scopeLabel(); }

    pin(filePath: string): void {
        const { key } = this.projectKeyFor(filePath);
        if (!this.store[key]) { this.store[key] = []; }
        if (this.store[key].includes(filePath)) {
            vscode.window.showInformationMessage(`Already pinned: ${path.basename(filePath)}`);
            return;
        }
        this.store[key].push(filePath);
        this.save(); this.refresh();
        vscode.window.showInformationMessage(`📌 Pinned: ${path.basename(filePath)}`);
    }

    unpin(filePath: string): void {
        for (const key of Object.keys(this.store)) {
            const idx = this.store[key].indexOf(filePath);
            if (idx !== -1) {
                this.store[key].splice(idx, 1);
                if (this.store[key].length === 0) { delete this.store[key]; }
                this.save(); this.refresh(); return;
            }
        }
    }

    unpinFolder(projectKey: string, folderPath: string): void {
        if (!this.store[projectKey]) { return; }
        this.store[projectKey] = this.store[projectKey].filter(p => path.dirname(p) !== folderPath);
        if (this.store[projectKey].length === 0) { delete this.store[projectKey]; }
        this.save(); this.refresh();
    }

    unpinProject(projectKey: string): void {
        delete this.store[projectKey]; this.save(); this.refresh();
    }

    clearAll(): void { this.store = {}; this.save(); this.refresh(); }
    hasPinned(): boolean { return Object.keys(this.store).length > 0; }

    getTreeItem(node: TreeNode): vscode.TreeItem { return node; }
    getChildren(node?: TreeNode): TreeNode[] { return node ? node.children : this.buildRoots(); }

    private buildRoots(): TreeNode[] {
        const cfg = vscode.workspace.getConfiguration('pinnedFiles');
        const groupByFolder = cfg.get<boolean>('groupByFolder', true);
        const sortOrder = cfg.get<string>('sortOrder', 'pinned');
        const scope = cfg.get<string>('storageScope', 'global');
        const folders = vscode.workspace.workspaceFolders ?? [];

        let projectKeys: string[];
        if (scope === 'workspace') {
            projectKeys = [
                ...folders.map(f => f.name),
                ...(this.store['__external__'] ? ['__external__'] : [])
            ].filter(k => this.store[k]?.length > 0);
        } else {
            const openNames = new Set(folders.map(f => f.name));
            const allKeys = Object.keys(this.store).filter(k => this.store[k].length > 0);
            projectKeys = [...new Set([
                ...allKeys.filter(k => openNames.has(k) || k === '__external__'),
                ...allKeys.filter(k => !openNames.has(k) && k !== '__external__')
            ])];
        }

        return projectKeys.map(key => {
            const files = this.store[key];
            const wsFolder = folders.find(f => f.name === key);
            const rootPath = wsFolder?.uri.fsPath;
            const isOpen = !!wsFolder;

            const projectNode = new TreeNode(
                'project', key === '__external__' ? 'External Files' : key,
                vscode.TreeItemCollapsibleState.Expanded
            );
            projectNode.iconPath = key === '__external__'
                ? new vscode.ThemeIcon('globe')
                : isOpen ? new vscode.ThemeIcon('root-folder') : new vscode.ThemeIcon('root-folder-opened');
            if (scope === 'global' && !isOpen && key !== '__external__') {
                projectNode.description = 'not open';
            }
            projectNode.id = `project:${key}`;
            projectNode.children = groupByFolder
                ? this.buildFolderNodes(key, files, rootPath, sortOrder)
                : this.buildFileNodes(files, rootPath, sortOrder);
            return projectNode;
        });
    }

    private buildFolderNodes(
        projectKey: string, files: string[],
        rootPath: string | undefined, sortOrder: string
    ): TreeNode[] {
        const byFolder = new Map<string, string[]>();
        for (const fp of files) {
            const dir = path.dirname(fp);
            if (!byFolder.has(dir)) { byFolder.set(dir, []); }
            byFolder.get(dir)!.push(fp);
        }
        return [...byFolder.keys()]
            .sort((a, b) => {
                const ra = rootPath ? path.relative(rootPath, a) : a;
                const rb = rootPath ? path.relative(rootPath, b) : b;
                return ra.localeCompare(rb);
            })
            .map(dir => {
                const relDir = rootPath ? path.relative(rootPath, dir) : dir;
                const folderNode = new TreeNode(
                    'folder', relDir || '.', vscode.TreeItemCollapsibleState.Expanded
                );
                folderNode.iconPath = new vscode.ThemeIcon('folder');
                folderNode.id = `folder:${projectKey}:${dir}`;
                folderNode.children = this.buildFileNodes(byFolder.get(dir)!, rootPath, sortOrder);
                return folderNode;
            });
    }

    private buildFileNodes(
        files: string[], rootPath: string | undefined, sortOrder: string
    ): TreeNode[] {
        let sorted = [...files];
        if (sortOrder === 'name') {
            sorted.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
        } else if (sortOrder === 'type') {
            sorted.sort((a, b) =>
                path.extname(a).localeCompare(path.extname(b)) ||
                path.basename(a).localeCompare(path.basename(b)));
        }
        const cfg = vscode.workspace.getConfiguration('pinnedFiles');
        const showRel = cfg.get<boolean>('showRelativePath', true);
        const groupByFolder = cfg.get<boolean>('groupByFolder', true);

        return sorted.map(fp => {
            const name = path.basename(fp);
            const node = new TreeNode('file', name, vscode.TreeItemCollapsibleState.None, fp);
            node.resourceUri = vscode.Uri.file(fp);
            node.iconPath = vscode.ThemeIcon.File;
            node.command = { command: 'pinnedFiles.openFile', title: 'Open', arguments: [fp] };
            const rel = rootPath ? path.relative(rootPath, fp) : fp;
            node.tooltip = new vscode.MarkdownString(`**${name}**\n\n\`${rel}\``);
            if (showRel && !groupByFolder) {
                node.description = rel !== name ? path.dirname(rel) : undefined;
            }
            return node;
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Activate
// ═══════════════════════════════════════════════════════════════════════════════

export function activate(ctx: vscode.ExtensionContext) {
    const provider = new PinnedFilesProvider(ctx);
    const tv = vscode.window.createTreeView('pinnedFilesView', {
        treeDataProvider: provider, canSelectMany: false, showCollapseAll: true
    });
    const lru = new LruEditorManager(() => provider.getPinnedSet());

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    const updateStatusBar = () => {
        statusBar.text = `📌 ${provider.scopeLabel()}`;
        statusBar.tooltip = 'Pinned Files storage scope. Click to open Settings.';
        statusBar.command = 'workbench.action.openSettings';
        statusBar.show();
    };
    updateStatusBar();

    ctx.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('pinnedFiles')) {
                if (e.affectsConfiguration('pinnedFiles.storageScope')) {
                    provider.reloadStore();
                } else {
                    provider.refresh();
                }
                updateStatusBar();
                lru.disable(); lru.enable();
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh())
    );

    const r = (cmd: string, fn: (...a: any[]) => any) =>
        vscode.commands.registerCommand(cmd, fn);

    ctx.subscriptions.push(
        tv, lru, statusBar,
        r('pinnedFiles.pinActiveEditor', () => {
            const fp = vscode.window.activeTextEditor?.document.uri.fsPath;
            fp ? provider.pin(fp) : vscode.window.showWarningMessage('No active editor');
        }),
        r('pinnedFiles.pin', (uri?: vscode.Uri) => {
            const fp = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
            fp ? provider.pin(fp) : vscode.window.showWarningMessage('No file selected');
        }),
        r('pinnedFiles.pinFromExplorer', (uri: vscode.Uri) => { if (uri) { provider.pin(uri.fsPath); } }),
        r('pinnedFiles.unpin', (node: TreeNode) => { if (node.fsPath) { provider.unpin(node.fsPath); } }),
        r('pinnedFiles.unpinFolder', (node: TreeNode) => {
            if (node.id) {
                const parts = node.id.split(':');
                provider.unpinFolder(parts[1], parts.slice(2).join(':'));
            }
        }),
        r('pinnedFiles.unpinProject', (node: TreeNode) => {
            if (node.id) { provider.unpinProject(node.id.split(':').slice(1).join(':')); }
        }),
        r('pinnedFiles.clearAll', async () => {
            if (!provider.hasPinned()) { return; }
            const ok = await vscode.window.showWarningMessage(
                'Remove all pinned files?', { modal: true }, 'Yes');
            if (ok === 'Yes') { provider.clearAll(); }
        }),
        r('pinnedFiles.openFile', async (fp: string) => {
            try {
                const doc = await vscode.workspace.openTextDocument(fp);
                await vscode.window.showTextDocument(doc, { preview: false });
            } catch { vscode.window.showErrorMessage(`Cannot open: ${fp}`); }
        }),
        r('pinnedFiles.revealInExplorer', (node: TreeNode) => {
            if (node.fsPath) {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(node.fsPath));
            }
        }),
        r('pinnedFiles.copyPath', (node: TreeNode) => {
            if (node.fsPath) { vscode.env.clipboard.writeText(node.fsPath); }
        }),
        r('pinnedFiles.copyRelativePath', (node: TreeNode) => {
            if (node.fsPath) {
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                vscode.env.clipboard.writeText(
                    root ? path.relative(root, node.fsPath) : node.fsPath);
            }
        })
    );
}

export function deactivate() {}