import * as path from 'path';
import {
  ComponentGraph,
  ComponentNode,
  ComponentEdge,
  ParseResult,
  SupportedLanguage
} from '../types';

/**
 * Build a component graph from parse results
 */
export function buildGraph(
  parseResults: ParseResult[],
  rootPath: string,
  _maxDepth: number = 5
): ComponentGraph {
  const nodes: ComponentNode[] = [];
  const edges: ComponentEdge[] = [];
  const languages = new Set<SupportedLanguage>();

  // First pass: collect all components
  const componentMap = new Map<string, ComponentNode>();
  const fileToComponents = new Map<string, ComponentNode[]>();
  const exportToComponent = new Map<string, ComponentNode>();

  for (const result of parseResults) {
    const fileComponents: ComponentNode[] = [];

    for (const comp of result.components) {
      const node: ComponentNode = {
        ...comp,
        editStatus: 'idle'
      };

      nodes.push(node);
      componentMap.set(node.id, node);
      fileComponents.push(node);
      languages.add(node.language);

      // Map exports to components
      for (const exportName of node.exports) {
        const key = `${result.filePath}:${exportName}`;
        exportToComponent.set(key, node);
      }

      // Also map by relative path for import resolution
      const relativePath = path.relative(rootPath, result.filePath);
      for (const exportName of node.exports) {
        exportToComponent.set(`${relativePath}:${exportName}`, node);
        // Without extension
        const withoutExt = relativePath.replace(/\.[^/.]+$/, '');
        exportToComponent.set(`${withoutExt}:${exportName}`, node);
      }
    }

    fileToComponents.set(result.filePath, fileComponents);
  }

  // Second pass: build edges from imports
  for (const result of parseResults) {
    const sourceComponents = fileToComponents.get(result.filePath) || [];
    
    for (const imp of result.imports) {
      // Resolve the import to a target component
      const targetComponents = resolveImport(
        imp.source,
        imp.names,
        result.filePath,
        rootPath,
        parseResults,
        exportToComponent
      );

      // Create edges from each source component to each target
      for (const source of sourceComponents) {
        for (const target of targetComponents) {
          if (source.id !== target.id) {
            const existingEdge = edges.find(
              e => e.source === source.id && e.target === target.id
            );

            if (existingEdge) {
              // Merge names
              const newNames = imp.names.filter(n => !existingEdge.names?.includes(n));
              if (newNames.length > 0) {
                existingEdge.names = [...(existingEdge.names || []), ...newNames];
              }
            } else {
              edges.push({
                source: source.id,
                target: target.id,
                type: 'imports',
                names: imp.names
              });
            }
          }
        }
      }
    }
  }

  // Third pass: detect inheritance relationships
  for (const result of parseResults) {
    detectInheritance(result, componentMap, edges);
  }

  return {
    nodes,
    edges,
    rootPath,
    generatedAt: Date.now(),
    languages: Array.from(languages)
  };
}

/**
 * Resolve an import statement to target components
 */
function resolveImport(
  source: string,
  names: string[],
  importingFile: string,
  rootPath: string,
  parseResults: ParseResult[],
  exportToComponent: Map<string, ComponentNode>
): ComponentNode[] {
  const results: ComponentNode[] = [];

  // Try to resolve as a relative import
  if (source.startsWith('.')) {
    const importDir = path.dirname(importingFile);
    const resolvedPath = path.resolve(importDir, source);
    
    // Try different extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.cs', ''];
    
    for (const ext of extensions) {
      const fullPath = resolvedPath + ext;
      
      for (const name of names) {
        const key = `${fullPath}:${name}`;
        const component = exportToComponent.get(key);
        if (component && !results.includes(component)) {
          results.push(component);
        }
      }

      // Also try index file
      const indexPath = path.join(resolvedPath, 'index' + ext);
      for (const name of names) {
        const key = `${indexPath}:${name}`;
        const component = exportToComponent.get(key);
        if (component && !results.includes(component)) {
          results.push(component);
        }
      }
    }
  }

  // Try to resolve by matching export names across all files
  if (results.length === 0) {
    for (const [key, component] of exportToComponent.entries()) {
      const exportName = key.split(':').pop();
      if (names.includes(exportName || '') && !results.includes(component)) {
        results.push(component);
      }
    }
  }

  return results;
}

/**
 * Detect inheritance relationships from file content
 */
function detectInheritance(
  result: ParseResult,
  componentMap: Map<string, ComponentNode>,
  edges: ComponentEdge[]
): void {
  // This is a simplified implementation
  // A full implementation would parse the AST to find extends/implements
  
  for (const comp of result.components) {
    const node = componentMap.get(comp.id);
    if (!node) {continue;}

    // Check if description contains inheritance info
    if (node.description?.startsWith('Extends:')) {
      const baseClasses = node.description
        .replace('Extends:', '')
        .split(',')
        .map(s => s.trim());

      for (const baseName of baseClasses) {
        // Find the base class component
        for (const [_id, potentialBase] of componentMap.entries()) {
          if (potentialBase.name === baseName && potentialBase.id !== node.id) {
            edges.push({
              source: node.id,
              target: potentialBase.id,
              type: 'extends'
            });
            break;
          }
        }
      }
    }

    // Check for implements (interfaces)
    if (node.description?.includes('Implements:')) {
      const interfaces = node.description
        .split('Implements:')[1]
        ?.split(',')
        .map(s => s.trim()) || [];

      for (const interfaceName of interfaces) {
        for (const [_id, potentialInterface] of componentMap.entries()) {
          if (potentialInterface.name === interfaceName) {
            edges.push({
              source: node.id,
              target: potentialInterface.id,
              type: 'implements'
            });
            break;
          }
        }
      }
    }
  }
}

/**
 * Filter the graph to show only connected components within a certain depth
 */
export function filterGraphByDepth(
  graph: ComponentGraph,
  focusNodeId: string,
  depth: number
): ComponentGraph {
  const visited = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: focusNodeId, depth: 0 }];

  // BFS to find all connected nodes within depth
  while (queue.length > 0) {
    const { id, depth: currentDepth } = queue.shift()!;
    
    if (visited.has(id) || currentDepth > depth) {
      continue;
    }
    
    visited.add(id);

    // Find connected nodes
    for (const edge of graph.edges) {
      if (edge.source === id && !visited.has(edge.target)) {
        queue.push({ id: edge.target, depth: currentDepth + 1 });
      }
      if (edge.target === id && !visited.has(edge.source)) {
        queue.push({ id: edge.source, depth: currentDepth + 1 });
      }
    }
  }

  return {
    nodes: graph.nodes.filter(n => visited.has(n.id)),
    edges: graph.edges.filter(e => visited.has(e.source) && visited.has(e.target)),
    rootPath: graph.rootPath,
    generatedAt: graph.generatedAt,
    languages: graph.languages
  };
}

/**
 * Get statistics about the graph
 */
export function getGraphStats(graph: ComponentGraph): {
  totalNodes: number;
  totalEdges: number;
  byType: Record<string, number>;
  byLanguage: Record<string, number>;
  avgConnections: number;
} {
  const byType: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};

  for (const node of graph.nodes) {
    byType[node.type] = (byType[node.type] || 0) + 1;
    byLanguage[node.language] = (byLanguage[node.language] || 0) + 1;
  }

  const connectionCounts = graph.nodes.map(node => {
    return graph.edges.filter(e => e.source === node.id || e.target === node.id).length;
  });

  const avgConnections = connectionCounts.length > 0
    ? connectionCounts.reduce((a, b) => a + b, 0) / connectionCounts.length
    : 0;

  return {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    byType,
    byLanguage,
    avgConnections: Math.round(avgConnections * 100) / 100
  };
}
