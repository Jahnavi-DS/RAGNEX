import fs from "node:fs";
import path from "node:path";

export type CorpusDocument = {
  docId: string;
  title: string;
  url: string;
  text: string;
  wikidataQid: string;
  wikipediaPageId: number;
  approxTokens: number;
};

export type CorpusChunk = {
  chunkId: string;
  docId: string;
  chunkIndex: number;
  text: string;
  startChar: number;
  endChar: number;
};

export type EmbeddingInput = {
  chunkId: string;
  text: string;
  embedding: null;
};

export type GraphDocumentRecord = {
  docId: string;
  title: string;
  url: string;
  wikidataQid: string;
  wikipediaPageId: number;
};

export type GraphChunkRecord = {
  chunkId: string;
  docId: string;
  chunkIndex: number;
  text: string;
};

export type GraphEntityRecord = {
  entityId: string;
  label: string;
  wikidataQid: string;
  sourceDocId: string;
};

export type GraphRelationshipRecord = {
  sourceId: string;
  targetId: string;
  relationshipType: "DOCUMENT_DESCRIBES_ENTITY" | "TEXT_RELATES_TO";
  evidenceDocId: string;
  evidenceChunkId?: string;
  evidenceText?: string;
};

export type PreparedGraphRecords = {
  documents: GraphDocumentRecord[];
  chunks: GraphChunkRecord[];
  entities: GraphEntityRecord[];
  relationships: GraphRelationshipRecord[];
};

const DEFAULT_CORPUS_PATH = path.resolve(process.cwd(), "data/corpus/corpus.jsonl");
const DEFAULT_CHUNK_SIZE = 1800;
const DEFAULT_CHUNK_OVERLAP = 180;

function requireString(value: unknown, field: string, lineNumber: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Corpus line ${lineNumber} has an invalid ${field}.`);
  }
  return value.trim();
}

function requireNumber(value: unknown, field: string, lineNumber: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Corpus line ${lineNumber} has an invalid ${field}.`);
  }
  return value;
}

function parseDocument(value: unknown, lineNumber: number): CorpusDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Corpus line ${lineNumber} is not a JSON object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    docId: requireString(record["doc_id"], "doc_id", lineNumber),
    title: requireString(record["title"], "title", lineNumber),
    url: requireString(record["url"], "url", lineNumber),
    text: requireString(record["text"], "text", lineNumber),
    wikidataQid: requireString(record["wikidata_qid"], "wikidata_qid", lineNumber),
    wikipediaPageId: requireNumber(record["wikipedia_pageid"], "wikipedia_pageid", lineNumber),
    approxTokens: requireNumber(record["approx_tokens"], "approx_tokens", lineNumber),
  };
}

export function loadCorpusDocuments(filePath = DEFAULT_CORPUS_PATH): CorpusDocument[] {
  const contents = fs.readFileSync(filePath, "utf8");
  const documents: CorpusDocument[] = [];
  const seenIds = new Set<string>();
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const lineNumber = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`Corpus line ${lineNumber} is not valid JSON.`);
    }
    const document = parseDocument(value, lineNumber);
    if (seenIds.has(document.docId)) throw new Error(`Duplicate corpus doc_id: ${document.docId}.`);
    seenIds.add(document.docId);
    documents.push(document);
  }
  return documents;
}

export function chunkDocument(
  document: CorpusDocument,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP,
): CorpusChunk[] {
  if (chunkSize <= overlap || overlap < 0) throw new Error("Chunk overlap must be smaller than chunk size.");
  const chunks: CorpusChunk[] = [];
  let start = 0;
  let chunkIndex = 0;
  while (start < document.text.length) {
    const requestedEnd = Math.min(start + chunkSize, document.text.length);
    const boundary = requestedEnd === document.text.length
      ? requestedEnd
      : Math.max(document.text.lastIndexOf(" ", requestedEnd), start + Math.floor(chunkSize * 0.6));
    const end = Math.max(boundary, start + 1);
    const text = document.text.slice(start, end).trim();
    if (text) {
      chunks.push({
        chunkId: `${document.docId}#chunk-${chunkIndex}`,
        docId: document.docId,
        chunkIndex,
        text,
        startChar: start,
        endChar: end,
      });
      chunkIndex++;
    }
    if (end >= document.text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export function prepareEmbeddingInputs(chunks: CorpusChunk[]): EmbeddingInput[] {
  return chunks.map((chunk) => ({ chunkId: chunk.chunkId, text: chunk.text, embedding: null }));
}

const EXPLICIT_RELATION_PATTERNS = [
  /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})\s+(acquired|founded|merged with|partnered with|collaborated with|joined)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})\b/g,
  /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})\s+(is\s+(?:a\s+)?part\s+of)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})\b/g,
];

function textEntityId(label: string): string {
  return `text:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function extractTextRelationships(chunks: CorpusChunk[], documentId: string): {
  entities: GraphEntityRecord[];
  relationships: GraphRelationshipRecord[];
} {
  const entities = new Map<string, GraphEntityRecord>();
  const relationships: GraphRelationshipRecord[] = [];
  for (const chunk of chunks) {
    if (chunk.docId !== documentId) continue;
    for (const pattern of EXPLICIT_RELATION_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of chunk.text.matchAll(pattern)) {
        const sourceLabel = match[1]?.trim();
        const predicate = match[2]?.trim() ?? "relates to";
        const targetLabel = (match[3] ?? match[2])?.trim();
        if (!sourceLabel || !targetLabel || sourceLabel === targetLabel) continue;
        const sourceId = textEntityId(sourceLabel);
        const targetId = textEntityId(targetLabel);
        entities.set(sourceId, { entityId: sourceId, label: sourceLabel, wikidataQid: "", sourceDocId: documentId });
        entities.set(targetId, { entityId: targetId, label: targetLabel, wikidataQid: "", sourceDocId: documentId });
        relationships.push({
          sourceId,
          targetId,
          relationshipType: "TEXT_RELATES_TO",
          evidenceDocId: documentId,
          evidenceChunkId: chunk.chunkId,
          evidenceText: `${sourceLabel} ${predicate} ${targetLabel}`,
        });
      }
    }
  }
  return { entities: [...entities.values()], relationships };
}

export function prepareGraphRecords(documents: CorpusDocument[], chunks: CorpusChunk[]): PreparedGraphRecords {
  const metadataEntities = documents.map((document) => ({
    entityId: `wikidata:${document.wikidataQid}`,
    label: document.title,
    wikidataQid: document.wikidataQid,
    sourceDocId: document.docId,
  }));
  const textRecords = documents.flatMap((document) => extractTextRelationships(chunks, document.docId));
  const entities = [...metadataEntities, ...textRecords.flatMap((record) => record.entities)];
  return {
    documents: documents.map((document) => ({
      docId: document.docId,
      title: document.title,
      url: document.url,
      wikidataQid: document.wikidataQid,
      wikipediaPageId: document.wikipediaPageId,
    })),
    chunks: chunks.map(({ chunkId, docId, chunkIndex, text }) => ({ chunkId, docId, chunkIndex, text })),
    entities,
    relationships: [
      ...metadataEntities.map((entity) => ({
      sourceId: entity.sourceDocId,
      targetId: entity.entityId,
      relationshipType: "DOCUMENT_DESCRIBES_ENTITY" as const,
      evidenceDocId: entity.sourceDocId,
      })),
      ...textRecords.flatMap((record) => record.relationships),
    ],
  };
}

export function loadAndPrepareCorpus(): {
  documents: CorpusDocument[];
  chunks: CorpusChunk[];
  embeddingInputs: EmbeddingInput[];
  graph: PreparedGraphRecords;
} {
  const documents = loadCorpusDocuments();
  const chunks = documents.flatMap((document) => chunkDocument(document));
  return {
    documents,
    chunks,
    embeddingInputs: prepareEmbeddingInputs(chunks),
    graph: prepareGraphRecords(documents, chunks),
  };
}