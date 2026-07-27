import { z } from 'zod';
import { InquiryStatus } from '../../shared/enums';

// ── Send inquiry ──────────────────────────────────────────────

export const sendInquirySchema = z.object({
  propertyId: z
    .string({ required_error: 'Property ID is required' })
    .uuid('Invalid property ID'),

  message: z
    .string({ required_error: 'Message is required' })
    .trim()
    // Min 20 chars — prevents single-word spam like "interested"
    .min(20,   'Message must be at least 20 characters')
    // Max 1000 chars — prevents wall-of-text abuse
    .max(1000, 'Message must be at most 1000 characters')
    // Block messages that are entirely uppercase (shouting / spam signal)
    .refine(
      (msg) => msg !== msg.toUpperCase() || msg.length < 5,
      'Message cannot be entirely uppercase'
    )
    // Block messages with excessive repeated characters (aaaaaaa...)
    .refine(
      (msg) => !/(.)\1{9,}/.test(msg),
      'Message contains too many repeated characters'
    ),
});

// ── Update inquiry status (owner action) ──────────────────────

export const updateInquiryStatusSchema = z.object({
  status: z.enum(
    Object.values(InquiryStatus) as [string, ...string[]],
    { errorMap: () => ({ message: `Status must be one of: ${Object.values(InquiryStatus).join(', ')}` }) }
  ),
});

// ── Inbox / sent-box query params ─────────────────────────────

export const inquiryListSchema = z.object({
  cursor: z.string().optional(),
  limit:  z.string().default('20').transform(Number).pipe(z.number().int().min(1).max(50)),
  status: z
    .enum(Object.values(InquiryStatus) as [string, ...string[]])
    .optional(),
});

// ── UUID param ────────────────────────────────────────────────

export const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid inquiry ID'),
});

// ── Inferred types ────────────────────────────────────────────

export type SendInquiryInput        = z.infer<typeof sendInquirySchema>;
export type UpdateInquiryStatusInput = z.infer<typeof updateInquiryStatusSchema>;
export type InquiryListQuery        = z.infer<typeof inquiryListSchema>;