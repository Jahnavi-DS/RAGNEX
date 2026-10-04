# RAGNEX TigerGraph/Savanna Schema
This schema is prepared from the official corpus fields in `data/corpus/corpus.jsonl`.
It is a contract for the graph to be provisioned separately; RAGNEX does not create a
schema or install queries automatically.
## Vertex types
### Document
- `doc_id` STRING, primary identifier from `doc_id`
- `title` STRING
- `url` STRING
- `wikidata_qid` STRING
- `wikipedia_pageid` INT
- `approx_tokens` INT
### Chunk
- `chunk_id` STRING, primary identifier: `<doc_id>#chunk-<index>`
- `doc_id` STRING
- `chunk_index` INT
- `text` STRING
- `start_char` INT
- `end_char` INT
### Entity
- `entity_id` STRING, primary identifier: `wikidata:<wikidata_qid>`
- `label` STRING
- `wikidata_qid` STRING
- `source_doc_id` STRING
### Relationship
Relationships are represented as typed edges with evidence metadata:
- `relationship_id` STRING, primary identifier
- `relationship_type` STRING
- `source_id` STRING
- `target_id` STRING
- `evidence_doc_id` STRING
- `evidence_chunk_id` STRING
- `evidence_text` STRING
## Edges
- `Document` -[`HAS_CHUNK`]-> `Chunk`
- `Document` -[`DOCUMENT_DESCRIBES_ENTITY`]-> `Entity`
- `Entity` -[`RELATES_TO`]-> `Entity` only when a relationship is extracted from
  explicit corpus text and stored with its evidence chunk
The ingestion module prepares document, chunk, and metadata-backed entity records. It
also emits `TEXT_RELATES_TO` candidates only for explicit sentence patterns such as
`A acquired B`, `A merged with B`, or `A is part of B`, retaining the source chunk and
text evidence. It does not infer unstated relationships or send data to TigerGraph.
## Live RAGNEX graph compatibility
The live graph can use `Document`, `Event`, `Games`, and `Venue` vertices with
`DESCRIBES`, `HELD_AT`, and `AT_VENUE` edges. When
`TIGERGRAPH_QUERY_NAME=event_neighborhood`, GraphRAG reads existing `Event`
vertices by resolving extracted entity values with REST++ server-side attribute
filters. For a matched `Venue` or `Games` vertex, it follows the real schema edge
to an `Event`, then calls the installed query with `event_id` and parses its
named result sets. It does not enumerate the full Event vertex collection or
send the generic `input` or `depth` parameters to that query.
If TigerGraph is not configured or a live request fails, GraphRAG may use the
existing local corpus to build an explicitly labeled fallback graph. A
successful live request that returns no matching graph facts remains an empty
live result; it does not trigger local fallback. The installed graph and its
data are never modified by retrieval or fallback.
## Optional generic retrieval query contract
For graphs using the separate Document/Chunk/Entity schema, an installed GSQL
query may accept `input` STRING and `depth` INT and return REST++ result sets
named `Vertices` and `Edges`. The graph and query must be provisioned
separately; RAGNEX does not create or install them.