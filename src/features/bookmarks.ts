import * as vscode from 'vscode';
import * as path from 'path';
import { ComponentNode } from '../types';

/**
 * Bookmark entry
 */
export interface Bookmark {
  id: string;
  componentId?: string;
  filePath: string;
  fileName: string;
  name: string;
  line?: number;
  type?: string;
  color: BookmarkColor;
  note?: string;
  createdAt: number;
  isPinned: boolean;
}

/**
 * Available bookmark colors
 */
export type BookmarkColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink';

/**
 * Bookmark color definitions
 */
export const BOOKMARK_COLORS: Record<BookmarkColor, { hex: string; name: string }> = {
  red: { hex: '#ef4444', name: 'Red' },
  orange: { hex: '#f97316', name: 'Orange' },
  yellow: { hex: '#eab308', name: 'Yellow' },
  green: { hex: '#22c55e', name: 'Green' },
  blue: { hex: '#3b82f6', name: 'Blue' },
  purple: { hex: '#a855f7', name: 'Purple' },
  pink: { hex: '#ec4899', name: 'Pink' }
};

/**
 * Bookmarks Manager
 * 
 * Allows users to bookmark/pin important components for quick access.
 */
export class BookmarksManager {
  private bookmarks: Map<string, Bookmark> = new Map();
  private stateCallbacks: ((bookmarks: Bookmark[]) => void)[] = [];
  private context: vscode.ExtensionContext | null = null;

  constructor() {}

  /**
   * Initialize with extension context
   */
  initialize(context: vscode.ExtensionContext): void {
    this.context = context;

    // Load saved bookmarks
    const saved = context.globalState.get<Bookmark[]>('codeflowBookmarks');
    if (saved) {
      saved.forEach(b => this.bookmarks.set(b.id, b));
    }

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('codeflow.addBookmark', (componentId?: string) =>
        this.addBookmark(componentId)
      ),
      vscode.commands.registerCommand('codeflow.removeBookmark', (bookmarkId: string) =>
        this.removeBookmark(bookmarkId)
      ),
      vscode.commands.registerCommand('codeflow.toggleBookmarkPin', (bookmarkId: string) =>
        this.togglePin(bookmarkId)
      ),
      vscode.commands.registerCommand('codeflow.goToBookmark', (bookmarkId: string) =>
        this.goToBookmark(bookmarkId)
      ),
      vscode.commands.registerCommand('codeflow.showBookmarks', () =>
        this.showBookmarksQuickPick()
      ),
      vscode.commands.registerCommand('codeflow.clearAllBookmarks', () =>
        this.clearAllBookmarks()
      )
    );

    // Register decoration type for bookmarked lines
    this.registerDecorations();
  }

  /**
   * Register line decorations for bookmarks
   */
  private registerDecorations(): void {
    // Could add gutter icons or line highlights for bookmarked files
  }

  /**
   * Register callback for bookmark changes
   */
  onBookmarksChange(callback: (bookmarks: Bookmark[]) => void): void {
    this.stateCallbacks.push(callback);
  }

  /**
   * Notify callbacks of bookmark change
   */
  private notifyChange(): void {
    const bookmarks = this.getAllBookmarks();
    this.stateCallbacks.forEach(cb => cb(bookmarks));
    this.saveBookmarks();
  }

  /**
   * Save bookmarks to global state
   */
  private saveBookmarks(): void {
    if (this.context) {
      const bookmarks = Array.from(this.bookmarks.values());
      this.context.globalState.update('codeflowBookmarks', bookmarks);
    }
  }

  /**
   * Add a bookmark
   */
  async addBookmark(componentId?: string, component?: ComponentNode): Promise<void> {
    let filePath: string;
    let name: string;
    let line: number | undefined;
    let type: string | undefined;

    if (component) {
      filePath = component.filePath;
      name = component.name;
      line = component.line;
      type = component.type;
    } else if (componentId) {
      // Would need graph access to resolve
      vscode.window.showWarningMessage('CodeFlow: Component not found');
      return;
    } else {
      // Use active editor
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('CodeFlow: No file open');
        return;
      }
      filePath = editor.document.uri.fsPath;
      name = path.basename(filePath);
      line = editor.selection.active.line + 1;
    }

    // Check if already bookmarked
    const existing = Array.from(this.bookmarks.values()).find(
      b => b.filePath === filePath && b.line === line
    );
    if (existing) {
      vscode.window.showInformationMessage('CodeFlow: Already bookmarked');
      return;
    }

    // Ask for color
    const colorItems = Object.entries(BOOKMARK_COLORS).map(([key, value]) => ({
      label: `$(circle-filled) ${value.name}`,
      color: key as BookmarkColor,
      description: value.hex
    }));

    const selectedColor = await vscode.window.showQuickPick(colorItems, {
      placeHolder: 'Select bookmark color'
    });

    if (!selectedColor) {return;}

    // Ask for optional note
    const note = await vscode.window.showInputBox({
      prompt: 'Add a note (optional)',
      placeHolder: 'e.g., Needs refactoring'
    });

    const bookmark: Bookmark = {
      id: `bookmark_${Date.now()}`,
      componentId,
      filePath,
      fileName: path.basename(filePath),
      name,
      line,
      type,
      color: selectedColor.color,
      note: note || undefined,
      createdAt: Date.now(),
      isPinned: false
    };

    this.bookmarks.set(bookmark.id, bookmark);
    this.notifyChange();

    vscode.window.showInformationMessage(`CodeFlow: Bookmarked ${name}`);
  }

  /**
   * Add bookmark from component
   */
  addComponentBookmark(component: ComponentNode, color: BookmarkColor = 'blue'): void {
    const bookmark: Bookmark = {
      id: `bookmark_${Date.now()}`,
      componentId: component.id,
      filePath: component.filePath,
      fileName: path.basename(component.filePath),
      name: component.name,
      line: component.line,
      type: component.type,
      color,
      createdAt: Date.now(),
      isPinned: false
    };

    this.bookmarks.set(bookmark.id, bookmark);
    this.notifyChange();
  }

  /**
   * Remove a bookmark
   */
  removeBookmark(bookmarkId: string): void {
    if (this.bookmarks.delete(bookmarkId)) {
      this.notifyChange();
    }
  }

  /**
   * Toggle pin status
   */
  togglePin(bookmarkId: string): void {
    const bookmark = this.bookmarks.get(bookmarkId);
    if (bookmark) {
      bookmark.isPinned = !bookmark.isPinned;
      this.notifyChange();
    }
  }

  /**
   * Go to a bookmark
   */
  async goToBookmark(bookmarkId: string): Promise<void> {
    const bookmark = this.bookmarks.get(bookmarkId);
    if (!bookmark) {return;}

    try {
      const document = await vscode.workspace.openTextDocument(bookmark.filePath);
      const editor = await vscode.window.showTextDocument(document);

      if (bookmark.line) {
        const position = new vscode.Position(bookmark.line - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(`CodeFlow: Failed to open ${bookmark.fileName}`);
    }
  }

  /**
   * Get all bookmarks
   */
  getAllBookmarks(): Bookmark[] {
    return Array.from(this.bookmarks.values())
      .sort((a, b) => {
        // Pinned first, then by creation date
        if (a.isPinned !== b.isPinned) {
          return a.isPinned ? -1 : 1;
        }
        return b.createdAt - a.createdAt;
      });
  }

  /**
   * Get pinned bookmarks
   */
  getPinnedBookmarks(): Bookmark[] {
    return this.getAllBookmarks().filter(b => b.isPinned);
  }

  /**
   * Get bookmarks by color
   */
  getBookmarksByColor(color: BookmarkColor): Bookmark[] {
    return this.getAllBookmarks().filter(b => b.color === color);
  }

  /**
   * Check if a component is bookmarked
   */
  isBookmarked(componentId: string): boolean {
    return Array.from(this.bookmarks.values()).some(b => b.componentId === componentId);
  }

  /**
   * Get bookmark for a component
   */
  getBookmarkForComponent(componentId: string): Bookmark | undefined {
    return Array.from(this.bookmarks.values()).find(b => b.componentId === componentId);
  }

  /**
   * Show bookmarks in quick pick
   */
  async showBookmarksQuickPick(): Promise<void> {
    const bookmarks = this.getAllBookmarks();
    
    if (bookmarks.length === 0) {
      vscode.window.showInformationMessage('CodeFlow: No bookmarks yet');
      return;
    }

    const items = bookmarks.map(b => ({
      label: `${b.isPinned ? '📌 ' : ''}${this.getColorEmoji(b.color)} ${b.name}`,
      description: b.fileName + (b.line ? `:${b.line}` : ''),
      detail: b.note,
      bookmarkId: b.id
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a bookmark to open',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (selected) {
      await this.goToBookmark(selected.bookmarkId);
    }
  }

  /**
   * Clear all bookmarks
   */
  async clearAllBookmarks(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `CodeFlow: Clear all ${this.bookmarks.size} bookmarks?`,
      { modal: true },
      'Clear All'
    );

    if (confirm === 'Clear All') {
      this.bookmarks.clear();
      this.notifyChange();
      vscode.window.showInformationMessage('CodeFlow: All bookmarks cleared');
    }
  }

  /**
   * Update bookmark note
   */
  async updateBookmarkNote(bookmarkId: string): Promise<void> {
    const bookmark = this.bookmarks.get(bookmarkId);
    if (!bookmark) {return;}

    const note = await vscode.window.showInputBox({
      prompt: 'Update note',
      value: bookmark.note || '',
      placeHolder: 'Enter a note for this bookmark'
    });

    if (note !== undefined) {
      bookmark.note = note || undefined;
      this.notifyChange();
    }
  }

  /**
   * Change bookmark color
   */
  async changeBookmarkColor(bookmarkId: string): Promise<void> {
    const bookmark = this.bookmarks.get(bookmarkId);
    if (!bookmark) {return;}

    const colorItems = Object.entries(BOOKMARK_COLORS).map(([key, value]) => ({
      label: `$(circle-filled) ${value.name}`,
      color: key as BookmarkColor
    }));

    const selected = await vscode.window.showQuickPick(colorItems, {
      placeHolder: 'Select new color'
    });

    if (selected) {
      bookmark.color = selected.color;
      this.notifyChange();
    }
  }

  /**
   * Get color emoji for display
   */
  private getColorEmoji(color: BookmarkColor): string {
    const emojis: Record<BookmarkColor, string> = {
      red: '🔴',
      orange: '🟠',
      yellow: '🟡',
      green: '🟢',
      blue: '🔵',
      purple: '🟣',
      pink: '💗'
    };
    return emojis[color] || '⚪';
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stateCallbacks = [];
  }
}

// Singleton
let bookmarksManager: BookmarksManager | null = null;

export function getBookmarksManager(): BookmarksManager {
  if (!bookmarksManager) {
    bookmarksManager = new BookmarksManager();
  }
  return bookmarksManager;
}
