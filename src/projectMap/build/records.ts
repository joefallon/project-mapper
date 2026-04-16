import { topTermsFromCounts, extractIdentifiers, buildPreviewFromLines } from '../../utils';

export function buildIndexedFileRecord({
                                           fileId,
                                           relativeFilePath,
                                           extension,
                                           sizeBytes,
                                           mtimeMs,
                                           fileClass,
                                           text,
                                           lines,
                                           chunks,
                                       }: any) {
    const fileTermCounts = new Map();
    const titles: string[] = [];
    const preview = buildPreviewFromLines(lines);

    for(const chunk of chunks) {
        for(const {term, count} of chunk.top_terms ?? []) {
            fileTermCounts.set(term, (fileTermCounts.get(term) ?? 0) + count);
        }

        if(chunk.title && chunk.title.trim().length > 0) {
            titles.push(chunk.title);
        }
    }

    const fileIdentifiers = extractIdentifiers(text);

    return {
        file_id:         fileId,
        path:            relativeFilePath,
        extension,
        size_bytes:      sizeBytes,
        mtime_ms:        mtimeMs,
        indexed:         true,
        file_class:      fileClass,
        line_count:      lines.length,
        chunk_count:     chunks.length,
        chunk_ids:       chunks.map((chunk: any) => chunk.chunk_id),
        section_titles:  [...new Set(titles)].slice(0, 24),
        top_terms:       topTermsFromCounts(fileTermCounts, 20),
        top_identifiers: fileIdentifiers,
        preview,
    };
}

export function buildSkippedFileRecord({
                                           fileId,
                                           relativeFilePath,
                                           extension,
                                           sizeBytes,
                                           mtimeMs,
                                           fileClass,
                                           skipReason
                                       }: any) {
    return {
        file_id:         fileId,
        path:            relativeFilePath,
        extension,
        size_bytes:      sizeBytes,
        mtime_ms:        mtimeMs,
        indexed:         false,
        file_class:      fileClass,
        line_count:      0,
        chunk_count:     0,
        chunk_ids:       [],
        section_titles:  [],
        top_terms:       [],
        top_identifiers: [],
        preview:         '',
        skip_reason:     skipReason,
    };
}

export function buildRepoTopTerms(fileRecords: any[]) {
    const termCounts = new Map();

    for(const fileRecord of fileRecords) {
        if(!fileRecord.indexed) {
            continue;
        }
        for(const {term, count} of fileRecord.top_terms ?? []) {
            termCounts.set(term, (termCounts.get(term) ?? 0) + count);
        }
    }

    return topTermsFromCounts(termCounts, 30);
}

export function buildDirectoryRecords(fileRecords: any[]) {
    const directoryMap = new Map();
    let directoryCounter = 0;

    const getOrCreateDirectory = (dirPath: string) => {
        if(!directoryMap.has(dirPath)) {
            directoryCounter += 1;
            directoryMap.set(dirPath, {
                dir_id:               `d${String(directoryCounter).padStart(6, '0')}`,
                path:                 dirPath,
                recursive_file_count: 0,
                indexed_file_count:   0,
                total_size_bytes:     0,
                extension_counts:     Object.create(null),
                class_counts:         Object.create(null),
                term_counts:          new Map(),
                notable_files:        [],
            });
        }

        return directoryMap.get(dirPath);
    };

    // Always create the root accumulator.
    getOrCreateDirectory('.');

    for(const fileRecord of fileRecords) {
        const directories = fileRecord.path.split('/');
        directories.pop();
        const dirs = ['.'];
        let current = '';
        for(const part of directories) {
            current = current ? `${current}/${part}` : part;
            dirs.push(current);
        }

        for(const dirPath of dirs) {
            const dirAccumulator = getOrCreateDirectory(dirPath);
            dirAccumulator.recursive_file_count += 1;
            dirAccumulator.total_size_bytes += fileRecord.size_bytes;
            dirAccumulator.extension_counts[fileRecord.extension || '(none)'] = (dirAccumulator.extension_counts[fileRecord.extension || '(none)'] ?? 0) + 1;
            dirAccumulator.class_counts[fileRecord.file_class] = (dirAccumulator.class_counts[fileRecord.file_class] ?? 0) + 1;

            if(fileRecord.indexed) {
                dirAccumulator.indexed_file_count += 1;
                for(const {term, count} of fileRecord.top_terms ?? []) {
                    dirAccumulator.term_counts.set(term, (dirAccumulator.term_counts.get(term) ?? 0) + count);
                }
            }

            if(dirAccumulator.notable_files.length < 12) {
                dirAccumulator.notable_files.push({
                    path:        fileRecord.path,
                    indexed:     fileRecord.indexed,
                    file_class:  fileRecord.file_class,
                    chunk_count: fileRecord.chunk_count,
                });
            }
        }
    }

    const directoryRecords = [...directoryMap.values()]
        .map((directoryRecord: any) => ({
            dir_id:               directoryRecord.dir_id,
            path:                 directoryRecord.path,
            recursive_file_count: directoryRecord.recursive_file_count,
            indexed_file_count:   directoryRecord.indexed_file_count,
            total_size_bytes:     directoryRecord.total_size_bytes,
            extension_counts:     (function sortCounterObject(obj: Record<string, number>, limit: number | null = 15) {
                const entries = Object.entries(obj)
                                      .sort((left, right) => {
                                          const countDelta = right[1] - left[1];
                                          if(countDelta !== 0) {
                                              return countDelta;
                                          }
                                          return left[0].localeCompare(right[0]);
                                      });
                const limitedEntries = limit == null ? entries : entries.slice(0, limit);
                return Object.fromEntries(limitedEntries);
            })(directoryRecord.extension_counts, 15),
            class_counts:         (function sortCounterObject(obj: Record<string, number>, limit: number | null = 15) {
                const entries = Object.entries(obj)
                                      .sort((left, right) => {
                                          const countDelta = right[1] - left[1];
                                          if(countDelta !== 0) {
                                              return countDelta;
                                          }
                                          return left[0].localeCompare(right[0]);
                                      });
                const limitedEntries = limit == null ? entries : entries.slice(0, limit);
                return Object.fromEntries(limitedEntries);
            })(directoryRecord.class_counts, 15),
            top_terms:            (function topTermsFromCounts(termCounts: Map<string, number>, limit = 20) {
                return [...termCounts.entries()]
                    .sort((l, r) => {
                        const d = r[1] - l[1];
                        if(d !== 0) {
                            return d;
                        }
                        return l[0].localeCompare(r[0]);
                    })
                    .slice(0, limit)
                    .map(([term, count]) => ({term, count}));
            })(directoryRecord.term_counts, 20),
            notable_files:        directoryRecord.notable_files.sort((left: any, right: any) => left.path.localeCompare(right.path)),
        }))
        .sort((left: any, right: any) => left.path.localeCompare(right.path));

    return directoryRecords;
}

