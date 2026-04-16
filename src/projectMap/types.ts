export interface TopTerm {
    term: string;
    count: number;
}

export interface DirectoryAccumulator {
    dir_id: string;
    path: string;
    recursive_file_count: number;
    indexed_file_count: number;
    total_size_bytes: number;
    extension_counts: Record<string, number>;
    class_counts: Record<string, number>;
    term_counts: Map<string, number>;
    notable_files: Array<Record<string, unknown>>;
}

export type PostingsAccumulator = Map<string, Map<string, Array<{ chunk_id: string; tf: number }>>>;

