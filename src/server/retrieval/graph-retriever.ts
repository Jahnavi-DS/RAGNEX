import { GroqConfigError, GroqRequestError, generateGroundedAnswer } from "@/server/groq";
import {
  TigerGraphAuthError,
  TigerGraphConfigError,
  TigerGraphRequestError,
  getConfiguredQueryName,
  getEdges,
  getVertex,
  getVerticesByAttribute,
  runInstalledQuery,
} from "@/server/tigergraph";
import { isTigerGraphConfigured } from "@/server/tigergraph";
import { LocalCorpusGraphRetriever } from "./local-corpus-graph-retriever";
import type {
  GraphEntity,
  GraphNodeFact,
  GraphRelationshipFact,
  GraphRetrievalOutcome,
  GraphRetriever,
} from "./graph-types";

// ---------------------------------------------------------------------------
// 1. ENTITY IDENTIFICATION (Groq)
// ---------------------------------------------------------------------------

export class EntityExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntityExtractionError";
  }
}

const MAX_ENTITIES = 6;
const GENERIC_ENTITY_TERMS = new Set([
  "which",
  "olympic",
  "olympics",
  "event",
  "events",
  "games",
  "sport",
  "sports",
  "competition",
  "competitions",
  "venue",
  "venues",
  "held",
  "hosted",
  "where",
  "what",
  "when",
  "who",
]);

function filterQuestionEntities(entities: GraphEntity[], question: string): GraphEntity[] {
  const questionTerms = new Set(
    question
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  return entities.filter((entity) => {
    const terms = entity.name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 2 && !GENERIC_ENTITY_TERMS.has(term));
    if (terms.length === 0) return false;
    const matched = terms.filter((term) => questionTerms.has(term)).length;
    return matched > 0 && matched / terms.length >= 0.75;
  });
}

function buildEntityExtractionPrompt(question: string): string {
  return [
    "Extract the key entities and concepts from the question below that would be useful nodes to look up in a knowledge graph.",
    'Return ONLY a JSON array, no prose, no markdown fences. Each item must be an object: {"name": string, "type": string | null}.',
    `Return at most ${MAX_ENTITIES} entities, ordered by importance to answering the question.`,
    '"type" should be a short lowercase noun (e.g. "company", "person", "product", "event") if it can be inferred, otherwise null.',
    "",
    `Question: ${question}`,
    "",
    "JSON array:",
  ].join("\n");
}

function parseEntitiesJson(text: string): GraphEntity[] {
  // Groq is instructed to return raw JSON, but strip code fences defensively
  // in case it doesn't comply.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new EntityExtractionError("Entity extraction did not return a JSON array.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new EntityExtractionError("Entity extraction returned malformed JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new EntityExtractionError("Entity extraction did not return an array.");
  }

  const entities: GraphEntity[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === "object" &&
      "name" in item &&
      typeof (item as { name: unknown }).name === "string"
    ) {
      const name = (item as { name: string }).name.trim();
      if (!name) continue;
      const rawType = (item as { type?: unknown }).type;
      entities.push({
        name,
        type: typeof rawType === "string" && rawType.trim() ? rawType.trim() : null,
      });
    }
  }
  return entities.slice(0, MAX_ENTITIES);
}

/**
 * Identifies the key entities/concepts in a question using Groq.
 * Throws GroqConfigError, GroqRequestError, or EntityExtractionError —
 * callers turn these into a structured GraphRagResult error.
 */
export async function identifyEntities(question: string): Promise<{
  entities: GraphEntity[];
  latencyMs: number;
  tokenUsage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
}> {
  const start = performance.now();
  const generation = await generateGroundedAnswer(buildEntityExtractionPrompt(question));
  const entities = filterQuestionEntities(parseEntitiesJson(generation.text), question);
  return { entities, latencyMs: performance.now() - start, tokenUsage: generation.usage };
}

export { GroqConfigError, GroqRequestError };

// ---------------------------------------------------------------------------
// 2. GRAPH TRAVERSAL (TigerGraph/Savanna)
// ---------------------------------------------------------------------------
//
// Resolve entities with REST++ server-side attribute filters, then use the
// installed event_neighborhood query and schema-constrained adjacency reads.

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function parseNodes(raw: unknown[], fallbackVertexType = "Unknown"): GraphNodeFact[] {
  const nodes: GraphNodeFact[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    const id = firstString(record, ["v_id", "id", "vertex_id"]);
    if (!id) continue;
    const vertexType = firstString(record, ["v_type", "vertexType", "type"]) ?? fallbackVertexType;
    const attributes = asRecord(record["attributes"] ?? record);
    const label =
      firstString(attributes, ["name", "title", "label", "event", "event_name", "venue_name"]) ??
      (vertexType === "Games"
        ? [firstString(attributes, ["season"]), firstString(attributes, ["year"])]
            .filter(Boolean)
            .join(" ")
        : id);
    nodes.push({ id: `${vertexType}:${id}`, vertexType, label, attributes });
  }
  return nodes;
}

function eventMatchScore(entityName: string, vertex: Record<string, unknown>): number {
  const attributes = asRecord(vertex["attributes"]);
  const searchableText = [vertex["v_id"], ...Object.values(attributes)]
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" ")
    .toLowerCase();
  const normalizedName = entityName.toLowerCase().trim();
  if (normalizedName && searchableText.includes(normalizedName)) return 1;

  const terms = [...new Set(normalizedName.split(/[^a-z0-9]+/).filter((term) => term.length > 2))];
  const gamesMatch = normalizedName.match(/\b(\d{4})\s+(summer|winter)\s+olympics\b/);
  if (gamesMatch) {
    const searchableTerms = new Set(searchableText.split(/[^a-z0-9]+/).filter(Boolean));
    if (searchableTerms.has(gamesMatch[1]!) && searchableTerms.has(gamesMatch[2]!)) return 1;
  }
  if (terms.length === 0) return 0;
  const searchableTerms = new Set(searchableText.split(/[^a-z0-9]+/).filter(Boolean));
  const matchedTerms = terms.filter((term) => searchableTerms.has(term)).length;
  return matchedTerms / terms.length;
}

function entityTypeMatchesVertex(entity: GraphEntity, vertexType: string): boolean {
  const type = entity.type?.toLowerCase() ?? "";
  const name = entity.name.toLowerCase();
  if (/\b(?:\d{4}\s+)?(?:summer|winter)\s+(?:olympics|games)\b/.test(name)) {
    return vertexType === "Games";
  }
  if (/venue|location|place|stadium|arena/.test(type)) return vertexType === "Venue";
  if (/game|olympic|tournament|edition/.test(type)) return vertexType === "Games";
  if (/event|sport|competition/.test(type)) return vertexType === "Event";
  if (/document|article|source/.test(type)) return vertexType === "Document";
  return false;
}

type TigerGraphVertex = {
  v_id?: string;
  v_type?: string;
  attributes?: Record<string, unknown>;
};

type TigerGraphEdge = {
  e_type?: string;
  from_id?: string;
  from_type?: string;
  to_id?: string;
  to_type?: string;
};

const SCHEMA_EDGES = {
  DESCRIBES: { sourceType: "Document", targetType: "Event", neighborType: "Event" },
  HELD_AT: { sourceType: "Event", targetType: "Games", neighborType: "Games" },
  AT_VENUE: { sourceType: "Event", targetType: "Venue", neighborType: "Venue" },
} as const;

function vertexKey(vertexType: string, id: string): string {
  return `${vertexType}:${id}`;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await mapper(items[index]!);
      }
    }),
  );
  return results;
}

function edgeTraversalTypes(
  vertexType: string,
): Array<{ edgeType: keyof typeof SCHEMA_EDGES; targetType: string }> {
  if (vertexType === "Event") {
    return [
      { edgeType: "DESCRIBES", targetType: "Document" },
      { edgeType: "HELD_AT", targetType: "Games" },
      { edgeType: "AT_VENUE", targetType: "Venue" },
    ];
  }
  if (vertexType === "Document") return [{ edgeType: "DESCRIBES", targetType: "Event" }];
  if (vertexType === "Games") return [{ edgeType: "HELD_AT", targetType: "Event" }];
  if (vertexType === "Venue") return [{ edgeType: "AT_VENUE", targetType: "Event" }];
  return [];
}

function orientSchemaEdge(edge: TigerGraphEdge): {
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  edgeType: keyof typeof SCHEMA_EDGES;
} | null {
  const edgeType = edge.e_type as keyof typeof SCHEMA_EDGES | undefined;
  const schema = edgeType ? SCHEMA_EDGES[edgeType] : undefined;
  if (!edgeType || !schema || !edge.from_id || !edge.from_type || !edge.to_id || !edge.to_type) {
    return null;
  }

  if (edge.from_type === schema.sourceType && edge.to_type === schema.targetType) {
    return {
      sourceType: schema.sourceType,
      sourceId: edge.from_id,
      targetType: schema.targetType,
      targetId: edge.to_id,
      edgeType,
    };
  }
  if (edge.to_type === schema.sourceType && edge.from_type === schema.targetType) {
    return {
      sourceType: schema.sourceType,
      sourceId: edge.to_id,
      targetType: schema.targetType,
      targetId: edge.from_id,
      edgeType,
    };
  }
  return null;
}

const ENTITY_LOOKUP_ATTRIBUTES: Record<string, string[]> = {
  Event: ["event_name"],
  Games: ["name", "games_name"],
  Venue: ["venue_name"],
};

function queryResultVertexType(resultName: string): string {
  const normalized = resultName.toLowerCase();
  return (
    ["document", "event", "games", "venue"].find(
      (type) => type === normalized || `${type}s` === normalized,
    ) ?? "Unknown"
  );
}

type NamedQueryRecord = { resultName: string; value: Record<string, unknown> };

function collectNamedQueryRecords(
  value: unknown,
  resultName = "",
  records: NamedQueryRecord[] = [],
): NamedQueryRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) collectNamedQueryRecords(item, resultName, records);
    return records;
  }
  if (!value || typeof value !== "object") return records;

  const record = asRecord(value);
  const isEdge = typeof record["e_type"] === "string";
  const isVertex =
    firstString(record, ["v_id", "id", "vertex_id"]) !== null &&
    (record["attributes"] !== undefined || record["v_type"] !== undefined);
  if (isEdge || isVertex) {
    records.push({ resultName, value: record });
    return records;
  }

  for (const [name, nested] of Object.entries(record)) {
    collectNamedQueryRecords(nested, name || resultName, records);
  }
  return records;
}

function parseQueryNodes(resultSets: unknown[]): TigerGraphVertex[] {
  return collectNamedQueryRecords(resultSets)
    .filter(({ value }) => typeof value["e_type"] !== "string")
    .flatMap(({ resultName, value }) => {
      const vertexType = firstString(value, ["v_type", "vertexType", "type"]);
      return [{ ...value, v_type: vertexType ?? queryResultVertexType(resultName) }];
    });
}

function parseQueryEdges(resultSets: unknown[]): TigerGraphEdge[] {
  return collectNamedQueryRecords(resultSets)
    .filter(({ value }) => typeof value["e_type"] === "string")
    .flatMap(({ value }) => {
      const edgeType = firstString(value, ["e_type"]);
      const schema = edgeType ? SCHEMA_EDGES[edgeType as keyof typeof SCHEMA_EDGES] : undefined;
      if (!schema) return [];
      return [
        {
          ...value,
          from_type: firstString(value, ["from_type"]) ?? schema.sourceType,
          to_type: firstString(value, ["to_type"]) ?? schema.targetType,
        } as TigerGraphEdge,
      ];
    });
}

export class TigerGraphRetriever implements GraphRetriever {
  readonly strategy = "tigergraph-event-neighborhood-restpp";

  async retrieve(entities: GraphEntity[], depth: number): Promise<GraphRetrievalOutcome> {
    const lookupResults = await mapConcurrent(entities, 4, async (entity) => {
      const supportedTypes = Object.keys(ENTITY_LOOKUP_ATTRIBUTES).filter(
        (type) => !entity.type || entityTypeMatchesVertex(entity, type),
      );
      const results = await Promise.all(
        supportedTypes.flatMap((type) =>
          ENTITY_LOOKUP_ATTRIBUTES[type]!.flatMap((attribute) => {
            const gamesMatch = entity.name.match(/\b(\d{4})\s+(Summer|Winter)\s+Olympics\b/i);
            const lookupValues = gamesMatch
              ? [...new Set([
                  entity.name,
                  `${gamesMatch[2]} ${gamesMatch[1]}`,
                  `${gamesMatch[1]} ${gamesMatch[2]}`,
                ])]
              : [entity.name];
            return lookupValues.map((value) =>
              getVerticesByAttribute<TigerGraphVertex>(type, attribute, value),
            );
          }),
        ),
      );
      return results
        .flat()
        .filter((vertex) =>
          supportedTypes.some(
            (type) =>
              vertex.v_type === type && eventMatchScore(entity.name, asRecord(vertex)) >= 0.75,
          ),
        );
    });
    const matchedVertices = new Map<string, TigerGraphVertex>();
    for (const vertex of lookupResults.flat()) {
      const vertexType = vertex.v_type ?? "Unknown";
      const vertexId = vertex.v_id;
      if (vertexId) matchedVertices.set(vertexKey(vertexType, vertexId), vertex);
    }

    const matchedNonEvents = [...matchedVertices.values()].filter(
      (vertex) => vertex.v_type !== "Event" && vertex.v_type,
    );
    const eventConnections = await mapConcurrent(matchedNonEvents, 6, async (vertex) => {
      const vertexType = vertex.v_type!;
      const traversal = edgeTraversalTypes(vertexType).find(
        ({ targetType }) => targetType === "Event",
      );
      if (!traversal || !vertex.v_id) return { vertex, edges: [], eventIds: [] };
      const edges = await getEdges<TigerGraphEdge>(
        vertexType,
        vertex.v_id,
        traversal.targetType,
        traversal.edgeType,
      );
      const orientedEdges = edges.map(orientSchemaEdge).filter((edge) => edge !== null);
      return {
        vertex,
        edges,
        eventIds: orientedEdges.flatMap((edge) => {
          if (edge.sourceType === "Event") return [edge.sourceId];
          if (edge.targetType === "Event") return [edge.targetId];
          return [];
        }),
      };
    });
    const venueEventIds = new Set(
      eventConnections
        .filter(({ vertex }) => vertex.v_type === "Venue")
        .flatMap(({ eventIds }) => eventIds),
    );
    const gamesEventIds = new Set(
      eventConnections
        .filter(({ vertex }) => vertex.v_type === "Games")
        .flatMap(({ eventIds }) => eventIds),
    );
    const hasVenueGamesScope = venueEventIds.size > 0 && gamesEventIds.size > 0;
    const scopedEventIds = hasVenueGamesScope
      ? new Set([...venueEventIds].filter((eventId) => gamesEventIds.has(eventId)))
      : new Set<string>();
    const eventIds = new Set(
      [...matchedVertices.values()]
        .filter((vertex) => vertex.v_type === "Event" && vertex.v_id)
        .map((vertex) => vertex.v_id!),
    );
    for (const eventId of eventConnections.flatMap(({ eventIds: ids }) => ids)) {
      eventIds.add(eventId);
    }
    if (hasVenueGamesScope) {
      eventIds.clear();
      for (const eventId of scopedEventIds) eventIds.add(eventId);
    }

    const connectedEvents = hasVenueGamesScope
      ? []
      : await mapConcurrent([...eventIds], 6, async (eventId) =>
          getVertex<TigerGraphVertex>("Event", eventId),
        );
    for (const event of connectedEvents) {
      if (event?.v_id) matchedVertices.set(vertexKey("Event", event.v_id), event);
    }

    const queryName = getConfiguredQueryName();
    const queryResultSets = await mapConcurrent([...eventIds], 4, (eventId) =>
      runInstalledQuery<unknown>(queryName, { event_id: eventId }),
    );
    let queryNodes = parseQueryNodes(queryResultSets.flat());
    let queryEdges = parseQueryEdges(queryResultSets.flat());
    if (scopedEventIds.size > 0) {
      const targetEventKeys = new Set(
        [...scopedEventIds].map((eventId) => vertexKey("Event", eventId)),
      );
      const describedDocumentIds = new Set(
        queryEdges
          .map(orientSchemaEdge)
          .filter(
            (edge) =>
              edge?.edgeType === "DESCRIBES" && targetEventKeys.has(vertexKey(edge.targetType, edge.targetId)),
          )
          .map((edge) => edge!.sourceId),
      );
      const allowedNodeKeys = new Set([
        ...targetEventKeys,
        ...[...matchedVertices.values()]
          .filter((vertex) => vertex.v_type === "Venue" || vertex.v_type === "Games")
          .flatMap((vertex) => (vertex.v_id ? [vertexKey(vertex.v_type!, vertex.v_id)] : [])),
        ...[...describedDocumentIds].map((documentId) => vertexKey("Document", documentId)),
      ]);
      queryNodes = queryNodes.filter((vertex) => {
        const vertexType = vertex.v_type ?? "Unknown";
        const vertexId = vertex.v_id ?? firstString(asRecord(vertex.attributes), ["id"]);
        return Boolean(vertexId && allowedNodeKeys.has(vertexKey(vertexType, vertexId)));
      });
      queryEdges = queryEdges.filter((edge) => {
        const oriented = orientSchemaEdge(edge);
        return Boolean(
          oriented &&
            allowedNodeKeys.has(vertexKey(oriented.sourceType, oriented.sourceId)) &&
            allowedNodeKeys.has(vertexKey(oriented.targetType, oriented.targetId)),
        );
      });
    }

    const verticesByKey = new Map<string, GraphNodeFact>();
    const rawVerticesByKey = new Map<string, TigerGraphVertex>();
    const edgesByKey = new Map<string, GraphRelationshipFact>();
    const queue: Array<{ vertexType: string; id: string }> = [];
    const visited = new Set<string>();

    const addVertex = (raw: TigerGraphVertex, fallbackType: string): void => {
      const node = parseNodes([raw], fallbackType)[0];
      if (!node) return;
      const rawId = raw.v_id ?? firstString(asRecord(raw.attributes), ["id"]) ?? node.id;
      const key = vertexKey(node.vertexType, rawId);
      if (verticesByKey.has(key)) return;
      verticesByKey.set(key, node);
      rawVerticesByKey.set(key, raw);
      queue.push({ vertexType: node.vertexType, id: rawId });
    };

    for (const vertex of matchedVertices.values()) {
      const type = vertex.v_type ?? "Unknown";
      addVertex(vertex, type);
    }
    for (const vertex of queryNodes) addVertex(vertex, vertex.v_type ?? "Unknown");
    for (const edge of queryEdges) {
      const oriented = orientSchemaEdge(edge);
      if (!oriented) continue;
      const sourceKey = vertexKey(oriented.sourceType, oriented.sourceId);
      const targetKey = vertexKey(oriented.targetType, oriented.targetId);
      edgesByKey.set(`${sourceKey}:${oriented.edgeType}:${targetKey}`, {
        sourceId: sourceKey,
        sourceLabel: verticesByKey.get(sourceKey)?.label ?? oriented.sourceId,
        edgeType: oriented.edgeType,
        targetId: targetKey,
        targetLabel: verticesByKey.get(targetKey)?.label ?? oriented.targetId,
      });
    }
    if (scopedEventIds.size > 0) {
      for (const connection of eventConnections) {
        for (const edge of connection.edges) {
          const oriented = orientSchemaEdge(edge);
          if (!oriented) continue;
          const eventId =
            oriented.sourceType === "Event" ? oriented.sourceId : oriented.targetId;
          if (!scopedEventIds.has(eventId)) continue;
          const sourceKey = vertexKey(oriented.sourceType, oriented.sourceId);
          const targetKey = vertexKey(oriented.targetType, oriented.targetId);
          edgesByKey.set(`${sourceKey}:${oriented.edgeType}:${targetKey}`, {
            sourceId: sourceKey,
            sourceLabel: verticesByKey.get(sourceKey)?.label ?? oriented.sourceId,
            edgeType: oriented.edgeType,
            targetId: targetKey,
            targetLabel: verticesByKey.get(targetKey)?.label ?? oriented.targetId,
          });
        }
      }
    }

    for (let hop = 0; hop < depth && queue.length > 0; hop++) {
      if (hasVenueGamesScope) break;
      const currentBatch = queue.splice(0, 30);
      const traversals = currentBatch.flatMap((current) => {
        const key = vertexKey(current.vertexType, current.id);
        if (visited.has(key)) return [];
        visited.add(key);
        return edgeTraversalTypes(current.vertexType).map((target) => ({ current, target }));
      });

      const adjacencyResults = await mapConcurrent(traversals, 6, async ({ current, target }) => ({
        current,
        target,
        edges: (
          await getEdges<TigerGraphEdge>(
            current.vertexType,
            current.id,
            target.targetType,
            target.edgeType,
          )
        ).slice(0, 24),
      }));

      const discovered = new Map<string, { vertexType: string; id: string }>();
      for (const { current, edges } of adjacencyResults) {
        for (const edge of edges) {
          const oriented = orientSchemaEdge(edge);
          if (!oriented) continue;
          const sourceKey = vertexKey(oriented.sourceType, oriented.sourceId);
          const targetKey = vertexKey(oriented.targetType, oriented.targetId);
          const currentKey = vertexKey(current.vertexType, current.id);
          const neighbor =
            currentKey === sourceKey
              ? { key: targetKey, vertexType: oriented.targetType, id: oriented.targetId }
              : currentKey === targetKey
                ? { key: sourceKey, vertexType: oriented.sourceType, id: oriented.sourceId }
                : null;
          if (!neighbor) continue;
          const currentNode = verticesByKey.get(sourceKey);
          const neighborNode = verticesByKey.get(targetKey);
          const relationship: GraphRelationshipFact = {
            sourceId: sourceKey,
            sourceLabel: currentNode?.label ?? oriented.sourceId,
            edgeType: oriented.edgeType,
            targetId: targetKey,
            targetLabel: neighborNode?.label ?? oriented.targetId,
          };
          edgesByKey.set(`${sourceKey}:${oriented.edgeType}:${targetKey}`, relationship);
          discovered.set(neighbor.key, { vertexType: neighbor.vertexType, id: neighbor.id });
        }
      }
      const missingVertices = [...discovered.values()].filter(
        ({ vertexType, id }) => !verticesByKey.has(vertexKey(vertexType, id)),
      );
      const fetchedVertices = await mapConcurrent(missingVertices, 6, async (vertex) => ({
        ...vertex,
        raw: await getVertex<TigerGraphVertex>(vertex.vertexType, vertex.id),
      }));
      for (const { vertexType, id, raw } of fetchedVertices) {
        if (raw) addVertex(raw, vertexType);
      }
      for (const value of discovered.values()) {
        const key = vertexKey(value.vertexType, value.id);
        const raw = rawVerticesByKey.get(key);
        if (
          raw &&
          !visited.has(key) &&
          !queue.some((item) => item.vertexType === value.vertexType && item.id === value.id)
        ) {
          queue.push(value);
        }
      }
    }

    const resolvedEntities = entities
      .filter((entity) =>
        [...verticesByKey.values()].some(
          (node) =>
            eventMatchScore(entity.name, {
              v_id: node.id,
              attributes: node.attributes,
            }) >= 0.75,
        ),
      )
      .map((entity) => entity.name);

    return {
      resolvedEntities,
      nodes: Array.from(verticesByKey.values()),
      relationships: Array.from(edgesByKey.values()).map((edge) => ({
        ...edge,
        sourceLabel: verticesByKey.get(edge.sourceId)?.label ?? edge.sourceLabel,
        targetLabel: verticesByKey.get(edge.targetId)?.label ?? edge.targetLabel,
      })),
      strategy: this.strategy,
      traversalDepth: hasVenueGamesScope ? 1 : depth,
    };
  }
}

/** Uses live REST++ traversal when configured; local corpus graph is explicitly labeled fallback. */
export class ResilientGraphRetriever implements GraphRetriever {
  readonly strategy = "tigergraph-restpp-with-local-corpus-fallback";
  private readonly tigerGraph = new TigerGraphRetriever();
  private readonly fallback = new LocalCorpusGraphRetriever();

  async retrieve(entities: GraphEntity[], depth: number): Promise<GraphRetrievalOutcome> {
    if (!isTigerGraphConfigured()) {
      const fallback = await this.fallback.retrieve(entities, depth);
      return {
        ...fallback,
        strategy: `${fallback.strategy} (TigerGraph not configured; local fallback)`,
      };
    }

    try {
      return await this.tigerGraph.retrieve(entities, depth);
    } catch (error) {
      if (
        !(error instanceof TigerGraphConfigError) &&
        !(error instanceof TigerGraphAuthError) &&
        !(error instanceof TigerGraphRequestError)
      ) {
        throw error;
      }
      const fallback = await this.fallback.retrieve(entities, depth);
      const reason = error instanceof Error ? error.message : "TigerGraph request failed";
      return {
        ...fallback,
        strategy: `${fallback.strategy} (TigerGraph unavailable: ${reason}; local fallback)`,
      };
    }
  }
}

export { TigerGraphConfigError, TigerGraphAuthError, TigerGraphRequestError };
