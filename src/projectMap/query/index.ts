import * as core from './core';

export const normalizeQuery = core.normalizeQuery;
export const scoreChunkForQuery = core.scoreChunkForQuery;
export const loadRelevantPostings = core.loadRelevantPostings;
export const runQuery = core.runQuery;
export const persistQueryArtifact = core.persistQueryArtifact;
export const makePersistableQueryResult = core.makePersistableQueryResult;

export default core;

