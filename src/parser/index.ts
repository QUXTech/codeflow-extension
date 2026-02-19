import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { ParseResult, SupportedLanguage, FolderSelection } from '../types';
import { parseTypeScript } from './typescript';
import { parsePython } from './python';
import { parseCSharp } from './csharp';

/**
 * Parse the workspace and return results for all files
 * @param rootPath - Root path of the workspace
 * @param excludePatterns - Patterns to exclude from scanning
 * @param selectedFolders - Optional array of folder paths to scan (relative to root). If empty/undefined, scans all.
 * @param cancellationToken - Optional cancellation token
 */
export async function parseWorkspace(
  rootPath: string,
  excludePatterns: string[],
  selectedFolders?: string[],
  cancellationToken?: vscode.CancellationToken
): Promise<ParseResult[]> {
  const results: ParseResult[] = [];

  // Base file extensions to search for
  const extensions = '{ts,tsx,js,jsx,py,cs}';

  // Build patterns based on selected folders
  let patterns: string[];
  if (selectedFolders && selectedFolders.length > 0) {
    // Create patterns for each selected folder
    patterns = selectedFolders.flatMap(folder => {
      // Normalize folder path (remove leading/trailing slashes)
      const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
      if (normalizedFolder === '' || normalizedFolder === '.') {
        // Root folder - scan all
        return [`**/*.${extensions}`];
      }
      return [
        `${normalizedFolder}/**/*.${extensions}`,
        // Also include files directly in the folder
        `${normalizedFolder}/*.${extensions}`
      ];
    });
    // Remove duplicates
    patterns = [...new Set(patterns)];
  } else {
    // No folders selected - scan all
    patterns = [`**/*.${extensions}`];
  }

  const ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/venv/**',
    '**/__pycache__/**',
    '**/bin/**',
    '**/obj/**',
    ...excludePatterns
  ];

  for (const pattern of patterns) {
    if (cancellationToken?.isCancellationRequested) {
      break;
    }

    try {
      const files = await glob(pattern, {
        cwd: rootPath,
        ignore: ignorePatterns,
        absolute: true,
        nodir: true
      });

      for (const filePath of files) {
        if (cancellationToken?.isCancellationRequested) {
          break;
        }

        try {
          const result = await parseFile(filePath);
          if (result.components.length > 0 || result.imports.length > 0) {
            results.push(result);
          }
        } catch (error) {
          console.error(`CodeFlow: Error parsing ${filePath}:`, error);
          results.push({
            filePath,
            components: [],
            imports: [],
            errors: [error instanceof Error ? error.message : 'Unknown error']
          });
        }
      }
    } catch (error) {
      console.error(`CodeFlow: Error finding files with pattern ${pattern}:`, error);
    }
  }

  // Remove duplicate results (in case of overlapping patterns)
  const uniqueResults = new Map<string, ParseResult>();
  for (const result of results) {
    if (!uniqueResults.has(result.filePath)) {
      uniqueResults.set(result.filePath, result);
    }
  }

  return Array.from(uniqueResults.values());
}

/**
 * Discover all folders in the workspace that could be selected for scanning
 * @param rootPath - Root path of the workspace
 * @param maxDepth - Maximum depth to scan for folders
 */
export async function discoverFolders(
  rootPath: string,
  maxDepth: number = 3
): Promise<FolderSelection[]> {
  const ignorePatterns = [
    'node_modules', 'dist', 'build', '.git', 'venv', '__pycache__',
    'bin', 'obj', '.next', '.nuxt', 'coverage', '.cache', '.idea', '.vscode'
  ];

  async function scanDirectory(dirPath: string, depth: number): Promise<FolderSelection[]> {
    if (depth > maxDepth) {
      return [];
    }

    const results: FolderSelection[] = [];

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory() && !ignorePatterns.includes(e.name) && !e.name.startsWith('.'));

      for (const dir of dirs) {
        const fullPath = path.join(dirPath, dir.name);
        const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

        // Check if this directory has any code files
        const hasCodeFiles = await checkForCodeFiles(fullPath);

        // Recursively get children
        const children = await scanDirectory(fullPath, depth + 1);
        const hasChildren = children.length > 0;

        // Only include if it has code files or has children with code files
        if (hasCodeFiles || hasChildren) {
          results.push({
            path: relativePath,
            name: dir.name,
            selected: true, // Default to selected
            depth: depth,
            hasChildren: hasChildren,
            children: hasChildren ? children : undefined
          });
        }
      }
    } catch (error) {
      console.error(`CodeFlow: Error scanning directory ${dirPath}:`, error);
    }

    return results;
  }

  return scanDirectory(rootPath, 0);
}

/**
 * Check if a directory contains any code files (non-recursively)
 */
async function checkForCodeFiles(dirPath: string): Promise<boolean> {
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.cs'];

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.some(e =>
      e.isFile() && codeExtensions.some(ext => e.name.endsWith(ext))
    );
  } catch {
    return false;
  }
}

/**
 * Get the selected folder paths from a FolderSelection tree
 */
export function getSelectedFolderPaths(folders: FolderSelection[]): string[] {
  const selected: string[] = [];

  function traverse(folderList: FolderSelection[]) {
    for (const folder of folderList) {
      if (folder.selected) {
        selected.push(folder.path);
        // If parent is selected, don't need to add children
      } else if (folder.children) {
        // Parent not selected, check children
        traverse(folder.children);
      }
    }
  }

  traverse(folders);
  return selected;
}

/**
 * Parse a single file based on its extension
 */
export async function parseFile(filePath: string): Promise<ParseResult> {
  const ext = path.extname(filePath).toLowerCase();
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const language = getLanguageFromExtension(ext);

  switch (language) {
    case 'typescript':
    case 'javascript':
    case 'react':
      return parseTypeScript(filePath, content, language);
    case 'python':
      return parsePython(filePath, content);
    case 'csharp':
      return parseCSharp(filePath, content);
    default:
      return {
        filePath,
        components: [],
        imports: [],
        errors: [`Unsupported file type: ${ext}`]
      };
  }
}

/**
 * Determine the language from file extension
 */
function getLanguageFromExtension(ext: string): SupportedLanguage {
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'react';
    case '.js':
      return 'javascript';
    case '.jsx':
      return 'react';
    case '.py':
      return 'python';
    case '.cs':
      return 'csharp';
    default:
      return 'typescript'; // Default fallback
  }
}
