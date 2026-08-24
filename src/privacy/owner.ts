export interface OwnerAccessRequest {
  authenticatedUid: string | undefined;
  expectedOwnerUid: string | undefined;
}

export function isExactOwner(request: OwnerAccessRequest): boolean {
  return Boolean(
    request.authenticatedUid
      && request.expectedOwnerUid
      && request.authenticatedUid === request.expectedOwnerUid,
  );
}

export function assertExactOwner(request: OwnerAccessRequest): string {
  if (!isExactOwner(request)) throw new Error("Private collection access denied");
  return request.authenticatedUid as string;
}

export function privateCollectionPath(ownerUid: string): string {
  if (ownerUid.trim() === "") throw new Error("Owner UID is required");
  return `owners/${encodeURIComponent(ownerUid)}/private/collection`;
}
