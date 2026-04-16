import path from 'path';
import { DirectoryAccumulator, TopTerm } from '../types';

export function parentDirectoriesForFile(relativeFilePath: string): string[] {
    const parts = relativeFilePath.split('/');
    parts.pop();

    const directories = ['.'];
    let current = '';

    for(const part of parts) {
        current = current ? `${current}/${part}` : part;
        directories.push(current);
    }

    return directories;
}

export function createDirectoryAccumulator(dirId: string, dirPath: string): DirectoryAccumulator {
    return {
        dir_id:               dirId,
        path:                 dirPath,
        recursive_file_count: 0,
        indexed_file_count:   0,
        total_size_bytes:     0,
        extension_counts:     Object.create(null),
        class_counts:         Object.create(null),
        term_counts:          new Map(),
        notable_files:        [],
    };
}

export function incrementCounterObject(counterObject: Record<string, number>, key: string, incrementBy = 1) {
    counterObject[key] = (counterObject[key] ?? 0) + incrementBy;
}

export function mergeTopTermsIntoMap(targetMap: Map<string, number>, topTerms: TopTerm[]) {
    for(const {term, count} of topTerms) {
        targetMap.set(term, (targetMap.get(term) ?? 0) + count);
    }
}

export function buildKnownBasenamesSet(filePaths: string[]) {
    const basenames = new Set<string>();

    for(const filePathValue of filePaths) {
        basenames.add(path.posix.basename(filePathValue));
    }

    return basenames;
}

export function sortCounterObject(counterObject: Record<string, number>, limit: number | null = null) {
    const entries = Object.entries(counterObject)
                          .sort((left, right) => {
                              const countDelta = right[1] - left[1];
                              if(countDelta !== 0) {
                                  return countDelta;
                              }

                              return left[0].localeCompare(right[0]);
                          });

    const limitedEntries = limit == null ? entries : entries.slice(0, limit);
    return Object.fromEntries(limitedEntries);
}


