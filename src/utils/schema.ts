import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email({ message: 'Invalid email formatting specified.' }),
    password: z.string().min(8, { message: 'Password must be at least 8 characters long.' }),
    role: z.enum(['USER', 'AGENT']).optional().default('USER'),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string(),
  }),
});
