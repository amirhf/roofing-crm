import "server-only";

import { randomBytes } from "node:crypto";

import type { PermitId, PropertyId } from "@/oracle/types";

import { AgentReferenceError } from "./errors";

export type RequestReferenceKind = "property" | "permit" | "evidence";
export type PropertyReference = `property_ref_${string}`;
export type PermitReference = `permit_ref_${string}`;
export type EvidenceReference = `evidence_ref_${string}`;

export interface PermitReferenceTarget {
  readonly permitId: PermitId;
  readonly propertyId: PropertyId;
}

export type RequestReferenceTokenSource = (
  kind: RequestReferenceKind,
  ordinal: number,
) => string;

const REFERENCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;

function randomReferenceToken(): string {
  return randomBytes(18).toString("base64url");
}

function failReference(): never {
  throw new AgentReferenceError();
}

export class RequestReferenceScope {
  private readonly propertyById = new Map<PropertyId, PropertyReference>();
  private readonly propertyByReference = new Map<PropertyReference, PropertyId>();
  private readonly permitById = new Map<PermitId, PermitReference>();
  private readonly permitByReference = new Map<PermitReference, PermitReferenceTarget>();
  private readonly evidenceById = new Map<string, EvidenceReference>();
  private readonly evidenceByReference = new Map<EvidenceReference, string>();
  private readonly usedReferences = new Set<string>();
  private ordinal = 0;

  constructor(
    private readonly tokenSource: RequestReferenceTokenSource = () =>
      randomReferenceToken(),
  ) {}

  registerProperty(propertyId: PropertyId): PropertyReference {
    const existing = this.propertyById.get(propertyId);
    if (existing) return existing;
    const reference = this.createReference("property") as PropertyReference;
    this.propertyById.set(propertyId, reference);
    this.propertyByReference.set(reference, propertyId);
    return reference;
  }

  registerPermit(target: PermitReferenceTarget): PermitReference {
    if (!this.propertyById.has(target.propertyId)) failReference();
    const existing = this.permitById.get(target.permitId);
    if (existing) {
      const registered = this.permitByReference.get(existing);
      if (registered?.propertyId !== target.propertyId) failReference();
      return existing;
    }
    const reference = this.createReference("permit") as PermitReference;
    this.permitById.set(target.permitId, reference);
    this.permitByReference.set(reference, target);
    return reference;
  }

  registerEvidence(evidenceId: string): EvidenceReference {
    const existing = this.evidenceById.get(evidenceId);
    if (existing) return existing;
    const reference = this.createReference("evidence") as EvidenceReference;
    this.evidenceById.set(evidenceId, reference);
    this.evidenceByReference.set(reference, evidenceId);
    return reference;
  }

  propertyReference(propertyId: PropertyId): PropertyReference {
    return this.propertyById.get(propertyId) ?? failReference();
  }

  permitReference(permitId: PermitId): PermitReference {
    return this.permitById.get(permitId) ?? failReference();
  }

  evidenceReference(evidenceId: string): EvidenceReference {
    return this.evidenceById.get(evidenceId) ?? failReference();
  }

  resolveProperty(reference: PropertyReference): PropertyId {
    return this.propertyByReference.get(reference) ?? failReference();
  }

  resolvePermit(reference: PermitReference): PermitReferenceTarget {
    return this.permitByReference.get(reference) ?? failReference();
  }

  resolveEvidence(reference: EvidenceReference): string {
    return this.evidenceByReference.get(reference) ?? failReference();
  }

  private createReference(kind: RequestReferenceKind): string {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const token = this.tokenSource(kind, this.ordinal);
      this.ordinal += 1;
      if (!REFERENCE_TOKEN_PATTERN.test(token)) failReference();
      const reference = `${kind}_ref_${token}`;
      if (!this.usedReferences.has(reference)) {
        this.usedReferences.add(reference);
        return reference;
      }
    }
    failReference();
  }
}
