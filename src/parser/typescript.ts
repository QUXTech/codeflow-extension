import * as path from 'path';
import { ParseResult, ComponentNode, ComponentType, SupportedLanguage } from '../types';

/**
 * Parse TypeScript/JavaScript/React files using regex patterns
 * 
 * This is a lightweight parser that doesn't require tree-sitter or the TypeScript compiler.
 * For production use, you'd want to use the TypeScript compiler API for more accurate parsing.
 */
export function parseTypeScript(
  filePath: string,
  content: string,
  language: SupportedLanguage
): ParseResult {
  const components: Omit<ComponentNode, 'editStatus'>[] = [];
  const imports: ParseResult['imports'] = [];
  const errors: string[] = [];
  const _lines = content.split('\n');

  try {
    // Parse imports
    parseImports(content, imports);

    // Parse re-exports (components exported from other modules)
    parseReexports(content, imports);

    // Parse React components (function and class)
    parseReactComponents(content, filePath, language, components);

    // Parse classes
    parseClasses(content, filePath, language, components);

    // Parse functions (non-component)
    parseFunctions(content, filePath, language, components);

    // Parse exports
    const exportNames = parseExports(content);
    
    // Attach exports to components
    components.forEach(comp => {
      comp.exports = exportNames.filter(exp => 
        exp === comp.name || exp === 'default'
      );
    });

    // Detect component types from naming conventions
    components.forEach(comp => {
      comp.type = inferComponentType(comp.name, filePath, content);
    });

  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Parse error');
  }

  return { filePath, components, imports, errors };
}

/**
 * Parse import statements
 */
function parseImports(content: string, imports: ParseResult['imports']): void {
  // Named imports: import { x, y } from 'module'
  const namedImportRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = namedImportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map(n => {
      const parts = n.trim().split(/\s+as\s+/);
      return parts[parts.length - 1].trim();
    }).filter(n => n);
    
    imports.push({
      source: match[2],
      names,
      isDefault: false,
      isNamespace: false
    });
  }

  // Default imports: import X from 'module'
  const defaultImportRegex = /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
  
  while ((match = defaultImportRegex.exec(content)) !== null) {
    // Skip if this is part of a destructured import
    if (content.substring(match.index - 10, match.index).includes('{')) {
      continue;
    }
    
    imports.push({
      source: match[2],
      names: [match[1]],
      isDefault: true,
      isNamespace: false
    });
  }

  // Namespace imports: import * as X from 'module'
  const namespaceImportRegex = /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
  
  while ((match = namespaceImportRegex.exec(content)) !== null) {
    imports.push({
      source: match[2],
      names: [match[1]],
      isDefault: false,
      isNamespace: true
    });
  }
}

/**
 * Parse React components (function components and class components)
 */
function parseReactComponents(
  content: string,
  filePath: string,
  language: SupportedLanguage,
  components: Omit<ComponentNode, 'editStatus'>[]
): void {
  let match;

  // Arrow function components with various patterns:
  // const X = () => {}, const X = (props) => {}, const X = ({ a, b }) => {}
  // const X: React.FC = () => {}, const X: FC<Props> = () => {}
  // Improved regex to handle destructured params, generics, and implicit returns
  const arrowComponentRegex = /(?:export\s+)?(?:const|let)\s+([A-Z]\w*)\s*(?::\s*(?:React\.)?(?:FC|FunctionComponent|ComponentType)(?:<[^>]*>)?\s*)?\s*=\s*(?:<[^>]*>\s*)?(?:\([^)]*\)|\w+)\s*=>/g;

  while ((match = arrowComponentRegex.exec(content)) !== null) {
    const name = match[1];
    const lineNumber = getLineNumber(content, match.index);

    // Check if this looks like a React component (has JSX or returns JSX)
    const componentBody = extractFunctionBody(content, match.index);
    if (hasJSX(componentBody) || isReactFC(match[0])) {
      if (!components.some(c => c.name === name && c.filePath === filePath)) {
        components.push({
          id: generateId(filePath, name),
          name,
          filePath,
          line: lineNumber,
          column: match.index - content.lastIndexOf('\n', match.index) - 1,
          type: 'component',
          language,
          exports: []
        });
      }
    }
  }

  // Function declaration components: function ComponentName()
  // Also handles: export default function ComponentName()
  const functionComponentRegex = /(?:export\s+(?:default\s+)?)?function\s+([A-Z]\w*)\s*(?:<[^>]*>)?\s*\(/g;

  while ((match = functionComponentRegex.exec(content)) !== null) {
    const name = match[1];
    const lineNumber = getLineNumber(content, match.index);

    const componentBody = extractFunctionBody(content, match.index);
    if (hasJSX(componentBody)) {
      // Check if already added
      if (!components.some(c => c.name === name && c.filePath === filePath)) {
        components.push({
          id: generateId(filePath, name),
          name,
          filePath,
          line: lineNumber,
          column: match.index - content.lastIndexOf('\n', match.index) - 1,
          type: 'component',
          language,
          exports: []
        });
      }
    }
  }

  // Class components: class X extends React.Component or Component
  const classComponentRegex = /(?:export\s+(?:default\s+)?)?class\s+(\w+)\s+extends\s+(?:React\.)?(?:Component|PureComponent)/g;

  while ((match = classComponentRegex.exec(content)) !== null) {
    const name = match[1];
    const lineNumber = getLineNumber(content, match.index);

    if (!components.some(c => c.name === name && c.filePath === filePath)) {
      components.push({
        id: generateId(filePath, name),
        name,
        filePath,
        line: lineNumber,
        column: match.index - content.lastIndexOf('\n', match.index) - 1,
        type: 'component',
        language,
        exports: []
      });
    }
  }

  // memo() wrapped components: React.memo(Component), memo(Component)
  // Also handles: const X = memo(() => <div/>)
  const memoRegex = /(?:export\s+)?(?:const|let)\s+([A-Z]\w*)\s*=\s*(?:React\.)?memo\s*\(/g;

  while ((match = memoRegex.exec(content)) !== null) {
    const name = match[1];
    const lineNumber = getLineNumber(content, match.index);

    if (!components.some(c => c.name === name && c.filePath === filePath)) {
      const componentBody = extractFunctionBody(content, match.index);
      if (hasJSX(componentBody) || componentBody.includes('=>')) {
        components.push({
          id: generateId(filePath, name),
          name,
          filePath,
          line: lineNumber,
          column: match.index - content.lastIndexOf('\n', match.index) - 1,
          type: 'component',
          language,
          exports: []
        });
      }
    }
  }

  // forwardRef wrapped components: React.forwardRef((props, ref) => ...)
  const forwardRefRegex = /(?:export\s+)?(?:const|let)\s+([A-Z]\w*)\s*=\s*(?:React\.)?forwardRef\s*(?:<[^>]*>)?\s*\(/g;

  while ((match = forwardRefRegex.exec(content)) !== null) {
    const name = match[1];
    const lineNumber = getLineNumber(content, match.index);

    if (!components.some(c => c.name === name && c.filePath === filePath)) {
      const componentBody = extractFunctionBody(content, match.index);
      if (hasJSX(componentBody) || componentBody.includes('=>')) {
        components.push({
          id: generateId(filePath, name),
          name,
          filePath,
          line: lineNumber,
          column: match.index - content.lastIndexOf('\n', match.index) - 1,
          type: 'component',
          language,
          exports: []
        });
      }
    }
  }

  // Default export of existing component: export default ComponentName
  // This captures the component name for the exports list
  const defaultExportRegex = /export\s+default\s+([A-Z]\w*)\s*;?$/gm;

  while ((match = defaultExportRegex.exec(content)) !== null) {
    const name = match[1];
    // Find if this component exists and mark it as default export
    const existing = components.find(c => c.name === name && c.filePath === filePath);
    if (existing && !existing.exports.includes('default')) {
      existing.exports.push('default');
    }
  }
}

/**
 * Parse class definitions
 */
function parseClasses(
  content: string,
  filePath: string,
  language: SupportedLanguage,
  components: Omit<ComponentNode, 'editStatus'>[]
): void {
  // Generic class definitions (excluding React components already parsed)
  const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(?!(?:React\.)?(?:Component|PureComponent))\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g;
  let match;

  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1];
    
    // Skip if already added as a React component
    if (components.some(c => c.name === name && c.filePath === filePath)) {
      continue;
    }

    const lineNumber = getLineNumber(content, match.index);
    
    components.push({
      id: generateId(filePath, name),
      name,
      filePath,
      line: lineNumber,
      column: match.index - content.lastIndexOf('\n', match.index) - 1,
      type: 'class',
      language,
      exports: []
    });
  }
}

/**
 * Parse function definitions
 */
function parseFunctions(
  content: string,
  filePath: string,
  language: SupportedLanguage,
  components: Omit<ComponentNode, 'editStatus'>[]
): void {
  // Only add top-level exported functions that aren't already components
  const exportedFunctionRegex = /export\s+(?:async\s+)?function\s+([a-z]\w*)\s*\(/g;
  let match;

  while ((match = exportedFunctionRegex.exec(content)) !== null) {
    const name = match[1];
    
    // Skip if already added
    if (components.some(c => c.name === name && c.filePath === filePath)) {
      continue;
    }

    const lineNumber = getLineNumber(content, match.index);
    
    components.push({
      id: generateId(filePath, name),
      name,
      filePath,
      line: lineNumber,
      column: match.index - content.lastIndexOf('\n', match.index) - 1,
      type: 'function',
      language,
      exports: []
    });
  }

  // Exported arrow functions: export const x = () =>
  const exportedArrowRegex = /export\s+(?:const|let)\s+([a-z]\w*)\s*=\s*(?:async\s*)?\(/g;

  while ((match = exportedArrowRegex.exec(content)) !== null) {
    const name = match[1];
    
    if (components.some(c => c.name === name && c.filePath === filePath)) {
      continue;
    }

    const lineNumber = getLineNumber(content, match.index);
    
    components.push({
      id: generateId(filePath, name),
      name,
      filePath,
      line: lineNumber,
      column: match.index - content.lastIndexOf('\n', match.index) - 1,
      type: 'function',
      language,
      exports: []
    });
  }
}

/**
 * Parse export statements
 */
function parseExports(content: string): string[] {
  const exports: string[] = [];

  // export default
  if (/export\s+default\s+/.test(content)) {
    exports.push('default');
  }

  // Named exports: export { x, y }
  const namedExportRegex = /export\s*\{([^}]+)\}/g;
  let match;

  while ((match = namedExportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map(n => {
      const parts = n.trim().split(/\s+as\s+/);
      return parts[0].trim();
    });
    exports.push(...names);
  }

  // Inline exports: export const/function/class
  const inlineExportRegex = /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;

  while ((match = inlineExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  return [...new Set(exports)];
}

/**
 * Parse re-exported components from other modules
 * e.g., export { Button } from './Button'
 *       export { default as Button } from './Button'
 *       export * from './components'
 */
function parseReexports(content: string, imports: ParseResult['imports']): void {
  // export { X, Y } from 'module'
  const reexportNamedRegex = /export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = reexportNamedRegex.exec(content)) !== null) {
    const names = match[1].split(',').map(n => {
      const parts = n.trim().split(/\s+as\s+/);
      // Get the exported name (after 'as' if present)
      return parts[parts.length - 1].trim();
    }).filter(n => n);

    imports.push({
      source: match[2],
      names,
      isDefault: false,
      isNamespace: false,
      isReexport: true
    });
  }

  // export * from 'module'
  const reexportAllRegex = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;

  while ((match = reexportAllRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      names: ['*'],
      isDefault: false,
      isNamespace: true,
      isReexport: true
    });
  }

  // export * as X from 'module'
  const reexportNamespaceRegex = /export\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;

  while ((match = reexportNamespaceRegex.exec(content)) !== null) {
    imports.push({
      source: match[2],
      names: [match[1]],
      isDefault: false,
      isNamespace: true,
      isReexport: true
    });
  }
}

/**
 * Infer the component type from naming conventions and context
 */
function inferComponentType(
  name: string,
  filePath: string,
  content: string
): ComponentType {
  const lowerName = name.toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();
  const dirName = path.basename(path.dirname(filePath)).toLowerCase();

  // Hooks
  if (lowerName.startsWith('use')) {
    return 'hook';
  }

  // Context
  if (lowerName.includes('context') || lowerName.includes('provider')) {
    return 'context';
  }

  // Services
  if (lowerName.includes('service') || dirName === 'services') {
    return 'service';
  }

  // API layer
  if (lowerName.includes('api') || dirName === 'api') {
    return 'api';
  }

  // Store/State
  if (lowerName.includes('store') || lowerName.includes('slice') || lowerName.includes('reducer')) {
    return 'store';
  }

  // Utils
  if (lowerName.includes('util') || lowerName.includes('helper') || dirName === 'utils' || dirName === 'helpers') {
    return 'util';
  }

  // Types
  if (fileName.includes('.d.ts') || dirName === 'types' || lowerName.includes('types')) {
    return 'type';
  }

  // Config
  if (lowerName.includes('config') || fileName.includes('config')) {
    return 'config';
  }

  // Default to component if it has JSX, otherwise unknown
  if (hasJSX(content)) {
    return 'component';
  }

  return 'unknown';
}

/**
 * Check if content contains JSX
 */
function hasJSX(content: string): boolean {
  // Look for JSX patterns
  return /<[A-Z]\w*[\s/>]/.test(content) ||     // <Component or <Component>
         /<\/[A-Z]\w*>/.test(content) ||        // </Component>
         /return\s*\(?\s*</.test(content) ||    // return <div> or return (<div>
         /=>\s*\(?\s*</.test(content) ||        // => <div> or => (<div> (implicit return)
         /<>/.test(content) ||                  // Fragment <>
         /<\/?>/.test(content) ||               // Fragment </> or <>
         /<[a-z]+[\s/>]/.test(content) ||       // <div>, <span>, etc. (HTML elements)
         /<[a-z]+-[a-z]+/.test(content) ||      // Web components <my-component>
         /className[=:]/.test(content) ||       // JSX className prop
         /onClick[=:]/.test(content) ||         // JSX onClick handler
         /\{.*\}/.test(content) &&              // Has JSX expressions
           /<[^>]+>/.test(content);             // And has angle brackets
}

/**
 * Check if the function signature indicates React.FC or similar type
 */
function isReactFC(signature: string): boolean {
  return /:\s*(?:React\.)?(?:FC|FunctionComponent|ComponentType|VFC|PropsWithChildren)/.test(signature) ||
         /:\s*(?:React\.)?(?:ReactElement|ReactNode|JSX\.Element)/.test(signature) ||
         /memo\s*\(/.test(signature) ||
         /forwardRef\s*\(/.test(signature);
}

/**
 * Extract a rough function body for analysis
 */
function extractFunctionBody(content: string, startIndex: number): string {
  // First, find the arrow (=>) to skip past function signature and params
  let arrowIndex = content.indexOf('=>', startIndex);
  if (arrowIndex === -1 || arrowIndex > startIndex + 500) {
    // No arrow found, try to find function body with opening brace
    arrowIndex = content.indexOf('{', startIndex);
    if (arrowIndex === -1) {
      return content.substring(startIndex, Math.min(startIndex + 1000, content.length));
    }
    arrowIndex--; // Will be incremented in loop
  }

  // Start scanning after the arrow
  let braceCount = 0;
  let parenCount = 0;
  let inBody = false;
  let bodyStart = arrowIndex + 2; // Start after =>

  for (let i = arrowIndex + 2; i < content.length && i < startIndex + 5000; i++) {
    const char = content[i];

    // Skip whitespace before body starts
    if (!inBody && (char === ' ' || char === '\n' || char === '\t' || char === '\r')) {
      continue;
    }

    // Body starts with { (block) or ( (parenthesized expression) or directly with <
    if (!inBody) {
      if (char === '{') {
        inBody = true;
        bodyStart = i;
        braceCount = 1;
      } else if (char === '(') {
        inBody = true;
        bodyStart = i;
        parenCount = 1;
      } else if (char === '<') {
        // Implicit return with JSX - grab a chunk
        return content.substring(i, Math.min(i + 2000, content.length));
      }
      continue;
    }

    // Track braces for block bodies
    if (braceCount > 0) {
      if (char === '{') {braceCount++;}
      else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          return content.substring(bodyStart, i + 1);
        }
      }
    }

    // Track parens for expression bodies like () => (...)
    if (parenCount > 0) {
      if (char === '(') {parenCount++;}
      else if (char === ')') {
        parenCount--;
        if (parenCount === 0) {
          return content.substring(bodyStart, i + 1);
        }
      }
    }
  }

  // Return whatever we found
  return content.substring(bodyStart, Math.min(bodyStart + 2000, content.length));
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
  // Create a simple hash-like ID
  const pathHash = filePath.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  return `${name}_${Math.abs(pathHash).toString(36)}`;
}
