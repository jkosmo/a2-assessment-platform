# Generic Certification Platform Design

## Context

The A2 Assessment Platform was originally designed for certification of
Generative AI usage skills. The current implementation reflects this
through specific submission fields such as:

-   rawText
-   reflectionText
-   promptExcerpt
-   responsibilityAcknowledged

This limits the platform to a specific assessment format.

The goal of this design is to generalize the platform so it can support
certification in any domain.

Examples include:

-   AI literacy
-   Architecture competence
-   Consulting methodology
-   Compliance and governance
-   Technical skill certification

The core workflows of the system already support this goal. These
include:

-   module-based assessment
-   structured LLM evaluation
-   manual review workflows
-   appeal handling
-   immutable decision lineage
-   audit trail and reporting

This design focuses on generalizing the submission model and assessment
configuration.

------------------------------------------------------------------------

# Design Goals

1.  Support certification in **any domain**
2.  Keep the **existing workflows unchanged**
3.  Preserve **LLM as structured evaluation input**
4.  Make **assessment configuration module-driven**
5.  Minimize architectural disruption

------------------------------------------------------------------------

# Current Limitations

The current submission model is AI-specific.

Submission includes:

-   rawText
-   reflectionText
-   promptExcerpt

This assumes the certification format used in the original AI module.

The assessment criteria also reflect AI-specific concepts such as:

-   iteration and improvement
-   responsible use
-   human quality assurance

These assumptions must be removed.

------------------------------------------------------------------------

# Proposed Domain Model

## Submission

Replace the current text fields with a generic structured response.

Old model:

rawText reflectionText promptExcerpt

New model:

responseJson attachmentsJson

Example response:

{ "case_analysis": "...", "solution_proposal": "...", "risk_assessment":
"..." }

The system does not interpret the structure. The module configuration
defines the schema.

------------------------------------------------------------------------

## Submission Schema

Add a new field to `ModuleVersion`:

submissionSchemaJson

Example:

{ "fields": \[ { "id": "analysis", "label": "Case analysis", "type":
"textarea", "required": true }, { "id": "solution", "label": "Proposed
solution", "type": "textarea", "required": true } \] }

Participant UI renders the form dynamically from this schema.

------------------------------------------------------------------------

## Rubric

Rubrics should define explicit criteria.

Example:

{ "criteria": \[ { "id": "problem_understanding", "weight": 0.3 }, {
"id": "solution_quality", "weight": 0.4 }, { "id": "risk_awareness",
"weight": 0.3 } \] }

Criteria semantics become module-specific.

------------------------------------------------------------------------

## Assessment Policy

Assessment rules move to the module level.

New field:

assessmentPolicyJson

Example:

{ "scoring": { "practicalWeight": 70, "mcqWeight": 30 }, "passRules": {
"totalMin": 70 }, "manualReview": { "borderlineWindow": \[67, 73\] } }

------------------------------------------------------------------------

# LLM Evaluation Model

The LLM evaluates:

Submission\
against\
Rubric

The LLM must return structured output.

Example:

{ "criteria_scores": {}, "criterion_rationales": {}, "flags": \[\],
"manual_review_recommended": false }

The backend decision engine remains the authority.

------------------------------------------------------------------------

# Impacted Components

The following components must change:

### Data model

-   Submission
-   ModuleVersion

### Assessment service

-   prompt construction
-   response parsing

### Participant UI

-   dynamic form rendering

### Admin workspace

-   submission schema editor
-   rubric editor
-   policy configuration

------------------------------------------------------------------------

# Components that remain unchanged

The following parts of the architecture remain valid:

-   assessment job processing
-   manual review workflow
-   appeal workflow
-   immutable decision lineage
-   audit pipeline
-   reporting and analytics

------------------------------------------------------------------------

# Migration Strategy

Since the system is not yet in production, no backward compatibility is
required.

The legacy submission fields can be removed.

------------------------------------------------------------------------

# Summary

The platform becomes a **generic certification engine** where each
module defines:

-   submission schema
-   rubric
-   assessment policy
-   prompt template
-   MCQ set
-   benchmark examples

This allows certification in any domain while preserving the existing
workflow architecture.
