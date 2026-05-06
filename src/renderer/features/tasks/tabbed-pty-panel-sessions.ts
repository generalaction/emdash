export type SessionIdOwner = {
  sessionId: string;
};

export function getTabbedPtySessionId<TEntity>(
  entity: TEntity,
  getSession: (entity: TEntity) => SessionIdOwner
): string {
  return getSession(entity).sessionId;
}

export function getTabbedPtySessionIds<TEntity>(
  entities: TEntity[],
  getSession: (entity: TEntity) => SessionIdOwner
): string[] {
  return entities.map((entity) => getTabbedPtySessionId(entity, getSession));
}
