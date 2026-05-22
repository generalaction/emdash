import * as z from 'zod';

const manualHostPattern = /^[a-zA-Z0-9._\-[\]:]+$/;
const sshAliasPattern = /^[A-Za-z0-9._@%+:/[\]-]+$/;

export const sshConnectionFormSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    host: z.string().min(1, 'Host is required'),
    port: z
      .number()
      .int()
      .min(1, 'Port must be at least 1')
      .max(65535, 'Port must be at most 65535'),
    username: z.string(),
    authType: z.enum(['password', 'key', 'agent']),
    password: z.string(),
    privateKeyPath: z.string(),
    passphrase: z.string(),
    sshConfigAlias: z.string(),
    forwardAgent: z.boolean(),
    proxyJump: z.string(),
    proxyCommand: z.string(),
    isEditing: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.sshConfigAlias) {
      if (val.sshConfigAlias.startsWith('-') || !sshAliasPattern.test(val.sshConfigAlias)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid SSH config alias',
          path: ['sshConfigAlias'],
        });
      }
    } else if (!manualHostPattern.test(val.host)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid hostname or IP address',
        path: ['host'],
      });
    }
    if (!val.sshConfigAlias && !val.username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Username is required',
        path: ['username'],
      });
    }
    if (val.authType === 'password' && !val.password && !val.isEditing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password is required',
        path: ['password'],
      });
    }
    if (val.authType === 'key' && !val.sshConfigAlias && !val.privateKeyPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Private key path is required',
        path: ['privateKeyPath'],
      });
    }
  });

export type SshConnectionFormValues = z.infer<typeof sshConnectionFormSchema>;
