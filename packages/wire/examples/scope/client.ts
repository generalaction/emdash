import { createScope } from '../../src/util';

async function main(): Promise<void> {
  const events: string[] = [];
  const root = createScope({
    label: 'root',
    onCleanupError: (error, scope) => {
      console.log('cleanup error:', scope.label, error instanceof Error ? error.message : error);
    },
  });
  const session = root.child('session');

  root.add(() => {
    events.push('root cleanup');
  });
  session.add(() => {
    events.push('session subscription cleanup');
  });
  session.use({
    dispose: () => {
      events.push('session resource dispose');
    },
  });

  await root.dispose();

  root.add(() => {
    events.push('late cleanup');
  });

  console.log('scope disposed:', root.disposed);
  console.log('cleanup order:', events.join(' -> '));
}

void main();
