import { describe, expect, it } from 'vitest';
import {
  applyLocalDevelopmentCorsRelaxation,
  localDevelopmentCorsRelaxationRequest,
} from './browser-cors-relaxation';

describe('browser CORS relaxation', () => {
  it('detects CORS requests from local development origins', () => {
    expect(
      localDevelopmentCorsRelaxationRequest({
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'authorization, content-type',
      })
    ).toEqual({
      origin: 'http://localhost:5173',
      requestedMethod: 'PUT',
      requestedHeaders: 'authorization, content-type',
    });

    expect(localDevelopmentCorsRelaxationRequest({ Origin: 'https://api.example.com' })).toBeNull();
    expect(localDevelopmentCorsRelaxationRequest({})).toBeNull();
  });

  it('overrides CORS response headers for the local development origin only', () => {
    expect(
      applyLocalDevelopmentCorsRelaxation(
        {
          'access-control-allow-origin': ['https://api.example.com'],
          Vary: ['Accept-Encoding'],
        },
        {
          origin: 'http://localhost:3000',
          requestedMethod: 'PATCH',
          requestedHeaders: 'authorization',
        }
      )
    ).toEqual({
      'Access-Control-Allow-Origin': ['http://localhost:3000'],
      'Access-Control-Allow-Credentials': ['true'],
      'Access-Control-Allow-Methods': ['PATCH'],
      'Access-Control-Allow-Headers': ['authorization'],
      Vary: ['Accept-Encoding, Origin'],
    });
  });
});
