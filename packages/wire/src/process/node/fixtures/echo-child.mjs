process.on('message', (message) => {
  if (message?.kind === 'echo') {
    process.send?.(message);
    return;
  }

  if (message?.kind === 'stdio') {
    process.stdout.write(`stdout:${message.value}\n`);
    process.stderr.write(`stderr:${message.value}\n`);
    return;
  }

  if (message?.kind === 'exit') {
    process.exit(message.code ?? 0);
  }
});
