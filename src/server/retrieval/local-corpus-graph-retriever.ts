import { loadCorpusDocuments } from "@/server/ingestion/corpus";
import type {
  GraphEntity,
  GraphNodeFact,
  GraphRelationshipFact,
  GraphRetrievalOutcome,
  GraphRetriever,
} from "./graph-types";

type CorpusEvent = {
  docId: string;
  title: string;
  url: string;
  text: string;
  event: string;
  games: string;
  venue: string;
  date: string;
};

function readInfoboxField(text: string, field: string): string {
  const match = text.match(new RegExp(`^\\s*${field}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

function terms(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2),
    ),
  ];
}

function matchScore(name: string, searchableText: string): number {
  const normalizedName = name.toLowerCase().trim();
  const normalizedText = searchableText.toLowerCase();
  if (normalizedName && normalizedText.includes(normalizedName)) return 1;
  const queryTerms = terms(normalizedName);
  if (queryTerms.length === 0) return 0;
  return queryTerms.filter((term) => normalizedText.includes(term)).length / queryTerms.length;
}

function loadCorpusEvents(): CorpusEvent[] {
  return loadCorpusDocuments().map((document) => ({
    docId: document.docId,
    title: document.title,
    url: document.url,
    text: document.text,
    event: readInfoboxField(document.text, "event") || document.title,
    games: readInfoboxField(document.text, "games"),
    venue: readInfoboxField(document.text, "venue"),
    date: readInfoboxField(document.text, "date") || readInfoboxField(document.text, "dates"),
  }));
}

export class LocalCorpusGraphRetriever implements GraphRetriever {
  readonly strategy = "local-corpus-event-graph";
  private readonly events = loadCorpusEvents();

  async retrieve(entities: GraphEntity[], depth: number): Promise<GraphRetrievalOutcome> {
    const matches = this.events
      .map((event) => ({
        event,
        score: Math.max(
          ...entities.map((entity) =>
            matchScore(
              entity.name,
              `${event.title} ${event.event} ${event.games} ${event.venue} ${event.text}`,
            ),
          ),
        ),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);

    const nodes = new Map<string, GraphNodeFact>();
    const relationships: GraphRelationshipFact[] = [];
    const resolvedEntities = new Set<string>();

    for (const { event } of matches) {
      const eventId = `event:${event.docId}`;
      const documentId = `document:${event.docId}`;
      const eventNode: GraphNodeFact = {
        id: eventId,
        vertexType: "Event",
        label: event.event,
        attributes: {
          event: event.event,
          games: event.games,
          venue: event.venue,
          date: event.date,
        },
      };
      const documentNode: GraphNodeFact = {
        id: documentId,
        vertexType: "Document",
        label: event.title,
        attributes: { title: event.title, url: event.url },
      };
      nodes.set(eventId, eventNode);
      nodes.set(documentId, documentNode);
      relationships.push({
        sourceId: documentId,
        sourceLabel: event.title,
        edgeType: "DESCRIBES",
        targetId: eventId,
        targetLabel: event.event,
      });

      if (event.games) {
        const gamesId = `games:${event.games.toLowerCase()}`;
        nodes.set(gamesId, {
          id: gamesId,
          vertexType: "Games",
          label: event.games,
          attributes: { name: event.games },
        });
        relationships.push({
          sourceId: eventId,
          sourceLabel: event.event,
          edgeType: "HELD_AT",
          targetId: gamesId,
          targetLabel: event.games,
        });
      }

      if (event.venue) {
        const venueId = `venue:${event.venue.toLowerCase()}`;
        nodes.set(venueId, {
          id: venueId,
          vertexType: "Venue",
          label: event.venue,
          attributes: { name: event.venue },
        });
        relationships.push({
          sourceId: eventId,
          sourceLabel: event.event,
          edgeType: "AT_VENUE",
          targetId: venueId,
          targetLabel: event.venue,
        });
      }

      for (const entity of entities) {
        if (
          matchScore(entity.name, `${event.title} ${event.event} ${event.games} ${event.venue}`) >=
          0.5
        ) {
          resolvedEntities.add(entity.name);
        }
      }
    }

    return {
      resolvedEntities: [...resolvedEntities],
      nodes: [...nodes.values()],
      relationships,
      strategy: this.strategy,
      traversalDepth: depth,
    };
  }
}
