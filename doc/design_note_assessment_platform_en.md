# Design Note: Internal Assessment Application for Certification

## 1. Solution Summary

This design note describes a feasible minimum solution for an internal assessment application that supports certification in generative AI, while also being generic enough to support other competency and certification tracks later.

The solution should be low-friction, standardized, traceable, and easy to operate. It should not be built as a heavy LMS. Instead, the recommended approach is a lightweight internal web application with enterprise login, simple administration, a module-based assessment flow, automatic MCQ scoring, LLM-based assessment of practical submissions, reporting, and support for appeals and manual override.

The core of the solution is standardization:
- the same module structure across modules
- the same submission format
- the same core rubric
- the same scoring model
- the same evaluation contract with the LLM
- the same decision logic for pass, red flags, and manual review

The goal is that manual grading should be the exception, not the primary operating model.

## 2. Functional Requirements

### 2.1 Participant Features
The solution must support:
- login with the company account
- display of available modules and status per module
- module selection
- document upload or pasted submission text
- a dedicated reflection field
- a dedicated prompt excerpt field
- MCQ test execution per module
- submission of the full response
- result display with rationale
- an appeal button with a rationale field
- history of the participant's own attempts, results, and status

### 2.2 Assessment Features
The solution must support:
- automatic validation of required fields
- automatic MCQ scoring
- automatic LLM-based assessment of the practical part
- aggregation of MCQ and practical scores into a total score
- explicit handling of red flags
- recommendation of manual review in case of uncertainty or red flags
- manual override in borderline cases and appeals

### 2.3 Administration Features
The solution must support:
- administration of participants and roles
- administration of modules
- administration of module versions
- maintenance of the MCQ bank
- maintenance of rubrics
- maintenance of the prompt bank and example anchors
- publication of new versions
- handling of manual reviews and appeals
- export and basic reporting

### 2.4 Reporting Module
The reporting module shall provide visibility into:
- who has completed which modules
- who has completed which tests
- who has passed which modules
- who has open appeals
- who is in the manual review queue
- pass rate per module
- progress by participant, department, or professional area
- who is approaching recertification or has an expired status

The reporting module should support filtering by module, status, time period, and organizational unit, as well as export to CSV or Excel.

## 3. Non-Functional Requirements

The solution should be:
- easy to operate with few moving parts
- easy to understand and use for busy consultants
- secure enough for internal use
- traceable enough to withstand appeals and audits
- configurable without code changes for frequently updated content
- versioned so that the basis for every assessment can always be traced
- fast enough to provide responses without unnecessary waiting
- inexpensive and realistic to maintain using standard enterprise tools

### Quality Targets
- login to active module in under 30 seconds
- immediate MCQ score upon submission
- LLM-based assessment of the practical part normally under 2 minutes
- full traceability for all assessment decisions
- no assessments without references to module version, rubric version, and prompt version

## 4. Target Architecture

The solution is recommended as a simple three-layer architecture:

### 4.1 Presentation Layer
Internal web application with:
- participant interface
- admin interface
- review interface
- reporting interface

### 4.2 Application Layer
Backend/API responsible for:
- authentication and authorization
- module and content management
- submission and storage
- MCQ scoring
- LLM assessment
- decision logic
- appeal handling
- reporting

### 4.3 Data Layer and Integrations
- relational database for metadata, attempts, results, and traceability
- object storage for files and artifacts
- LLM platform for practical assessment
- centralized logging and audit

### 4.4 Main Flow
1. The user logs in with the company account
2. The user selects a module
3. The user submits the practical part and completes the MCQ
4. The backend stores the submission and starts assessment
5. The MCQ is scored deterministically
6. The practical part is evaluated by an LLM using a fixed prompt and JSON schema
7. The backend validates the JSON and calculates the score
8. A decision is created automatically or routed to manual review
9. The result is displayed in the participant interface
10. Data is aggregated into the reporting module

## 5. Component Description

### 5.1 Participant Portal
Responsibilities:
- module overview
- submission
- MCQ execution
- result display
- appeal
- history

### 5.2 Admin Portal
Responsibilities:
- maintenance of participants and roles
- maintenance of modules and versions
- administration of the MCQ bank, rubric, and prompt bank
- publication of content
- access to reports

### 5.3 Content Manager
Responsibilities:
- storage of module text, assignments, guidance, MCQ sets, rubrics, and prompt templates
- versioning
- publication of the active version

### 5.4 Submission Service
Responsibilities:
- intake of text or file
- linkage between submission, module, user, and active version
- normalization of text input for assessment

### 5.5 MCQ Engine
Responsibilities:
- delivery of questions
- deterministic scoring
- storage of responses
- scaling to a 0-30 score

### 5.6 LLM Assessment Engine
Responsibilities:
- assembly of input for the evaluation prompt
- use of module-specific example anchors
- enforcement of a strict JSON response
- validation of response format
- production of rubric scores, rationales, and red flags

### 5.7 Decision Engine
Responsibilities:
- calculation of the total score
- pass/fail logic
- red flag checks
- automatic or manual routing of cases

### 5.8 Manual Review Module
Responsibilities:
- display of submission, MCQ result, LLM response, and log
- handling of appeals and manual review cases
- registration of override decisions and rationale

### 5.9 Reporting Module
Responsibilities:
- views of status, completion, and pass rate
- filtering by module, user group, and time period
- export of reports
- support for management, subject matter owners, and administrators

### 5.10 Audit and Logging Module
Responsibilities:
- traceability for all key events
- audit basis
- support for troubleshooting and control

## 6. Data Model

### 6.1 User
- user_id
- name
- email
- department
- manager
- active_status

### 6.2 RoleAssignment
- role_assignment_id
- user_id
- app_role
- valid_from
- valid_to

### 6.3 Module
- module_id
- title
- description
- certification_level
- active_version_id
- valid_from
- valid_to

### 6.4 ModuleVersion
- module_version_id
- module_id
- version_no
- task_text
- guidance_text
- rubric_version_id
- prompt_template_version_id
- mcq_set_version_id
- published_by
- published_at

### 6.5 Submission
- submission_id
- user_id
- module_id
- module_version_id
- delivery_type
- raw_text
- reflection_text
- prompt_excerpt
- attachment_uri
- submitted_at
- submission_status

### 6.6 MCQAttempt
- mcq_attempt_id
- submission_id
- mcq_set_version_id
- started_at
- completed_at
- raw_score
- scaled_score
- percent_score
- pass_fail_mcq

### 6.7 MCQQuestion
- question_id
- mcq_set_version_id
- module_id
- stem
- options_json
- correct_answer
- rationale
- active

### 6.8 MCQResponse
- mcq_response_id
- mcq_attempt_id
- question_id
- selected_answer
- is_correct

### 6.9 RubricVersion
- rubric_version_id
- version_no
- criteria_json
- scaling_rule_json
- pass_rule_json
- active

### 6.10 PromptTemplateVersion
- prompt_template_version_id
- version_no
- system_prompt
- user_prompt_template
- examples_json
- active

### 6.11 LLMEvaluation
- llm_evaluation_id
- submission_id
- model_name
- prompt_template_version_id
- request_payload_hash
- response_json
- rubric_total
- practical_score_scaled
- pass_fail_practical
- manual_review_recommended
- confidence_note
- evaluated_at

### 6.12 AssessmentDecision
- decision_id
- submission_id
- mcq_scaled_score
- practical_scaled_score
- total_score
- red_flags_json
- pass_fail_total
- decision_type
- decision_reason
- finalised_at
- finalised_by

### 6.13 Appeal
- appeal_id
- submission_id
- appealed_by
- appeal_reason
- appeal_status
- created_at
- resolved_at
- resolved_by
- resolution_note

### 6.14 ManualReview
- review_id
- submission_id
- trigger_reason
- reviewer_id
- review_status
- reviewed_at
- override_decision
- override_reason

### 6.15 CertificationStatus
- certification_id
- user_id
- module_id
- latest_decision_id
- status
- passed_at
- expiry_date
- recertification_due_date

### 6.16 AuditEvent
- event_id
- entity_type
- entity_id
- action
- actor_id
- timestamp
- payload_hash
- metadata_json

## 7. API Endpoints

### 7.1 Authentication and User
- GET /api/me
- GET /api/me/modules
- GET /api/me/results
- GET /api/me/certifications

### 7.2 Modules and Content
- GET /api/modules
- GET /api/modules/{moduleId}
- GET /api/modules/{moduleId}/active-version
- GET /api/modules/{moduleId}/mcq/start
- POST /api/modules/{moduleId}/mcq/submit

### 7.3 Submission
- POST /api/submissions
- GET /api/submissions/{submissionId}
- GET /api/submissions/{submissionId}/result
- POST /api/submissions/{submissionId}/appeals

### 7.4 Assessment
- POST /api/assessments/{submissionId}/run
- GET /api/assessments/{submissionId}
- GET /api/assessments/{submissionId}/audit

### 7.5 Admin
- GET /api/admin/users
- GET /api/admin/modules
- POST /api/admin/modules
- POST /api/admin/modules/{moduleId}/versions
- POST /api/admin/mcq-sets
- POST /api/admin/rubrics
- POST /api/admin/prompt-templates
- POST /api/admin/publish/module-version

### 7.6 Manual Review
- GET /api/admin/manual-reviews
- GET /api/admin/manual-reviews/{reviewId}
- POST /api/admin/manual-reviews/{reviewId}/decision

### 7.7 Appeals
- GET /api/admin/appeals
- GET /api/admin/appeals/{appealId}
- POST /api/admin/appeals/{appealId}/resolve

### 7.8 Reporting
- GET /api/admin/reports/completion
- GET /api/admin/reports/pass-rates
- GET /api/admin/reports/certification-status
- GET /api/admin/reports/manual-review-queue
- GET /api/admin/reports/appeals
- GET /api/admin/reports/recertification-due
- GET /api/admin/reports/export?type=completion&format=csv

## 8. Assessment Engine and JSON Schema

### 8.1 Standard Rubric
Five criteria, each scored from 0 to 4:
1. relevance_for_case
2. quality_and_utility
3. iteration_and_improvement
4. human_quality_assurance
5. responsible_use

### 8.2 Scoring Model
- rubric_total = sum of the five criteria, 0 to 20
- practical_score_scaled = rubric_total / 20 * 70
- mcq_score_scaled = MCQ score scaled to 0 to 30
- total_score = practical_score_scaled + mcq_score_scaled

### 8.3 Passing Rules
Passing a module requires:
- at least 70 total points
- at least 50 percent on the practical part
- at least 60 percent on the MCQ
- no open red flags

### 8.4 Rules for the Practical Part
The assessment engine shall evaluate:
- whether the submission answers the module task
- whether AI is used for structuring, improvement, or analysis, not only raw text generation
- whether the participant shows iteration
- whether the participant describes what needed manual quality assurance
- whether the submission is relevant, precise, and professional
- whether there are signs of irresponsible use

### 8.5 Principles for LLM Integration
- use a fixed evaluation prompt
- use temperature near zero
- use a strict JSON schema
- use the same weights and definitions across modules
- support module-specific example anchors
- identify red flags explicitly
- recommend manual review when needed

### 8.6 Proposed JSON Format from the LLM
```json
{
  "module_id": "module_1",
  "rubric_scores": {
    "relevance_for_case": 0,
    "quality_and_utility": 0,
    "iteration_and_improvement": 0,
    "human_quality_assurance": 0,
    "responsible_use": 0
  },
  "rubric_total": 0,
  "practical_score_scaled": 0,
  "pass_fail_practical": false,
  "criterion_rationales": {
    "relevance_for_case": "Brief rationale",
    "quality_and_utility": "Brief rationale",
    "iteration_and_improvement": "Brief rationale",
    "human_quality_assurance": "Brief rationale",
    "responsible_use": "Brief rationale"
  },
  "improvement_advice": [
    "Concrete improvement advice 1",
    "Concrete improvement advice 2",
    "Concrete improvement advice 3"
  ],
  "red_flags": [
    {
      "code": "UNSAFE_DATA_HANDLING",
      "severity": "high",
      "description": "Possible irresponsible handling of sensitive information"
    }
  ],
  "manual_review_recommended": false,
  "confidence_note": "High confidence because the submission is clear and well justified."
}
```

### 8.7 Important Boundary
The LLM must not calculate the final total score or final module decision. That must be done by the backend. The LLM should provide structured assessment input, not act as the final case handler.

## 9. Flow for Submission, Scoring, Results, and Appeals

### 9.1 Submission Flow
1. The user selects a module
2. The system displays the active module version
3. The user pastes text or uploads a file
4. The user fills in reflection and prompt excerpt
5. The user completes the MCQ
6. The user submits

### 9.2 Scoring Flow
1. The submission is stored
2. The MCQ is scored immediately
3. The practical part is sent to the assessment engine
4. The LLM returns JSON
5. The backend validates the JSON
6. The backend calculates scaled scores and total_score
7. The backend evaluates red flags and thresholds
8. An AssessmentDecision is created

### 9.3 Result Flow
- In a green outcome, the result is displayed directly
- If there is a red flag or recommended manual review, the status is shown as under review
- The user sees score, rationale, improvement advice, and status

### 9.4 Appeal Flow
1. The user clicks appeal
2. The user writes a rationale
3. The case is placed in the appeal queue
4. The appeal handler sees the original submission, MCQ, LLM JSON, log, and decision
5. The appeal handler confirms or overrides the decision
6. The final decision is logged with rationale

### 9.5 Manual Review
- triggered automatically for red flags or uncertainty
- can also be triggered by an appeal
- the original assessment remains in history
- the override creates a new decision layer with traceable rationale

## 10. Security and Privacy

### 10.1 Authentication and Access Control
- login with Entra ID or equivalent enterprise account
- RBAC with roles such as participant, subject matter owner, administrator, appeal handler, and report reader
- least privilege as a principle

### 10.2 Data Minimization
- store only data needed for assessment, status, and traceability
- limit personal data to identity, role, and required case information

### 10.3 Handling of Sensitive Information
- clear instruction not to upload sensitive client information without an approved model environment
- consider a simple acknowledgement check in the MVP submission flow
- consider masking and detection of sensitive text in phase 2

### 10.4 Traceability
The solution shall log:
- which module version was used
- which rubric version was used
- which prompt version was used
- which model was used
- time of assessment
- all manual interventions
- all appeals and decisions

### 10.5 Retention and Audit
- assessments and submission history are stored for a defined period, for example 24 months
- aggregated certification status may be stored longer based on enterprise needs
- appeal cases are retained in line with internal case handling rules

## 11. Operating Model and Roles

### 11.1 Subject Matter Owner
Responsibilities:
- professional quality of modules, rubrics, and example anchors
- approval of content versions
- periodic calibration of the assessment model

### 11.2 Administrator
Responsibilities:
- users and roles
- publication of modules
- follow-up of status and reporting
- basic user support

### 11.3 Appeal Handler and Reviewer
Responsibilities:
- handling of appeals
- handling of manual review cases
- final decisions in borderline cases

### 11.4 Technical Custodian
Responsibilities:
- operation of the web app, backend, database, and integrations
- monitoring, defect handling, and cost control

### 11.5 Manager or Report Reader
Responsibilities:
- follow-up of progress and pass rate
- use of the reporting module for steering and planning

### 11.6 Operating Principles
- small content changes are made as configuration
- larger changes are published as new versions
- annual review of modules, MCQs, rubrics, and prompt bank
- quarterly review of red flags, appeals, and deviation patterns

## 12. MVP Scope

### 12.1 The MVP Shall Include
- enterprise login
- module overview
- shared submission interface for all modules
- reflection field
- prompt excerpt field
- MCQ engine
- LLM assessment with fixed prompt and JSON schema
- result display
- appeal button
- manual review interface
- simple admin interface
- reporting module with status, completion, pass/fail, manual queue, and appeals

### 12.2 The MVP Shall Not Include
- heavy LMS functionality
- learning paths and course catalog
- SCORM or similar packaging standards
- adaptive testing
- advanced workflow engine
- extensive HR integrations
- audio and video assessment

## 13. Phase 2 Proposals

Phase 2 may extend the solution with:
- recertification engine with notifications
- integration with an HR system or LMS for employee sync
- advanced reporting and dashboards
- Power BI or equivalent reporting layer
- anonymization or masking of sensitive text
- improved document parser for PDF and DOCX
- double LLM assessment at low confidence
- analysis of MCQ quality and difficulty
- calibration interface for subject matter owners
- benchmark examples per module

## 14. Risks and Mitigations

### Risk 1: LLM assessment is perceived as arbitrary
Mitigations:
- fixed prompt
- temperature near zero
- strict JSON schema
- versioned rubrics
- example anchors
- manual review in gray zones

### Risk 2: Too much manual grading
Mitigations:
- clear thresholds for manual review
- better example anchors
- calibration per module
- reporting on the share of manual cases

### Risk 3: Low user adoption
Mitigations:
- few fields
- simple flow
- the same structure in all modules
- fast result display

### Risk 4: Content becomes outdated
Mitigations:
- versioned content model
- annual review
- clear ownership of subject matter content

### Risk 5: Participants submit generic AI text without real reflection
Mitigations:
- rubric that rewards iteration
- requirement for reflection and quality assurance
- criteria for responsible use

### Risk 6: Sensitive information ends up in the wrong model environment
Mitigations:
- clear policy
- closed model environment where required
- submission text with user responsibility acknowledgement
- red flags for potentially irresponsible use

### Risk 7: Reporting needs are discovered too late
Mitigations:
- build the reporting module and status model into the MVP
- store data so reporting can be built without redesigning core data

## 15. Recommended Technology Stack

### Frontend
- React or Next.js
- TypeScript
- simple and maintainable component library

### Backend
- .NET 8 Web API or Node.js with NestJS
- choose the platform the organization can already operate

### Database
- Azure SQL or PostgreSQL

### File Storage
- Azure Blob Storage or equivalent object storage

### Authentication
- Microsoft Entra ID

### LLM Platform
- Azure OpenAI or another enterprise-approved platform

### Job and Queue Handling
- simple job table in the MVP or Azure Queue / Service Bus

### Logging and Monitoring
- Application Insights / Azure Monitor
- audit tables in the database

### Reporting
- built-in reporting view in the MVP
- optionally Power BI in phase 2

## 16. What Should Be Configuration Rather Than Code

### Configuration
- module texts
- assignment descriptions
- MCQ bank
- rubric definitions
- prompt templates
- example anchors
- thresholds for manual review
- recertification rules

### Code
- authentication and authorization
- scoring algorithms
- APIs
- JSON validation
- workflow for appeals and overrides
- audit log
- reporting aggregation

## 17. Recommendation

Build the solution as an internal web application with enterprise login, a simple backend, a relational database, object storage, and a controlled LLM integration. Do not use a heavy LMS if the practical need is assessment, reporting, and certification status.

The solution should be generic enough to support several competency tracks, while the first implementation can be optimized for generative AI certification. The reporting module should be part of the MVP from day one, because it is required for governance, follow-up, and credible certification management.
