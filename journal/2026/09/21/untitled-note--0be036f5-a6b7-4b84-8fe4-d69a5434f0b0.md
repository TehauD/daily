---
id: "0be036f5-a6b7-4b84-8fe4-d69a5434f0b0"
title: "Untitled note"
slug: "untitled-note"
schema_version: 2
date: 2026-09-21
created: 2026-09-29T03:27:55.312Z
modified: 2026-09-29T03:31:40.857Z
type: journal
prompt: "What did you ship or move forward?"
tags:
  - journal
  - project/decision-intelligence
  - project/knowledgegraph
  - project/decisionintelligence
  - project/automation
  - project/explainableai
  - project/systemsdesign
  - type/experiment
projects:
  - "[[decision-intelligence]]"
  - "[[knowledgegraph]]"
  - "[[decisionintelligence]]"
  - "[[automation]]"
  - "[[explainableai]]"
  - "[[systemsdesign]]"
artifact_types:
  - experiment
aliases:
  - The Daily 2026-09-21
artifacts: 2
words: 476
cssclasses:
  - the-daily
---

# Untitled note

> [!abstract] Artifacts
> ⚗ experiment

## 2026-09-21

> [!abstract] Artifacts ⚗ experiment
> 2026-09-21 · #decision-intelligence

# ⚗ Experiment

## The Daily: Turning Operational Work into a Decision System

Most operational systems are good at recording what happened. They are less effective at preserving why a decision was made, what evidence supported it, and what should happen when the underlying conditions change.

Today I continued exploring a different model: treat operational work as a network of resources, capabilities, requirements, decisions, and outcomes.

The central insight was that resources are the nouns of an organization. Capabilities, dependencies, requirements, and actions are the verbs that connect them.

This creates a foundation for something more useful than a conventional dashboard. Instead of presenting isolated metrics, the system can help explain how work moves, where it becomes constrained, and which decisions have the greatest downstream effect.

## The theme: Model the organization without oversimplifying it

A useful operational model must be structured enough for automation but flexible enough to reflect how people actually work.

I focused on separating durable organizational objects from the changing relationships between them. A team, application, data product, request, or policy can exist as a resource. Ownership, dependency, risk, readiness, and delivery become relationships that can evolve over time.

This separation matters because organizational truth is rarely static.

## Field notes from the build

Deterministic systems still need room for uncertainty. An unknown value should remain visibly unknown rather than being silently replaced by an AI-generated assumption.

That principle is becoming a core design boundary:

- AI may propose.
- Evidence must remain visible.
- People approve material changes.
- Every accepted change should preserve provenance.

The objective is not autonomous administration. It is better decision preparation.

## What moved

- Refined the resource-and-capability model.
- Separated durable entities from time-dependent relationships.
- Explored evidence-backed recommendations rather than automatic updates.
- Strengthened the role of human review in AI-assisted workflows.
- Continued shaping an operational knowledge graph around explainable decisions.

## The reusable pattern

Model facts, proposals, and decisions as different object types.

When those concepts are merged, systems become difficult to audit. When they remain separate, automation can accelerate analysis without obscuring accountability.

## Future state

A continuously updated operational model could detect emerging dependencies, propose routing changes, and explain the evidence behind each recommendation.

The system would not merely describe the organization. It would help the organization understand itself.

## Standing takeaways

- Unknown is a valid and important state.
- A recommendation is not the same as a decision.
- Organizational intelligence depends on relationships, not isolated records.
- Automation should shorten the path to judgment, not remove judgment.

## Open thread

The next challenge is defining how confidence, provenance, and approval should travel with a relationship as it changes over time.

**Filed under:** #knowledgegraph #decisionintelligence #automation #explainableai #systemsdesign

**Projects:** [[operational-intelligence]] [[knowledge-graph]] [[human-in-the-loop]] [[decision-traceability]]

*The Daily · 9/21/2026*

**Projects:** [[decision-intelligence]] [[knowledgegraph]] [[decisionintelligence]] [[automation]] [[explainableai]] [[systemsdesign]]

---
_The Daily · 9/28/2026, 10:31:40 PM_
