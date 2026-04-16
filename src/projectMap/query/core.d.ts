export function normalizeQuery(query: string): { original: string; normalized_text: string; terms: string[] };

export function scoreChunkForQuery(args: any): any;

export function loadRelevantPostings(queryTerms: string[], projectRoot?: string): Promise<Map<string, any>>;

export function runQuery(queryText: string, projectRoot?: string): Promise<any>;

export function persistQueryArtifact(kind: string, queryText: string, payload: unknown, projectRoot?: string): Promise<void>;

export function makePersistableQueryResult(result: any): any;

