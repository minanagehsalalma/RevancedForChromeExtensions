export interface PatchTarget {
  manifest_version?: number;
  version?: string;
  name?: string;
}

export interface PatchOpDelete {
  type: "delete";
  path: string;
}

export interface PatchOpAdd {
  type: "add";
  path: string;
  payloadPath: string;
  sha256: string;
}

export interface PatchOpReplace {
  type: "replace";
  path: string;
  payloadPath: string;
  fromSha256: string;
  toSha256: string;
}

export type PatchOp = PatchOpDelete | PatchOpAdd | PatchOpReplace;

export interface PatchBundle {
  patchsetVersion: number;
  createdAt: string;
  target?: PatchTarget;
  fingerprints: Record<string, string>;
  ops: PatchOp[];
}
