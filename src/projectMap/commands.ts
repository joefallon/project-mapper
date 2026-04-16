import { loadCoreState } from './state';
import * as QueryCore from './query/core';

const QC: any = QueryCore as any;
import { hasText } from '../utils';

async function persistQueryArtifactBestEffort(kind: string, queryText: string, payload: unknown, projectRoot?: string) {
    try {
        await QC.persistQueryArtifact(kind, queryText, payload, projectRoot);
    } catch(err: any) {
        const message = err?.message || String(err);
        console.error(`WARN: could not persist ${kind} artifact: ${message}`);
    }
}

function buildInspectArtifactPayload(
    target: string,
    byChunkId: any,
    fileRecord: any,
    relatedChunks: any[],
    owningFile: any,
    resolvedBy: 'chunk_id' | 'file_id' | 'file_path',
) {
    if(byChunkId) {
        return {
            target,
            target_type: 'chunk',
            resolved_by: resolvedBy,
            chunk: byChunkId,
            owning_file: owningFile ?? null,
        };
    }

    return {
        target,
        target_type: 'file',
        resolved_by: resolvedBy,
        file: fileRecord,
        chunks: relatedChunks,
    };
}

export async function runStats(projectRoot?: string) {
    const {buildInfo, repoInfo} = await loadCoreState(projectRoot);

    console.log('PROJECT MAP STATS');
    console.log(`version: ${buildInfo.version}`);
    console.log(`project_root: ${repoInfo.project_root}`);
    console.log(`built_at: ${repoInfo.built_at}`);
    console.log(`total_files_seen: ${repoInfo.total_files_seen}`);
    console.log(`indexed_text_files: ${repoInfo.indexed_text_files}`);
    console.log(`skipped_files: ${repoInfo.skipped_files}`);
    console.log(`binary_files: ${repoInfo.binary_files}`);
    console.log(`generated_files_skipped: ${repoInfo.generated_files_skipped}`);
    console.log(`total_chunks: ${repoInfo.total_chunks}`);
    console.log('');

    console.log('MAJOR EXTENSIONS');
    for(const [extension, count] of Object.entries(repoInfo.major_extensions ?? {}).slice(0, 15)) {
        console.log(`- ${extension}: ${count}`);
    }
    console.log('');

    console.log('MAJOR FILE CLASSES');
    for(const [fileClass, count] of Object.entries(repoInfo.major_file_classes ?? {}).slice(0, 15)) {
        console.log(`- ${fileClass}: ${count}`);
    }
    console.log('');

    console.log('MAJOR DIRECTORIES');
    for(const directory of repoInfo.major_directories ?? []) {
        console.log(`- ${directory.path}: files=${directory.recursive_file_count}, indexed=${directory.indexed_file_count}`);
    }
}

export async function runFind(queryText: string, projectRoot?: string) {
    const result = await QC.runQuery(queryText, projectRoot);

    console.log(`QUERY: ${result.query.normalized_text || result.query.original}`);
    console.log('');

    console.log('TOP FILES');
    if(result.topFiles.length === 0) {
        console.log('- No matching files found.');
    } else {
        result.topFiles.forEach((file: any, index: number) => {
            console.log(`${index + 1}. ${file.path}`);
            console.log(`   score: ${file.score.toFixed(2)}`);
            console.log(`   class: ${file.file_class}`);
            console.log(`   why: ${file.reasons.join(' + ') || 'term match'}`);
            if(hasText(file.preview)) {
                console.log(`   preview: ${file.preview}`);
            }
        });
    }

    console.log('');
    console.log('TOP CHUNKS');
    if(result.topChunks.length === 0) {
        console.log('- No matching chunks found.');
    } else {
        result.topChunks.forEach((chunk: any, index: number) => {
            console.log(`${index + 1}. [${chunk.chunk_id}] ${chunk.path} lines ${chunk.start_line}-${chunk.end_line}`);
            if(hasText(chunk.title)) {
                console.log(`   title: ${chunk.title}`);
            }
            console.log(`   score: ${chunk.score.toFixed(2)}`);
            console.log(`   why: ${chunk.reasons.join(' + ') || 'term match'}`);
            if(hasText(chunk.preview)) {
                console.log(`   preview: ${chunk.preview}`);
            }
        });
    }

    console.log('');
    console.log('RELATED FILES');
    if(result.relatedFiles.length === 0) {
        console.log('- None.');
    } else {
        for(const relatedFile of result.relatedFiles) {
            console.log(`- ${relatedFile.path} (${relatedFile.reason})`);
        }
    }

    await persistQueryArtifactBestEffort('find', queryText, QC.makePersistableQueryResult(result), projectRoot);
}

export async function runInspect(target: string, projectRoot?: string) {
    const state = await loadCoreState(projectRoot);

    const byFileId = state.filesById.get(target);
    const byFilePath = state.filesByPath.get(target);
    const byChunkId = state.chunksById.get(target);

    if(byChunkId) {
        const owningFile = state.filesById.get(byChunkId.file_id);

        console.log(`INSPECT: ${target}`);
        console.log(`type: chunk`);
        console.log(`path: ${byChunkId.path}`);
        console.log(`file_id: ${byChunkId.file_id}`);
        console.log(`chunk_id: ${byChunkId.chunk_id}`);
        console.log(`lines: ${byChunkId.start_line}-${byChunkId.end_line}`);
        console.log(`kind: ${byChunkId.kind}`);
        console.log(`title: ${byChunkId.title || '(none)'}`);
        console.log(`file_class: ${owningFile?.file_class ?? 'unknown'}`);
        console.log(`preview: ${byChunkId.preview || '(none)'}`);
        console.log('');
        console.log('TOP TERMS');
        for(const item of byChunkId.top_terms ?? []) {
            console.log(`- ${item.term}: ${item.count}`);
        }
        console.log('');
        console.log('TOP IDENTIFIERS');
        for(const item of byChunkId.top_identifiers ?? []) {
            console.log(`- ${item.identifier}: ${item.count}`);
        }
        console.log('');
        console.log('TEXT');
        console.log(byChunkId.text);
        await persistQueryArtifactBestEffort(
            'inspect',
            target,
            buildInspectArtifactPayload(target, byChunkId, null, [], owningFile, 'chunk_id'),
            projectRoot,
        );
        return;
    }

    const fileRecord = byFileId ?? byFilePath;
    const resolvedBy = byFileId ? 'file_id' : 'file_path';

    if(!fileRecord) {
        throw new Error(`No file or chunk found for inspect target: ${target}`);
    }

    const fileChunks = state.chunksByFileId.get(fileRecord.file_id) ?? [];

    console.log(`INSPECT: ${target}`);
    console.log(`type: file`);
    console.log(`path: ${fileRecord.path}`);
    console.log(`file_id: ${fileRecord.file_id}`);
    console.log(`class: ${fileRecord.file_class}`);
    console.log(`indexed: ${fileRecord.indexed}`);
    console.log(`extension: ${fileRecord.extension || '(none)'}`);
    console.log(`size_bytes: ${fileRecord.size_bytes}`);
    console.log(`line_count: ${fileRecord.line_count}`);
    console.log(`chunk_count: ${fileRecord.chunk_count}`);
    if(!fileRecord.indexed && fileRecord.skip_reason) {
        console.log(`skip_reason: ${fileRecord.skip_reason}`);
    }
    if(hasText(fileRecord.preview)) {
        console.log(`preview: ${fileRecord.preview}`);
    }
    console.log('');

    console.log('SECTION TITLES');
    if((fileRecord.section_titles ?? []).length === 0) {
        console.log('- None.');
    } else {
        for(const title of fileRecord.section_titles) {
            console.log(`- ${title}`);
        }
    }
    console.log('');

    console.log('TOP TERMS');
    for(const item of fileRecord.top_terms ?? []) {
        console.log(`- ${item.term}: ${item.count}`);
    }
    console.log('');

    console.log('TOP IDENTIFIERS');
    for(const item of fileRecord.top_identifiers ?? []) {
        console.log(`- ${item.identifier}: ${item.count}`);
    }
    console.log('');

    console.log('CHUNKS');
    if(fileChunks.length === 0) {
        console.log('- None.');
    } else {
        for(const chunk of fileChunks) {
            console.log(`- [${chunk.chunk_id}] lines ${chunk.start_line}-${chunk.end_line} | kind=${chunk.kind}${hasText(chunk.title) ? ` | title=${chunk.title}` : ''}`);
            if(hasText(chunk.preview)) {
                console.log(`  preview: ${chunk.preview}`);
            }
        }
    }

    await persistQueryArtifactBestEffort(
        'inspect',
        target,
        buildInspectArtifactPayload(target, null, fileRecord, fileChunks, null, resolvedBy),
        projectRoot,
    );
}

export async function runPack(queryText: string, projectRoot?: string) {
    const result = await QC.runQuery(queryText, projectRoot);

    console.log(`TASK: ${result.query.normalized_text || result.query.original}`);
    console.log('');

    console.log('LIKELY TARGET FILES');
    if(result.topFiles.length === 0) {
        console.log('- No likely target files found.');
    } else {
        result.topFiles.forEach((file: any, index: number) => {
            console.log(`${index + 1}. ${file.path}`);
            console.log(`   score: ${file.score.toFixed(2)}`);
            console.log(`   class: ${file.file_class}`);
            console.log(`   why: ${file.reasons.join(' + ') || 'term match'}`);
            if(file.best_chunks.length > 0) {
                const strongestChunk = file.best_chunks[0];
                console.log(`   best_section: ${strongestChunk.start_line}-${strongestChunk.end_line}${hasText(strongestChunk.title) ? ` | ${strongestChunk.title}` : ''}`);
            }
        });
    }

    console.log('');
    console.log('LIKELY SECTIONS');
    if(result.topChunks.length === 0) {
        console.log('- No likely sections found.');
    } else {
        result.topChunks.forEach((chunk: any, index: number) => {
            console.log(`${index + 1}. [${chunk.chunk_id}] ${chunk.path} lines ${chunk.start_line}-${chunk.end_line}`);
            if(hasText(chunk.title)) {
                console.log(`   title: ${chunk.title}`);
            }
            console.log(`   why: ${chunk.reasons.join(' + ') || 'term match'}`);
            if(hasText(chunk.preview)) {
                console.log(`   preview: ${chunk.preview}`);
            }
        });
    }

    console.log('');
    console.log('RELATED FILES');
    if(result.relatedFiles.length === 0) {
        console.log('- None.');
    } else {
        for(const relatedFile of result.relatedFiles) {
            console.log(`- ${relatedFile.path} (${relatedFile.reason})`);
        }
    }

    console.log('');
    console.log('SUGGESTED NEXT COMMANDS');
    if(result.topFiles.length === 0 && result.topChunks.length === 0) {
        console.log('- node .ai/scale/project-map.mjs stats');
        console.log(`- node .ai/scale/project-map.mjs find ${JSON.stringify(result.query.normalized_text || result.query.original)}`);
    } else {
        const suggestedPaths = new Set();

        for(const chunk of result.topChunks.slice(0, 4)) {
            console.log(`- node .ai/scale/project-map.mjs inspect ${JSON.stringify(chunk.chunk_id)}`);
            suggestedPaths.add(chunk.path);
        }

        for(const file of result.topFiles.slice(0, 3)) {
            if(!suggestedPaths.has(file.path)) {
                console.log(`- node .ai/scale/project-map.mjs inspect ${JSON.stringify(file.path)}`);
            }
        }
    }

    await persistQueryArtifactBestEffort('pack', queryText, QC.makePersistableQueryResult(result), projectRoot);
}

