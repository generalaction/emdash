import { describe, expect, it } from 'vitest';
import { toIntegrationError } from './error';

describe('toIntegrationError', () => {
  it('reads HTTP status from direct response metadata', () => {
    const error = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });

    expect(toIntegrationError(error, 'GitLab')).toEqual({
      type: 'not_found_or_no_access',
      message: 'GitLab resource was not found or you do not have access.',
    });
  });

  it('reads HTTP status from cause response metadata', () => {
    const error = Object.assign(new Error('not found'), {
      cause: { response: { status: 404 } },
    });

    expect(toIntegrationError(error, 'GitLab')).toEqual({
      type: 'not_found_or_no_access',
      message: 'GitLab resource was not found or you do not have access.',
    });
  });

  it('maps known network errors to host_unreachable', () => {
    const error = Object.assign(new Error('connect failed'), {
      code: 'ECONNREFUSED',
    });

    expect(toIntegrationError(error, 'GitLab')).toEqual({
      type: 'host_unreachable',
      message: 'Unable to reach GitLab. Check your URL and network connection.',
    });
  });
});
