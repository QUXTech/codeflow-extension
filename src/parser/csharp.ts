import * as path from 'path';
import { ParseResult, ComponentNode, ComponentType } from '../types';

/**
 * Parse C# files using regex patterns
 * Particularly useful for Unity projects
 */
export function parseCSharp(filePath: string, content: string): ParseResult {
  const components: Omit<ComponentNode, 'editStatus'>[] = [];
  const imports: ParseResult['imports'] = [];
  const errors: string[] = [];

  try {
    // Parse using statements
    parseCSharpUsings(content, imports);

    // Parse namespace
    const namespace = parseNamespace(content);

    // Parse classes
    parseCSharpClasses(content, filePath, namespace, components);

    // Parse interfaces
    parseCSharpInterfaces(content, filePath, namespace, components);

    // Parse enums
    parseCSharpEnums(content, filePath, namespace, components);

    // Detect component types
    components.forEach(comp => {
      comp.type = inferCSharpComponentType(comp.name, filePath, content);
    });

  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Parse error');
  }

  return { filePath, components, imports, errors };
}

/**
 * Parse using statements
 */
function parseCSharpUsings(content: string, imports: ParseResult['imports']): void {
  const usingRegex = /using\s+(?:static\s+)?([\w.]+)\s*;/g;
  let match;

  while ((match = usingRegex.exec(content)) !== null) {
    const namespace = match[1];
    const name = namespace.split('.').pop() || namespace;
    
    imports.push({
      source: namespace,
      names: [name],
      isDefault: false,
      isNamespace: true
    });
  }

  // using alias = Type;
  const aliasRegex = /using\s+(\w+)\s*=\s*([\w.]+)\s*;/g;

  while ((match = aliasRegex.exec(content)) !== null) {
    imports.push({
      source: match[2],
      names: [match[1]],
      isDefault: false,
      isNamespace: false
    });
  }
}

/**
 * Parse namespace
 */
function parseNamespace(content: string): string | undefined {
  const namespaceRegex = /namespace\s+([\w.]+)/;
  const match = content.match(namespaceRegex);
  return match ? match[1] : undefined;
}

/**
 * Parse class definitions
 */
function parseCSharpClasses(
  content: string,
  filePath: string,
  namespace: string | undefined,
  components: Omit<ComponentNode, 'editStatus'>[]
): void {
  // Match class definitions with modifiers
  const classRegex = /(?:public|private|protected|internal|abstract|sealed|static|partial|\s)+class\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*([^\{]+))?\s*\{/g;
  let match;

  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1];
    const inheritance = match[2]?.trim();
    const lineNumber = getLineNumber(content, match.index);

    const fullName = namespace ? `${namespace}.${name}` : name;

    components.push({
      id: generateId(filePath, name),
      name,
      filePath,
      line: lineNumber,
      column: 0,
      type: 'class',
      language: 'csharp',
      description: inheritance ? `Inherits: ${inheritance}` : undefined,
      exports: [name, fullName]
    });
  }
}

/**
 * Parse interface definitions
 */
function parseCSharpInterfaces(
  content: string,
  filePath: string,
  namespace: string | undefined,
  components: Omit<ComponentNode, 'editStatus'>[]
): void {
  const interfaceRegex = /(?:public|private|protected|internal|\s)+interface\s+(I\w+)(?:<[^>]+>)?(?:\s*:\s*([^\{]+))?\s*\{/g;
  let match;

  while ((match = interfaceRegex.exec(content)) !== null) {
    const name = match[1];
    const lineNumber = getLineNumber(content, match.index);

    components.push({
      id: generateId(filePath, name),
      name,
      filePath,
      line: lineNumber,
      column: 0,
      type: 'type',
      language: 'csharp',
      exports: [name]
    });
  }
}

/**
 * Parse enum definitions
 */
function parseCSharpEnums(
  content: string,
  filePath: string,
  namespace: string | undefined,
  components: Omit<ComponentNode, 'editStatus'>[]
): void {
  const enumRegex = /(?:public|private|protected|internal|\s)+enum\s+(\w+)\s*\{/g;
  let match;

  while ((match = enumRegex.exec(content)) !== null) {
    const name = match[1];
    const lineNumber = getLineNumber(content, match.index);

    components.push({
      id: generateId(filePath, name),
      name,
      filePath,
      line: lineNumber,
      column: 0,
      type: 'type',
      language: 'csharp',
      exports: [name]
    });
  }
}

/**
 * Infer the component type from naming conventions and inheritance
 */
function inferCSharpComponentType(
  name: string,
  filePath: string,
  content: string
): ComponentType {
  const lowerName = name.toLowerCase();
  const _fileName = path.basename(filePath).toLowerCase();
  const dirName = path.basename(path.dirname(filePath)).toLowerCase();

  // Unity MonoBehaviour components
  if (content.includes(': MonoBehaviour') || content.includes(':MonoBehaviour')) {
    return 'component';
  }

  // Unity ScriptableObject
  if (content.includes(': ScriptableObject') || content.includes(':ScriptableObject')) {
    return 'config';
  }

  // Services
  if (lowerName.includes('service') || dirName === 'services') {
    return 'service';
  }

  // Controllers (MVC/API)
  if (lowerName.includes('controller') || dirName === 'controllers') {
    return 'api';
  }

  // Managers (Unity pattern)
  if (lowerName.includes('manager')) {
    return 'service';
  }

  // Repositories/Data Access
  if (lowerName.includes('repository') || lowerName.includes('repo')) {
    return 'service';
  }

  // Handlers
  if (lowerName.includes('handler')) {
    return 'function';
  }

  // Models/Entities
  if (dirName === 'models' || dirName === 'entities') {
    return 'class';
  }

  // Interfaces
  if (name.startsWith('I') && name[1] === name[1].toUpperCase()) {
    return 'type';
  }

  // Utils/Helpers
  if (lowerName.includes('util') || lowerName.includes('helper') || dirName === 'utils') {
    return 'util';
  }

  // Config
  if (lowerName.includes('config') || lowerName.includes('settings')) {
    return 'config';
  }

  return 'class';
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
