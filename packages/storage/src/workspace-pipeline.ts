import type {
  DispositionBucket,
  UserMarketQuery,
  UserProjectDisposition,
  WorkspaceProject,
} from "@clearbolt/core";

/** Team pipeline + per-user market queries and dealbox (V1+). */
export interface WorkspacePipelineStore {
  putWorkspaceProject(project: WorkspaceProject): Promise<void>;
  getWorkspaceProject(
    id: string,
    workspaceId: string,
  ): Promise<WorkspaceProject | null>;
  listWorkspaceProjects(workspaceId: string): Promise<WorkspaceProject[]>;

  putUserMarketQuery(query: UserMarketQuery): Promise<void>;
  getUserMarketQuery(
    id: string,
    workspaceId: string,
  ): Promise<UserMarketQuery | null>;
  listUserMarketQueries(
    workspaceId: string,
    ownerUserId: string,
  ): Promise<UserMarketQuery[]>;

  putUserProjectDisposition(disposition: UserProjectDisposition): Promise<void>;
  getUserProjectDisposition(
    userId: string,
    projectId: string,
  ): Promise<UserProjectDisposition | null>;
  listUserProjectDispositions(input: {
    userId: string;
    workspaceId: string;
    bucket?: DispositionBucket;
  }): Promise<UserProjectDisposition[]>;

  /**
   * Promote a shared canonical listing into a team project; optionally add to
   * the promoter's dealbox and mark research as pending in metadata.
   */
  promoteCanonicalToProject(input: {
    workspaceId: string;
    createdByUserId: string;
    canonicalDealId: string;
    title: string;
    addToDealbox?: boolean;
  }): Promise<WorkspaceProject>;
}
