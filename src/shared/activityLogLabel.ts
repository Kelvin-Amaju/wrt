export type ActivityEventIdentity = {
  workId?: string;
  targetId?: string;
  groupId?: string;
  instanceIndex?: number;
};

function lastIdPart(value?: string): string | undefined {
  if (!value) return undefined;
  const parts = value.split('-').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : undefined;
}

function instanceFromWorkId(workId?: string): number | undefined {
  if (!workId) return undefined;
  const match = workId.match(/-instance-(\d+)$/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function activityWorkLabel(event: ActivityEventIdentity): string {
  if (!event.workId) return 'RUN';

  const targetPart = lastIdPart(event.targetId);
  const groupPart = lastIdPart(event.groupId);
  const instanceNumber = event.instanceIndex !== undefined
    ? event.instanceIndex + 1
    : instanceFromWorkId(event.workId);

  if (targetPart && groupPart && instanceNumber) {
    return `T${targetPart}/G${groupPart} #${instanceNumber}`;
  }

  return event.workId.length > 18 ? `…${event.workId.slice(-17)}` : event.workId;
}
