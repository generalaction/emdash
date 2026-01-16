interface ErrorContext {
  // Component/UI context
  component?: string;
  action?: string;

  // User interaction context
  user_action?: string;

  // Operation context
  operation?: string;
  endpoint?: string;

  // Error classification
  error_type?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';

  // Task/Project context
  task_id?: string;
  project_id?: string;
  provider?: string;

  // Additional debugging info
  [key: string]: any;
}

class RendererErrorTracking {
  private sessionErrors: number = 0;
  private lastErrorTimestamp: number = 0;

  /**
   * Capture an exception in the renderer process
   */
  captureException(error: Error | unknown, context?: ErrorContext): void {
    try {
      // Rate limiting
      const now = Date.now();
      if (now - this.lastErrorTimestamp < 100) {
        return; // Skip if error happened within 100ms
      }
      this.lastErrorTimestamp = now;
      this.sessionErrors++;

      // Build error object
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const errorMessage = errorObj.message || 'Unknown error';
      const errorStack = errorObj.stack || '';

      // Determine severity if not provided
      const severity = context?.severity || this.determineSeverity(errorMessage, context);

      // Build error properties following PostHog's $exception format
      const properties: Record<string, any> = {
        // PostHog required fields for error tracking
        $exception_message: errorMessage.slice(0, 500),
        $exception_type: context?.error_type || this.classifyError(errorMessage),
        $exception_stack_trace_raw: errorStack.slice(0, 2000),
        $exception_fingerprint: `${context?.component || 'renderer'}_${context?.operation || context?.action || 'unknown'}_${this.classifyError(errorMessage)}`,

        // Additional context
        severity,

        // Component/UI context
        component: context?.component || 'renderer',
        action: context?.action,
        user_action: context?.user_action,

        // Operation context
        operation: context?.operation,
        endpoint: context?.endpoint,

        // Task/Project context
        task_id: context?.task_id,
        project_id: context?.project_id,
        provider: context?.provider,

        // Session info
        session_errors: this.sessionErrors,
        error_timestamp: new Date().toISOString(),

        // Browser info
        user_agent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,

        // Additional custom context
        ...this.sanitizeContext(context),
      };

      // Filter out undefined/null values
      const cleanProperties = Object.fromEntries(
        Object.entries(properties).filter(([_, v]) => v !== undefined && v !== null)
      );

      // Send to main process as $exception event (required for PostHog error tracking)
      this.sendToMainProcess('$exception', cleanProperties);

      // Also log to console for debugging
      console.error('[ErrorTracking]', errorMessage, {
        severity,
        component: context?.component,
        action: context?.action,
      });
    } catch (trackingError) {
      // Never let error tracking crash the renderer
      console.warn('Failed to capture exception:', trackingError);
    }
  }

  /**
   * Capture a critical error that might affect app stability
   */
  captureCriticalError(error: Error | unknown, context?: ErrorContext): void {
    this.captureException(error, {
      ...context,
      severity: 'critical',
    });
  }

  /**
   * Track API/network errors
   */
  captureApiError(
    error: Error | unknown,
    endpoint: string,
    operation: string,
    additionalContext?: Partial<ErrorContext>
  ): void {
    this.captureException(error, {
      error_type: 'api_error',
      severity: 'medium',
      endpoint,
      operation,
      ...additionalContext,
    });
  }

  /**
   * Track component render errors
   */
  captureComponentError(
    error: Error | unknown,
    componentName: string,
    additionalContext?: Partial<ErrorContext>
  ): void {
    this.captureException(error, {
      error_type: 'render_error',
      severity: 'high',
      component: componentName,
      ...additionalContext,
    });
  }

  /**
   * Track user action errors
   */
  captureUserActionError(
    error: Error | unknown,
    action: string,
    additionalContext?: Partial<ErrorContext>
  ): void {
    this.captureException(error, {
      error_type: 'user_action_error',
      severity: 'medium',
      user_action: action,
      ...additionalContext,
    });
  }

  // Private helper methods

  private sendToMainProcess(event: string, properties: Record<string, any>): void {
    try {
      const api = (window as any).electronAPI;
      if (api?.captureTelemetry) {
        void api.captureTelemetry(event, properties);
      }
    } catch {
      // Silent fail - telemetry might not be available
    }
  }

  private determineSeverity(
    errorMessage: string,
    context?: ErrorContext
  ): ErrorContext['severity'] {
    // Critical errors
    if (
      errorMessage.includes('FATAL') ||
      errorMessage.includes('CRASH') ||
      errorMessage.includes('Maximum update depth exceeded') ||
      context?.error_type === 'render_error'
    ) {
      return 'critical';
    }

    // High severity
    if (
      errorMessage.includes('Cannot read') ||
      errorMessage.includes('Cannot access') ||
      errorMessage.includes('is not defined') ||
      errorMessage.includes('Network request failed')
    ) {
      return 'high';
    }

    // Low severity
    if (
      errorMessage.includes('canceled') ||
      errorMessage.includes('aborted') ||
      errorMessage.includes('ResizeObserver')
    ) {
      return 'low';
    }

    return 'medium';
  }

  private classifyError(errorMessage: string): string {
    if (
      errorMessage.includes('fetch') ||
      errorMessage.includes('network') ||
      errorMessage.includes('API')
    ) {
      return 'network_error';
    }
    if (
      errorMessage.includes('render') ||
      errorMessage.includes('component') ||
      errorMessage.includes('React')
    ) {
      return 'render_error';
    }
    if (
      errorMessage.includes('TypeError') ||
      errorMessage.includes('undefined') ||
      errorMessage.includes('null')
    ) {
      return 'type_error';
    }
    if (errorMessage.includes('ReferenceError')) {
      return 'reference_error';
    }
    if (errorMessage.includes('SyntaxError')) {
      return 'syntax_error';
    }
    return 'unknown_error';
  }

  private sanitizeContext(context?: ErrorContext): Record<string, any> {
    if (!context) return {};

    const sanitized: Record<string, any> = {};
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];
    const skipKeys = [
      'severity',
      'component',
      'action',
      'user_action',
      'operation',
      'endpoint',
      'error_type',
    ];

    for (const [key, value] of Object.entries(context)) {
      // Skip already processed or sensitive keys
      if (skipKeys.includes(key)) continue;
      if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) continue;

      // Sanitize value
      if (typeof value === 'string') {
        sanitized[key] = value.slice(0, 200);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        sanitized[key] = value;
      } else if (value === null || value === undefined) {
        // Skip null/undefined
      } else {
        // Convert objects to string with limit
        try {
          sanitized[key] = JSON.stringify(value).slice(0, 200);
        } catch {
          // Skip if can't stringify
        }
      }
    }

    return sanitized;
  }
}

// Export singleton instance
export const errorTracking = new RendererErrorTracking();

// Export convenience functions
export function captureException(error: Error | unknown, context?: ErrorContext) {
  errorTracking.captureException(error, context);
}

export function captureApiError(
  error: Error | unknown,
  endpoint: string,
  operation: string,
  context?: Partial<ErrorContext>
) {
  errorTracking.captureApiError(error, endpoint, operation, context);
}

export function captureComponentError(
  error: Error | unknown,
  componentName: string,
  context?: Partial<ErrorContext>
) {
  errorTracking.captureComponentError(error, componentName, context);
}

// Set up global error handlers
if (typeof window !== 'undefined') {
  // Catch unhandled errors
  window.addEventListener('error', (event) => {
    errorTracking.captureException(event.error || new Error(event.message), {
      error_type: 'unhandled_error',
      severity: 'critical',
      component: 'global',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    errorTracking.captureException(event.reason || new Error('Unhandled Promise Rejection'), {
      error_type: 'unhandled_rejection',
      severity: 'high',
      component: 'global',
      promise: event.promise,
    });
  });
}
