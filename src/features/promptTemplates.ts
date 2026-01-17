import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Prompt template definition
 */
export interface PromptTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  prompt: string;
  category: 'refactor' | 'test' | 'docs' | 'fix' | 'feature' | 'custom';
  requiresSelection?: boolean;
  requiresFile?: boolean;
}

/**
 * Built-in prompt templates for common coding tasks
 */
export const BUILT_IN_TEMPLATES: PromptTemplate[] = [
  // Refactoring
  {
    id: 'add-error-handling',
    name: 'Add Error Handling',
    icon: '🛡️',
    description: 'Add try-catch blocks and proper error handling',
    prompt: 'Add comprehensive error handling to this code. Include try-catch blocks, proper error types, and meaningful error messages. Ensure errors are logged appropriately.',
    category: 'refactor',
    requiresSelection: true
  },
  {
    id: 'add-typescript-types',
    name: 'Add TypeScript Types',
    icon: '📝',
    description: 'Add or improve TypeScript type annotations',
    prompt: 'Add complete TypeScript type annotations to this code. Create interfaces for object shapes, use proper generic types where appropriate, and ensure strict type safety.',
    category: 'refactor',
    requiresSelection: true
  },
  {
    id: 'refactor-performance',
    name: 'Optimize Performance',
    icon: '⚡',
    description: 'Refactor for better performance',
    prompt: 'Analyze and optimize this code for performance. Consider memoization, reducing re-renders (if React), optimizing loops, and caching where appropriate. Explain each optimization.',
    category: 'refactor',
    requiresSelection: true
  },
  {
    id: 'simplify-code',
    name: 'Simplify & Clean Up',
    icon: '✨',
    description: 'Simplify complex code and improve readability',
    prompt: 'Simplify this code to improve readability. Remove redundancy, use modern syntax, extract helper functions if needed, and follow best practices. Keep the same functionality.',
    category: 'refactor',
    requiresSelection: true
  },
  {
    id: 'extract-component',
    name: 'Extract Component',
    icon: '📦',
    description: 'Extract selection into a reusable component',
    prompt: 'Extract this code into a reusable component/function. Create proper props/parameters interface, handle edge cases, and make it configurable where sensible.',
    category: 'refactor',
    requiresSelection: true
  },

  // Testing
  {
    id: 'write-unit-tests',
    name: 'Write Unit Tests',
    icon: '🧪',
    description: 'Generate unit tests for selected code',
    prompt: 'Write comprehensive unit tests for this code. Include tests for: happy path, edge cases, error conditions, and boundary values. Use appropriate testing patterns and mocking.',
    category: 'test',
    requiresFile: true
  },
  {
    id: 'write-integration-tests',
    name: 'Write Integration Tests',
    icon: '🔗',
    description: 'Generate integration tests',
    prompt: 'Write integration tests for this code. Test how components/modules work together, mock external dependencies appropriately, and cover realistic user scenarios.',
    category: 'test',
    requiresFile: true
  },
  {
    id: 'add-test-coverage',
    name: 'Improve Test Coverage',
    icon: '📊',
    description: 'Add tests for uncovered code paths',
    prompt: 'Analyze this code and add tests for any uncovered code paths. Focus on branches, error handlers, and edge cases that might be missing from existing tests.',
    category: 'test',
    requiresFile: true
  },

  // Documentation
  {
    id: 'add-jsdoc',
    name: 'Add JSDoc Comments',
    icon: '📚',
    description: 'Add JSDoc documentation comments',
    prompt: 'Add comprehensive JSDoc comments to this code. Include @param, @returns, @throws, @example where appropriate. Document complex logic with inline comments.',
    category: 'docs',
    requiresSelection: true
  },
  {
    id: 'write-readme',
    name: 'Generate README',
    icon: '📖',
    description: 'Generate README documentation for this file/module',
    prompt: 'Generate README documentation for this code. Include: overview, installation/setup, usage examples, API reference, and any configuration options.',
    category: 'docs',
    requiresFile: true
  },
  {
    id: 'explain-code',
    name: 'Explain This Code',
    icon: '🎓',
    description: 'Get a detailed explanation of the code',
    prompt: 'Explain this code in detail. Cover: what it does, how it works, any patterns used, potential gotchas, and suggestions for improvement.',
    category: 'docs',
    requiresSelection: true
  },

  // Bug Fixes
  {
    id: 'find-bugs',
    name: 'Find Potential Bugs',
    icon: '🐛',
    description: 'Analyze code for potential bugs',
    prompt: 'Analyze this code for potential bugs, race conditions, memory leaks, and security vulnerabilities. List each issue found with severity and suggested fix.',
    category: 'fix',
    requiresSelection: true
  },
  {
    id: 'fix-typescript-errors',
    name: 'Fix TypeScript Errors',
    icon: '🔧',
    description: 'Fix TypeScript compilation errors',
    prompt: 'Fix all TypeScript errors in this code. Ensure proper types, handle null/undefined cases, and resolve any type mismatches while maintaining the intended functionality.',
    category: 'fix',
    requiresSelection: true
  },
  {
    id: 'fix-eslint',
    name: 'Fix Linting Issues',
    icon: '🧹',
    description: 'Fix ESLint/linting issues',
    prompt: 'Fix all linting issues in this code following best practices. Address any eslint errors and warnings while maintaining code functionality.',
    category: 'fix',
    requiresSelection: true
  },

  // Features
  {
    id: 'add-loading-state',
    name: 'Add Loading State',
    icon: '⏳',
    description: 'Add loading state handling',
    prompt: 'Add proper loading state handling to this code. Include loading indicators, disable interactions during load, and handle the transition between states gracefully.',
    category: 'feature',
    requiresSelection: true
  },
  {
    id: 'add-validation',
    name: 'Add Input Validation',
    icon: '✅',
    description: 'Add input validation',
    prompt: 'Add comprehensive input validation to this code. Validate all user inputs, show appropriate error messages, and prevent invalid data from being processed.',
    category: 'feature',
    requiresSelection: true
  },
  {
    id: 'add-logging',
    name: 'Add Logging',
    icon: '📋',
    description: 'Add logging and monitoring',
    prompt: 'Add appropriate logging to this code. Include debug logs for development, info logs for important operations, and error logs with context. Use structured logging format.',
    category: 'feature',
    requiresSelection: true
  },
  {
    id: 'make-accessible',
    name: 'Improve Accessibility',
    icon: '♿',
    description: 'Improve accessibility (a11y)',
    prompt: 'Improve the accessibility of this code. Add ARIA labels, ensure keyboard navigation, proper focus management, screen reader support, and sufficient color contrast.',
    category: 'feature',
    requiresSelection: true
  }
];

/**
 * Prompt Templates Manager
 */
export class PromptTemplateManager {
  private customTemplates: PromptTemplate[] = [];
  private stateCallbacks: ((templates: PromptTemplate[]) => void)[] = [];

  constructor() {
    this.loadCustomTemplates();
  }

  /**
   * Initialize with extension context
   */
  initialize(context: vscode.ExtensionContext): void {
    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('codeflow.runPromptTemplate', (templateId: string) =>
        this.runTemplate(templateId)
      ),
      vscode.commands.registerCommand('codeflow.showPromptTemplates', () =>
        this.showTemplateQuickPick()
      ),
      vscode.commands.registerCommand('codeflow.createCustomTemplate', () =>
        this.createCustomTemplate()
      )
    );

    // Load saved custom templates
    const saved = context.globalState.get<PromptTemplate[]>('customPromptTemplates');
    if (saved) {
      this.customTemplates = saved;
    }
  }

  /**
   * Get all templates (built-in + custom)
   */
  getAllTemplates(): PromptTemplate[] {
    return [...BUILT_IN_TEMPLATES, ...this.customTemplates];
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category: PromptTemplate['category']): PromptTemplate[] {
    return this.getAllTemplates().filter(t => t.category === category);
  }

  /**
   * Register callback for template changes
   */
  onTemplatesChange(callback: (templates: PromptTemplate[]) => void): void {
    this.stateCallbacks.push(callback);
  }

  /**
   * Load custom templates from settings
   */
  private loadCustomTemplates(): void {
    const config = vscode.workspace.getConfiguration('codeflow');
    const custom = config.get<PromptTemplate[]>('customPromptTemplates') || [];
    this.customTemplates = custom.map(t => ({ ...t, category: 'custom' as const }));
  }

  /**
   * Run a prompt template
   */
  async runTemplate(templateId: string): Promise<void> {
    const template = this.getAllTemplates().find(t => t.id === templateId);
    if (!template) {
      vscode.window.showErrorMessage(`CodeFlow: Template not found: ${templateId}`);
      return;
    }

    const editor = vscode.window.activeTextEditor;
    
    // Check requirements
    if (template.requiresSelection && (!editor || editor.selection.isEmpty)) {
      vscode.window.showWarningMessage('CodeFlow: Please select some code first');
      return;
    }

    if (template.requiresFile && !editor) {
      vscode.window.showWarningMessage('CodeFlow: Please open a file first');
      return;
    }

    // Build the full prompt
    let fullPrompt = template.prompt;
    
    if (editor) {
      const fileName = path.basename(editor.document.fileName);
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      const fileContent = editor.document.getText();

      if (!selection.isEmpty) {
        fullPrompt = `File: ${fileName}\n\nSelected code:\n\`\`\`\n${selectedText}\n\`\`\`\n\n${template.prompt}`;
      } else if (template.requiresFile) {
        fullPrompt = `File: ${fileName}\n\nCode:\n\`\`\`\n${fileContent}\n\`\`\`\n\n${template.prompt}`;
      }
    }

    // Copy to clipboard
    await vscode.env.clipboard.writeText(fullPrompt);
    
    vscode.window.showInformationMessage(
      `CodeFlow: "${template.name}" prompt copied to clipboard. Paste in Claude CLI.`,
      'Open Terminal'
    ).then(action => {
      if (action === 'Open Terminal') {
        vscode.commands.executeCommand('workbench.action.terminal.focus');
      }
    });
  }

  /**
   * Show quick pick to select a template
   */
  async showTemplateQuickPick(): Promise<void> {
    const templates = this.getAllTemplates();
    
    const items = templates.map(t => ({
      label: `${t.icon} ${t.name}`,
      description: t.category,
      detail: t.description,
      templateId: t.id
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a prompt template',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (selected) {
      await this.runTemplate(selected.templateId);
    }
  }

  /**
   * Create a custom template
   */
  async createCustomTemplate(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Template name',
      placeHolder: 'e.g., Add Redux State'
    });

    if (!name) {return;}

    const description = await vscode.window.showInputBox({
      prompt: 'Short description',
      placeHolder: 'e.g., Add Redux state management to component'
    });

    if (!description) {return;}

    const prompt = await vscode.window.showInputBox({
      prompt: 'Prompt text (what to tell Claude)',
      placeHolder: 'e.g., Convert this component to use Redux for state management...'
    });

    if (!prompt) {return;}

    const icon = await vscode.window.showInputBox({
      prompt: 'Icon emoji (optional)',
      placeHolder: '🔧',
      value: '⚙️'
    });

    const template: PromptTemplate = {
      id: `custom_${Date.now()}`,
      name,
      description,
      prompt,
      icon: icon || '⚙️',
      category: 'custom',
      requiresSelection: true
    };

    this.customTemplates.push(template);
    
    // Save to settings
    const config = vscode.workspace.getConfiguration('codeflow');
    await config.update('customPromptTemplates', this.customTemplates, vscode.ConfigurationTarget.Global);

    this.stateCallbacks.forEach(cb => cb(this.getAllTemplates()));
    
    vscode.window.showInformationMessage(`CodeFlow: Template "${name}" created`);
  }

  /**
   * Delete a custom template
   */
  async deleteCustomTemplate(templateId: string): Promise<void> {
    const index = this.customTemplates.findIndex(t => t.id === templateId);
    if (index === -1) {return;}

    this.customTemplates.splice(index, 1);
    
    const config = vscode.workspace.getConfiguration('codeflow');
    await config.update('customPromptTemplates', this.customTemplates, vscode.ConfigurationTarget.Global);

    this.stateCallbacks.forEach(cb => cb(this.getAllTemplates()));
  }

  /**
   * Get prompt for a template with context
   */
  getPromptWithContext(templateId: string, context: {
    fileName?: string;
    selectedCode?: string;
    fullFileContent?: string;
  }): string | null {
    const template = this.getAllTemplates().find(t => t.id === templateId);
    if (!template) {return null;}

    let prompt = template.prompt;

    if (context.fileName) {
      prompt = `File: ${context.fileName}\n\n${prompt}`;
    }

    if (context.selectedCode) {
      prompt += `\n\nSelected code:\n\`\`\`\n${context.selectedCode}\n\`\`\``;
    } else if (context.fullFileContent) {
      prompt += `\n\nFile content:\n\`\`\`\n${context.fullFileContent}\n\`\`\``;
    }

    return prompt;
  }
}

// Singleton
let promptTemplateManager: PromptTemplateManager | null = null;

export function getPromptTemplateManager(): PromptTemplateManager {
  if (!promptTemplateManager) {
    promptTemplateManager = new PromptTemplateManager();
  }
  return promptTemplateManager;
}
