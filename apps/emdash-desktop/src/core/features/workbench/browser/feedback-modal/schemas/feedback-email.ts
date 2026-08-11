import * as z from 'zod';

export const FEEDBACK_EMAIL_SCHEMA = z.union([
  z.literal(''),
  z.string().email('Please enter a valid email address.'),
]);
