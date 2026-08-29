import { z } from "zod";

export const AGENT_BOUNDS = Object.freeze({
  maxPromptCharacters: 1_000,
  maxSteps: 6,
  maxToolCalls: 4,
  maxSearchPages: 2,
  maxPageSize: 25,
  maxCursorCharacters: 512,
  requestDeadlineMs: 12_000,
  stepDeadlineMs: 4_000,
  toolDeadlineMs: 3_000,
  maxMcpResponseBytes: 131_072,
  maxTotalMcpResponseBytes: 262_144,
  maxAnswerCharacters: 600,
  maxPropertyIds: 25,
  maxEvidenceReferences: 100,
  maxMissingFields: 100,
});

export type AgentBounds = Readonly<{
  [Key in keyof typeof AGENT_BOUNDS]: number;
}>;

const coordinatesSchema = z
  .object({
    kind: z.literal("coordinates"),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

const placeSchema = z
  .object({
    kind: z.literal("place"),
    text: z.string().min(1).max(200),
  })
  .strict();

const radiusSchema = z
  .object({
    value: z.number().positive(),
    unit: z.enum(["mi", "km"]),
  })
  .strict()
  .superRefine((radius, context) => {
    const maximum = radius.unit === "mi" ? 50 : 80.4672;
    if (radius.value > maximum) {
      context.addIssue({
        code: "too_big",
        maximum,
        origin: "number",
        message: `Radius must not exceed ${maximum} ${radius.unit}.`,
      });
    }
  });

const filtersSchema = z
  .object({
    roofAge: z
      .object({
        operator: z.enum(["gt", "gte"]),
        years: z.number().int().min(0).max(100),
        basis: z.enum(["direct_only", "direct_or_proxy"]),
      })
      .strict()
      .optional(),
    permit: z
      .object({
        roofingOnly: z.boolean().optional(),
        openOnly: z.boolean().optional(),
        minOpenDays: z.number().int().min(0).max(36_500).optional(),
      })
      .strict()
      .optional(),
    ownership: z
      .object({
        operator: z.enum(["gt", "gte"]).optional(),
        years: z.number().int().min(0).max(500).optional(),
        ownerArea: z.enum(["any", "out_of_county", "out_of_state"]).optional(),
      })
      .strict()
      .optional(),
    freshness: z
      .object({
        observedAtOrAfter: z.iso.datetime({ offset: true }).optional(),
        publishedAtOrAfter: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .optional(),
    matchMode: z.enum(["all", "any"]).optional(),
  })
  .strict();

export const agentSearchArgumentsSchema = z
  .object({
    radius: radiusSchema,
    filters: filtersSchema,
    sort: z.enum(["distance_asc", "roof_age_desc", "permit_open_days_desc"]),
    page: z
      .object({
        limit: z.number().int().min(1).max(AGENT_BOUNDS.maxPageSize),
        continuation: z.literal(true).optional(),
      })
      .strict(),
    asOf: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const propertyIdSchema = z.string().regex(/^prop_[a-f0-9]{32}$/);
export const permitIdSchema = z.string().regex(/^perm_[a-f0-9]{32}$/);

export const naturalLanguageQueryRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(AGENT_BOUNDS.maxPromptCharacters),
    searchContext: z
      .object({
        county: z.literal("pasco"),
        center: z.discriminatedUnion("kind", [coordinatesSchema, placeSchema]),
        radius: radiusSchema,
        filters: filtersSchema,
      })
      .strict(),
  })
  .strict();

export const missingFieldSchema = z
  .object({
    propertyId: propertyIdSchema,
    permitId: permitIdSchema.nullable(),
    field: z.string().min(1).max(100),
    reason: z.string().min(1).max(100),
  })
  .strict();

const groundingFailureSchema = z
  .object({
    code: z.enum([
      "no_results",
      "missing_data",
      "unsupported_request",
      "insufficient_grounding",
    ]),
  })
  .strict();

export const agentModelOutputSchema = z
  .object({
    status: z.enum(["grounded", "cannot_ground"]),
    filters: agentSearchArgumentsSchema.nullable(),
    propertyIds: z
      .array(propertyIdSchema)
      .max(AGENT_BOUNDS.maxPropertyIds)
      .refine((values) => new Set(values).size === values.length, {
        message: "Property IDs must be unique.",
      }),
    evidenceRefs: z
      .array(z.string().min(1).max(200))
      .max(AGENT_BOUNDS.maxEvidenceReferences)
      .refine((values) => new Set(values).size === values.length, {
        message: "Evidence references must be unique.",
      }),
    missingFields: z.array(missingFieldSchema).max(AGENT_BOUNDS.maxMissingFields),
    failure: groundingFailureSchema.nullable(),
  })
  .strict()
  .superRefine((output, context) => {
    if (output.status === "grounded" && output.failure !== null) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Grounded output cannot include a failure.",
      });
    }
    if (output.status === "grounded" && output.propertyIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["propertyIds"],
        message: "Grounded output requires at least one retrieved property.",
      });
    }
    if (output.status === "cannot_ground" && output.failure === null) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Ungrounded output must include an explicit failure.",
      });
    }
  });

export const getPropertyArgumentsSchema = z
  .object({ propertyId: propertyIdSchema })
  .strict();
export const getPermitArgumentsSchema = z.object({ permitId: permitIdSchema }).strict();
export const getQuerySchemaArgumentsSchema = z.object({}).strict();

export type NaturalLanguageQueryRequest = z.infer<
  typeof naturalLanguageQueryRequestSchema
>;
export type AgentModelOutput = z.infer<typeof agentModelOutputSchema>;
export type AgentSearchArguments = z.infer<typeof agentSearchArgumentsSchema>;
export type AgentFailureCode = z.infer<typeof groundingFailureSchema>["code"];
export type MissingField = z.infer<typeof missingFieldSchema>;
