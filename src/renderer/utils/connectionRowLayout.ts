export interface ConnectionRowLayoutInput<ElementType> {
  verse: number;
  element: ElementType;
  signature: string;
}

export interface ConnectionRowLayoutMeasurement<ElementType, ValueType> {
  element: ElementType;
  signature: string;
  value: ValueType;
}

export interface ReconciledConnectionRows<ElementType, ValueType> {
  rows: Map<number, ConnectionRowLayoutMeasurement<ElementType, ValueType>>;
  remeasuredVerses: Set<number>;
}

export interface ConnectionTickLayoutInput {
  id: string;
  side: "left" | "right";
  focusY: number;
}

export interface ConnectionTickLane {
  /** Stable renderer key. A single keeps its durable id; aggregates encode all members. */
  key: string;
  side: "left" | "right";
  top: number;
  focusY: number;
  /** Reading-ordered durable ids represented by this one physical control. */
  memberIds: readonly string[];
}

export function encodeConnectionTickMemberIds(memberIds: readonly string[]): string {
  return JSON.stringify(memberIds);
}

export function parseConnectionTickMemberIds(encoded: string | undefined): readonly string[] {
  if (!encoded) return [];
  try {
    const parsed: unknown = JSON.parse(encoded);
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export interface ConnectionRowLayoutSignatureParts {
  verse: number;
  width: string;
  height: string;
  textBox: string;
  numberBox: string;
  text: string;
  font: string;
  lineHeight: string;
  letterSpacing: string;
  wordSpacing: string;
  textIndent: string;
  textTransform: string;
  direction: string;
  whiteSpace: string;
  fontKerning: string;
  fontFeatureSettings: string;
  fontVariationSettings: string;
  fontRevision: number;
}

export function connectionRowLayoutSignature(parts: ConnectionRowLayoutSignatureParts): string {
  return [
    parts.verse,
    parts.width,
    parts.height,
    parts.textBox,
    parts.numberBox,
    parts.text,
    parts.font,
    parts.lineHeight,
    parts.letterSpacing,
    parts.wordSpacing,
    parts.textIndent,
    parts.textTransform,
    parts.direction,
    parts.whiteSpace,
    parts.fontKerning,
    parts.fontFeatureSettings,
    parts.fontVariationSettings,
    parts.fontRevision,
  ].join("\u001f");
}

/**
 * Retain row-local geometry only while both the mounted row and every metric
 * that can affect line wrapping are unchanged. The caller deliberately keeps
 * viewport top/left out of `signature`: a row translated by an earlier
 * verse's reflow can be projected into the current overlay frame without
 * repeating its word Range scan.
 */
export function reconcileConnectionRows<ElementType, ValueType>(
  previous: ReadonlyMap<number, ConnectionRowLayoutMeasurement<ElementType, ValueType>>,
  inputs: readonly ConnectionRowLayoutInput<ElementType>[],
  measure: (input: ConnectionRowLayoutInput<ElementType>) => ValueType,
): ReconciledConnectionRows<ElementType, ValueType> {
  const rows = new Map<number, ConnectionRowLayoutMeasurement<ElementType, ValueType>>();
  const remeasuredVerses = new Set<number>();

  for (const input of inputs) {
    const cached = previous.get(input.verse);
    if (cached && cached.element === input.element && cached.signature === input.signature) {
      rows.set(input.verse, cached);
      continue;
    }
    rows.set(input.verse, {
      element: input.element,
      signature: input.signature,
      value: measure(input),
    });
    remeasuredVerses.add(input.verse);
  }

  return { rows, remeasuredVerses };
}

function connectionTickLaneKey(
  side: ConnectionTickLayoutInput["side"],
  memberIds: readonly string[],
): string {
  return memberIds.length === 1
    ? memberIds[0]!
    : `connection-tick-group:${side}:${encodeConnectionTickMemberIds(memberIds)}`;
}

/**
 * Pack colliding desired controls without letting a local pile-up fan out over
 * otherwise empty parts of the chapter rail. Each side is partitioned into
 * natural collision clusters from its clamped desired button tops. A cluster
 * emits only the number of fully separated controls that fit inside its own
 * desired span; overflow is represented by deterministic, contiguous
 * reading-order groups. Every durable id therefore has exactly one reachable
 * control, requested fine/coarse separation is never compressed, and a
 * distant noncolliding control stays at its desired position.
 */
export function planConnectionTickLanes(
  items: readonly ConnectionTickLayoutInput[],
  height: number,
  separation = 25,
  edgeInset = 2,
  buttonHeight = 24,
): ConnectionTickLane[] {
  const result: ConnectionTickLane[] = [];
  const minTop = Math.max(0, edgeInset);
  const maxTop = Math.max(minTop, height - buttonHeight - edgeInset);
  const requiredSeparation = Math.max(0, separation);
  const seenIds = new Set<string>();
  const uniqueItems = [...items]
    .sort((left, right) =>
      left.id.localeCompare(right.id)
      || left.side.localeCompare(right.side)
      || left.focusY - right.focusY)
    .filter((item) => {
      if (seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    });

  for (const side of ["left", "right"] as const) {
    const sideItems = uniqueItems
      .filter((item) => item.side === side)
      .map((item) => ({
        ...item,
        desiredTop: Math.max(minTop, Math.min(maxTop, item.focusY - buttonHeight / 2)),
      }))
      .sort((left, right) =>
        left.desiredTop - right.desiredTop
        || left.focusY - right.focusY
        || left.id.localeCompare(right.id));
    if (sideItems.length === 0) continue;

    const clusters: Array<typeof sideItems> = [];
    for (const item of sideItems) {
      const cluster = clusters.at(-1);
      const previous = cluster?.at(-1);
      if (
        cluster
        && previous
        && item.desiredTop - previous.desiredTop < requiredSeparation
      ) {
        cluster.push(item);
      } else {
        clusters.push([item]);
      }
    }

    for (const cluster of clusters) {
      const clusterMinTop = cluster[0]!.desiredTop;
      const clusterMaxTop = cluster.at(-1)!.desiredTop;
      const clusterSpan = clusterMaxTop - clusterMinTop;
      const capacity = requiredSeparation === 0
        ? cluster.length
        : Math.max(1, Math.floor(clusterSpan / requiredSeparation) + 1);
      const groups = cluster.map((item) => [item]);
      while (groups.length > capacity) {
        let mergeIndex = 0;
        let smallestGap = Number.POSITIVE_INFINITY;
        let smallestTieKey: string | undefined;
        for (let index = 0; index < groups.length - 1; index += 1) {
          const left = groups[index]!;
          const right = groups[index + 1]!;
          const gap = right[0]!.desiredTop - left.at(-1)!.desiredTop;
          const tieKey = JSON.stringify([
            left.map((item) => item.id),
            right.map((item) => item.id),
          ]);
          if (
            gap < smallestGap
            || (gap === smallestGap && (smallestTieKey === undefined || tieKey < smallestTieKey))
          ) {
            mergeIndex = index;
            smallestGap = gap;
            smallestTieKey = tieKey;
          }
        }
        groups.splice(mergeIndex, 2, [...groups[mergeIndex]!, ...groups[mergeIndex + 1]!]);
      }

      const lanes = groups.map((members) => {
        const focusY = members.reduce((sum, item) => sum + item.focusY, 0) / members.length;
        const desiredTop = members.reduce((sum, item) => sum + item.desiredTop, 0) / members.length;
        const memberIds = members.map((item) => item.id);
        return {
          key: connectionTickLaneKey(side, memberIds),
          side,
          focusY,
          desiredTop,
          memberIds,
        };
      });
      const positions = lanes.map((lane) => lane.desiredTop);

      for (let index = 1; index < positions.length; index += 1) {
        positions[index] = Math.max(positions[index]!, positions[index - 1]! + requiredSeparation);
      }
      if (positions.at(-1)! > clusterMaxTop) {
        positions[positions.length - 1] = clusterMaxTop;
        for (let index = positions.length - 2; index >= 0; index -= 1) {
          positions[index] = Math.min(positions[index]!, positions[index + 1]! - requiredSeparation);
        }
      }
      if (positions[0]! < clusterMinTop) {
        positions[0] = clusterMinTop;
        for (let index = 1; index < positions.length; index += 1) {
          positions[index] = positions[index - 1]! + requiredSeparation;
        }
      }

      lanes.forEach((lane, index) => result.push({
        key: lane.key,
        side: lane.side,
        focusY: lane.focusY,
        memberIds: lane.memberIds,
        top: positions[index]!,
      }));
    }
  }
  return result.sort((left, right) =>
    left.focusY - right.focusY
    || left.side.localeCompare(right.side)
    || left.key.localeCompare(right.key));
}
