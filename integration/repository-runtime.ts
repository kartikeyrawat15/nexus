import { BrowserRepository, type PersistenceState } from "../repositories/browser-repository";
import { type FoundationRepository } from "../repositories/contracts";
import { type ImmutableSnapshot } from "../domain/types";

export interface RepositoryContextValue {
  repository: FoundationRepository | null;
  ready: boolean;
  error: string | null;
  projectId: string | null;
  persistence: PersistenceState | null;
}

export function defaultProjectId(snapshot: ImmutableSnapshot): string {
  return snapshot.state.workspace.featuredProjectId;
}

/** Created in a client effect, never in server evaluation or a render initializer. */
export function createRepositoryRuntime(factory: () => BrowserRepository = () => new BrowserRepository()) {
  const repository = factory();
  let initialization: ReturnType<BrowserRepository["initialize"]> | null = null;
  return { repository, initialize: () => (initialization ??= repository.initialize()) };
}
let runtime: ReturnType<typeof createRepositoryRuntime> | null = null;
export function getRepositoryRuntime(): ReturnType<typeof createRepositoryRuntime> {
  return (runtime ??= createRepositoryRuntime());
}
