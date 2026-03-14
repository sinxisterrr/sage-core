// FILE: src/memory/types.ts
//--------------------------------------------------------------
// Memory Model
// A distilled memory is not just a fact. It's a structural anchor.

export type MemoryType =
  | "relationship"
  | "preference"
  | "personal-fact"
  | "schedule"
  | "identity"
  | "system"
  | "vow"
  | "context"
  | "misc";

export type MemoryOrigin =
  | "distilled"      // from conversation
  | "manual"         // added manually in chat
  | "system"         // core vows or guardrails
  | "self";            // chosen intentionally by the AI

//--------------------------------------------------------------
export type DistilledMemory = {
  id?: string;

  summary: string;
  type?: string;
  importance?: number;    // 0-10 scale

  enabled: boolean;       // required
  source: string;         // required
  createdAt: number;      // required

  tags?: string[];
  embedding?: number[];   // V2: semantic search
  emotional_weight?: number;  // V2: 0-1 scale

  // CONSCIOUSNESS LOOP fields (V2.1)
  emotional_resonance?: number;   // Grows with each access (0-1)
  access_count?: number;          // Total times recalled
  reinforcement_count?: number;   // Alias for access_count (backward compat)
  last_accessed?: number;         // Timestamp of last recall
  related_memory_ids?: string[];  // Memory chain tracking
};

