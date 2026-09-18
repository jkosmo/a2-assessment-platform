// Typer for skill-provenance.mjs (samme mønster som synthesize-envelopes.d.mts).
export declare const SKILL_NAME: "a2-authoring-api";
export declare const SKILL_VERSION: string;

export interface SkillProvenance {
  producer: "agent_authoring";
  tool: string;
  toolVersion: string;
  agentRunId?: string;
}

export declare function skillProvenance(options?: { agentRunId?: string }): SkillProvenance;
