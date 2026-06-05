import { z } from "zod";

export const createStepSchema = z.object({
  orchestration_id: z.string().min(1, "Orchestration ID is required"),
  sequence: z.number().int().min(1, "Sequence must be at least 1"),
  initial_enabled: z.boolean().default(false),
  initial_run_type: z.enum(["NOW", "SCHEDULED"]).default("NOW"),
  initial_schedule_time: z
    .string()
    .regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .optional()
    .nullable(),
  hourly_interval: z.number().int().min(1).max(23).optional().nullable(),
  daily_interval: z.number().int().min(1).max(100).optional().nullable(),
  daily_time: z
    .string()
    .regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .optional()
    .nullable(),
  skip_step_ids: z.array(z.string()).optional(),
});

export const updateStepSchema = createStepSchema.partial().extend({
  sequence: z.number().int().min(1).optional(),
});

export type CreateStepInput = z.infer<typeof createStepSchema>;
export type UpdateStepInput = z.infer<typeof updateStepSchema>;
