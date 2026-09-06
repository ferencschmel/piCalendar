import { z } from 'zod';

export const personInputSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().email().optional().or(z.literal('')),
  color: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    .default('#6c757d'),
  /** Inactive people are kept for history but never shown on the dashboard. */
  active: z.boolean().default(true),
});
export type PersonInput = z.infer<typeof personInputSchema>;

export const personUpdateSchema = personInputSchema.partial();
export type PersonUpdate = z.infer<typeof personUpdateSchema>;

export interface Person {
  id: string;
  displayName: string;
  email: string | null;
  color: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
