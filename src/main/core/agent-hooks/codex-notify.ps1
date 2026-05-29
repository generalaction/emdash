$ErrorActionPreference = 'SilentlyContinue'

if (-not $env:EMDASH_HOOK_PORT -or -not $env:EMDASH_HOOK_TOKEN -or -not $env:EMDASH_PTY_ID) {
  exit 0
}

if ($args.Count -gt 0) {
  $inputPayload = $args[0]
} else {
  $inputPayload = [Console]::In.ReadToEnd()
}

$event = $null
try {
  $body = $inputPayload | ConvertFrom-Json
  if ($body.hook_event_name) {
    $event = [string]$body.hook_event_name
  } elseif ($body.type) {
    switch ([string]$body.type) {
      'agent-turn-complete' { $event = 'Stop' }
      'task_complete' { $event = 'Stop' }
      'exec_approval_request' { $event = 'PermissionRequest' }
      'apply_patch_approval_request' { $event = 'PermissionRequest' }
      'request_user_input' { $event = 'PermissionRequest' }
    }
  }
} catch {
  exit 0
}

switch ($event) {
  'Stop' {
    $payload = @{ notification_type = 'idle_prompt' } | ConvertTo-Json -Compress
    $eventType = 'notification'
  }
  'PermissionRequest' {
    $payload = @{ notification_type = 'permission_prompt' } | ConvertTo-Json -Compress
    $eventType = 'notification'
  }
  'SessionStart' {
    $payload = $inputPayload
    $eventType = 'session-start'
  }
  default {
    exit 0
  }
}

try {
  Invoke-WebRequest -UseBasicParsing -Method POST `
    -Uri ('http://127.0.0.1:' + $env:EMDASH_HOOK_PORT + '/hook') `
    -Headers @{
      'Content-Type' = 'application/json'
      'X-Emdash-Token' = $env:EMDASH_HOOK_TOKEN
      'X-Emdash-Pty-Id' = $env:EMDASH_PTY_ID
      'X-Emdash-Agent-Id' = $env:EMDASH_AGENT_ID
      'X-Emdash-Event-Type' = $eventType
    } `
    -Body $payload | Out-Null
} catch {
  exit 0
}
