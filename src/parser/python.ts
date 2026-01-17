import * as path from 'path';
import { ParseResult, ComponentNode, ComponentType } from '../types';

/**
 * Parse Python files using regex patterns
 */
export function parsePython(filePath: string, content: string): ParseResult {
  const components: Omit<ComponentNode, 'editStatus'>[] = [];
  const imports: ParseResult['imports'] = [];
  const errors: string[] = [];

  try {
    // Parse imports
    parsePythonImports(content, imports);

    // Parse classes
    parsePythonClasses(content, filePath, components);

    // Parse functions
    parsePythonFunctions(content, filePath, components);

    // Detect component types
    components.forEach(comp => {
      comp.type = inferPythonComponentType(comp.name, filePath, content);
    });

  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Parse error');
  }

  return { filePath, components, imports, errors };
}

/**
 * Parse Python import statements
 */
function parsePythonImports(content: string, imports: ParseResult['imports']): void {
  // from module import x, y, z
  const fromImportRegex = /from\s+([\w.]+)\s+import\s+([^#\n]+)/g;
  let match;

  while ((match = fromImportRegex.exec(content)) !== null) {
    const source = match[1];
    const importPart = match[2].trim();
    
    // Handle parenthesized imports
    let names: string[];
    if (importPart.startsWith('(')) {
      // Multi-line import - find the closing paren
      const closeIdx = content.indexOf(')', match.index);
      if (closeIdx > -1) {
        const fullImport = content.substring(match.index, closeIdx + 1);
        const namesMatch = fullImport.match(/import\s*\(([^)]+)\)/);
        if (namesMatch) {
          names = namesMatch[1].split(',').map(n => {
            const parts = n.trim().split(/\s+as\s+/);
            return parts[0].trim();
          }).filter(n => n && !n.startsWith('#'));
        } else {
          names = [];
        }
      } else {
        names = [];
      }
    } else {
      names = importPart.split(',').map(n => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts[0].trim();
      }).filter(n => n && !n.startsWith('#'));
    }

    if (names.length > 0) {
      imports.push({
        source,
        names,
        isDefault: false,
        isNamespace: false
      });
    }
  }

  // import module or import module as alias
  const importRegex = /^import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm;

  while ((match = importRegex.exec(content)) !== null) {
    const source = match[1];
    const alias = match[2] || source.split('.').pop() || source;
    
    imports.push({
      source,
      names: [alias],
      isDefault: false,
      isNamespace: true
    });
  }
}

/**
 * Parse Python class definitions
 */
function parsePythonClasses(
  content: string,
  filePath: string,
  components: Omit<ComponentNode, 'editStatus'>[]
): void {
  // class ClassName: or class ClassName(BaseClass):
  const classRegex = /^class\s+(\w+)(?:\s*\(([^)]*)\))?\s*:/gm;
  let match;

  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1];
    const bases = match[2];
    const lineNumber = getLineNumber(content, match.index);

    components.push({
      id: generateId(filePath, name),
      name,
      filePath,
      line: lineNumber,
      column: 0,
      type: 'class',
      language: 'python',
      description: bases ? `Extends: ${bases}` : undefined,
      exports: [name] // In Python, classes are typically importable by name
    });
  }
}

/**
 * Parse Python function definitions
 */
function parsePythonFunctions(
  content: string,
  filePath: string,
  components: Omit<ComponentNode, 'editStatus'>[]
): void {
  // Top-level functions only (no indentation before def)
  // def function_name(...):
  const functionRegex = /^def\s+(\w+)\s*\(/gm;
  let match;

  while ((match = functionRegex.exec(content)) !== null) {
    const name = match[1];
    
    // Skip private functions (start with _)
    if (name.startsWith('_') && !name.startsWith('__')) {
      continue;
    }

    // Skip dunder methods
    if (name.startsWith('__') && name.endsWith('__')) {
      continue;
    }

    const lineNumber = getLineNumber(content, match.index);

    components.push({
      id: generateId(filePath, name),
      name,
      filePath,
      line: lineNumber,
      column: 0,
      type: 'function',
      language: 'python',
      exports: [name]
    });
  }

  // Also check for async functions
  const asyncFunctionRegex = /^async\s+def\s+(\w+)\s*\(/gm;

  while ((match = asyncFunctionRegex.exec(content)) !== null) {
    const name = match[1];
    
    if (name.startsWith('_') && !name.startsWith('__')) {
      continue;
    }

    if (name.startsWith('__') && name.endsWith('__')) {
      continue;
    }

    // Check if already added
    if (components.some(c => c.name === name && c.filePath === filePath)) {
      continue;
    }

    const lineNumber = getLineNumber(content, match.index);

    components.push({
      id: generateId(filePath, name),
      name,
      filePath,
      line: lineNumber,
      column: 0,
      type: 'function',
      language: 'python',
      exports: [name]
    });
  }
}

/**
 * Infer the component type from naming conventions
 */
function inferPythonComponentType(
  name: string,
  filePath: string,
  _content: string
): ComponentType {
  const lowerName = name.toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();
  const dirName = path.basename(path.dirname(filePath)).toLowerCase();

  // Django/Flask views
  if (dirName === 'views' || fileName.includes('view')) {
    return 'component';
  }

  // Django models
  if (dirName === 'models' || fileName.includes('model')) {
    return 'class';
  }

  // Services
  if (lowerName.includes('service') || dirName === 'services') {
    return 'service';
  }

  // API/Routes
  if (lowerName.includes('api') || lowerName.includes('route') || dirName === 'api' || dirName === 'routes') {
    return 'api';
  }

  // Utils/Helpers
  if (lowerName.includes('util') || lowerName.includes('helper') || dirName === 'utils' || dirName === 'helpers') {
    return 'util';
  }

  // Config
  if (lowerName.includes('config') || fileName.includes('config') || fileName === 'settings.py') {
    return 'config';
  }

  // Tests
  if (lowerName.startsWith('test') || fileName.startsWith('test_')) {
    return 'function';
  }

  return 'unknown';
}

/**
 * Get line number from character index
 */
function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

/**
 * Generate a unique ID for a component
 */
function generateId(filePath: string, name: string): string {
  const pathHash = filePath.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  return `${name}_${Math.abs(pathHash).toString(36)}`;
}
