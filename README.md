# RAGNEX — From Retrieval to Autonomous Investigation

> **RAG retrieves. GraphRAG connects. Agentic GraphRAG investigates.**

RAGNEX is an Agentic GraphRAG system built for the **TigerGraph Agentic GraphRAG Hackathon 2026**.

The project compares three approaches — **RAG, GraphRAG, and Agentic GraphRAG** — to understand when simple retrieval is sufficient, when graph relationships provide additional value, and when autonomous investigation is useful.

---

## 🚀 Project Overview

RAGNEX allows the same question to be investigated using three different approaches:

### 1. RAG — Retrieves

Traditional Retrieval-Augmented Generation retrieves relevant information from the local Olympic document corpus and generates an answer using the retrieved context.

### 2. GraphRAG — Connects

GraphRAG uses **TigerGraph Savanna** to connect structured information such as:

- Olympic Events
- Olympic Games
- Venues
- Documents

The graph allows the system to retrieve connected evidence and reason over relationships.

### 3. Agentic GraphRAG — Investigates

Agentic GraphRAG performs an adaptive investigation using multiple tools.

The agent can:

- Extract entities
- Search documents
- Search the graph
- Traverse graph relationships
- Evaluate evidence
- Decide whether additional investigation is required
- Stop when sufficient evidence is available

---

## 🎯 Core Research Question

> **When is RAG enough, when does graph reasoning help, and when is autonomous investigation actually useful?**

RAGNEX does not assume that Agentic GraphRAG is always better.

Instead, it provides a workspace to compare the three approaches using retrieval evidence, graph evidence, investigation steps, latency, token usage, and execution traces.

---

## 🏗️ Architecture

```text
                         ┌─────────────────────┐
                         │     User Question   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ RAGNEX Investigation│
                         │      Interface      │
                         └──────────┬──────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 │                  │                  │
                 ▼                  ▼                  ▼
          ┌────────────┐     ┌────────────┐    ┌─────────────────┐
          │    RAG     │     │  GraphRAG  │    │ Agentic GraphRAG│
          └─────┬──────┘     └──────┬─────┘    └────────┬────────┘
                │                   │                   │
                ▼                   ▼                   ▼
        Local Document       TigerGraph Graph      Agent Tools
           Corpus                 │                   │
                                  │          ┌────────┼─────────┐
                                  │          │        │         │
                                  ▼          ▼        ▼         ▼
                            Graph Evidence  Search  Traverse  Evaluate
                                  │
                                  └──────────┬──────────────┘
                                             ▼
                                      Evidence Aggregation
                                             │
                                             ▼
                                        Final Answer
                                             │
                                             ▼
                                   Metrics + Investigation
                                         Trace
