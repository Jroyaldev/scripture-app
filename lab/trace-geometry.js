/* Pattern shapes · pure trace geometry
 *
 * Browser-neutral planning for the visual lab. Keeping measurement math here
 * lets the real renderer and the Node regression suite exercise the same
 * contact points, corridor routes, and thread ports without a DOM test dependency.
 */
(function installTraceGeometry(root) {
  "use strict";

  const UNDERLINE_HEIGHT = 1.5;
  const UNDERLINE_CENTER_OFFSET = UNDERLINE_HEIGHT / 2;
  const TOUCH_RADIUS = 1.8;
  const TOUCH_OVERLAP = 0.2;
  const PARALLEL_SEPARATION = 1.7;
  const SAME_LINE_TOLERANCE = 2;
  const MIN_BOW_DEPTH = 10;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function pointKey(point) {
    return `${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
  }

  function relativeClientRects(base, rectList) {
    return Array.from(rectList || [])
      .map((rect) => ({
        x: rect.left - base.left,
        right: rect.right - base.left,
        top: rect.top - base.top,
        bottom: rect.bottom - base.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
      }))
      .filter((rect) => Number.isFinite(rect.x) && Number.isFinite(rect.bottom) && rect.width > 0 && rect.height > 0)
      .sort((a, b) => a.top - b.top || a.x - b.x);
  }

  function mergeLineFragments(rects, lineTolerance = SAME_LINE_TOLERANCE, gapTolerance = 1.25) {
    const merged = [];
    for (const rect of [...rects].sort((a, b) => a.top - b.top || a.x - b.x)) {
      const prior = merged[merged.length - 1];
      if (prior && Math.abs(prior.bottom - rect.bottom) <= lineTolerance && rect.x <= prior.right + gapTolerance) {
        prior.x = Math.min(prior.x, rect.x);
        prior.right = Math.max(prior.right, rect.right);
        prior.top = Math.min(prior.top, rect.top);
        prior.bottom = Math.max(prior.bottom, rect.bottom);
        prior.width = prior.right - prior.x;
        prior.height = prior.bottom - prior.top;
      } else {
        merged.push({ ...rect });
      }
    }
    return merged;
  }

  function contactFor(fragment, side = "start", offset = 0) {
    const inset = TOUCH_RADIUS - TOUCH_OVERLAP;
    return {
      x: side === "end" ? fragment.right + inset : fragment.x - inset,
      y: fragment.bottom - UNDERLINE_CENTER_OFFSET - offset,
      side,
    };
  }

  function planMember(fragments, underlineOffset = 0) {
    const lines = mergeLineFragments(fragments).map((fragment) => ({
      ...fragment,
      underlineY: fragment.bottom - UNDERLINE_CENTER_OFFSET - underlineOffset,
      startContact: contactFor(fragment, "start", underlineOffset),
      endContact: contactFor(fragment, "end", underlineOffset),
    }));
    if (!lines.length) return null;
    let primaryIndex = 0;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].x < lines[primaryIndex].x - 0.5 ||
          (Math.abs(lines[i].x - lines[primaryIndex].x) <= 0.5 && lines[i].top < lines[primaryIndex].top)) {
        primaryIndex = i;
      }
    }
    return {
      fragments: lines,
      primaryIndex,
      primaryFragment: lines[primaryIndex],
      contact: lines[primaryIndex].startContact,
      continuationContacts: lines.map((fragment) => fragment.startContact),
    };
  }

  function memberCorridor(member, lineHeight = 26) {
    const fragment = member.primaryFragment || member.fragments[member.primaryIndex || 0];
    const clearance = clamp((lineHeight - fragment.height) / 2, 2.5, 6);
    return {
      y: fragment.bottom + clearance,
      clearance,
      drop: fragment.bottom + clearance - member.contact.y,
      fragment,
    };
  }

  function sampleCubic(p0, p1, p2, p3, count = 24) {
    const points = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const u = 1 - t;
      points.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
    }
    return points;
  }

  function sameLineFacing(a, b) {
    let best = null;
    for (const af of a.fragments) {
      for (const bf of b.fragments) {
        if (Math.abs(af.underlineY - bf.underlineY) > SAME_LINE_TOLERANCE) continue;
        const left = af.x <= bf.x ? af : bf;
        const right = left === af ? bf : af;
        const gap = right.x - left.right;
        if (gap < -1) continue;
        if (!best || gap < best.gap) {
          best = {
            gap,
            start: left.endContact,
            end: right.startContact,
            left,
            right,
          };
        }
      }
    }
    return best;
  }

  function cradlePlan(start, end, maxDepth = 13) {
    const gap = Math.max(0, end.x - start.x);
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const desiredDip = clamp(7 + gap * 0.04, 7, 13);
    const dip = Math.min(desiredDip, Math.max(1.5, maxDepth));
    const handle = clamp(gap * 0.2, 2.5, 14);
    const floor = { x: mid.x, y: Math.max(start.y, end.y) + dip };
    const c1 = { x: start.x + handle, y: start.y };
    const c2 = { x: floor.x - handle, y: floor.y };
    const c3 = { x: floor.x + handle, y: floor.y };
    const c4 = { x: end.x - handle, y: end.y };
    const first = sampleCubic(start, c1, c2, floor, 16);
    const second = sampleCubic(floor, c3, c4, end, 16);
    return {
      mode: "same-line",
      route: "cradle",
      start,
      end,
      depth: dip,
      points: first.concat(second.slice(1)),
      d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${floor.x} ${floor.y} C ${c3.x} ${c3.y}, ${c4.x} ${c4.y}, ${end.x} ${end.y}`,
    };
  }

  function sampleLine(start, end, count = 2) {
    const points = [];
    const steps = Math.max(1, count);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      });
    }
    return points;
  }

  function appendPoints(target, points) {
    if (!points.length) return target;
    if (!target.length) return target.concat(points);
    return target.concat(points.slice(1));
  }

  /* Different-line relationships behave like marginalia, not free-floating
   * bows. Each contact drops into the corridor immediately below its rendered
   * line, travels horizontally outside the prose, and turns on the margin.
   * The four cubics keep every change of direction rounded. */
  function corridorPlan(start, end, startFragment, endFragment, gutterX, laneOffset, lineHeight) {
    const dy = Math.abs(end.y - start.y);
    const targetLane = Math.min(gutterX - laneOffset, Math.min(start.x, end.x) - MIN_BOW_DEPTH);
    const safeLineHeight = Math.max(1, lineHeight || 26);
    const startClearance = clamp((safeLineHeight - startFragment.height) / 2, 2.5, 6);
    const endClearance = clamp((safeLineHeight - endFragment.height) / 2, 2.5, 6);
    const corridorTop = startFragment.bottom + startClearance;
    const corridorBottom = endFragment.bottom + endClearance;
    const startDrop = corridorTop - start.y;
    const endDrop = corridorBottom - end.y;
    const horizontalRoom = Math.min(start.x - startDrop, end.x - endDrop) - targetLane;
    const cornerRadius = Math.max(0.75, Math.min(9, (corridorBottom - corridorTop) / 2, horizontalRoom / 2));
    const k = 0.5522847498;

    const startLead = { x: start.x - startDrop, y: corridorTop };
    const topCornerIn = { x: targetLane + cornerRadius, y: corridorTop };
    const topCornerOut = { x: targetLane, y: corridorTop + cornerRadius };
    const bottomCornerIn = { x: targetLane, y: corridorBottom - cornerRadius };
    const bottomCornerOut = { x: targetLane + cornerRadius, y: corridorBottom };
    const endLead = { x: end.x - endDrop, y: corridorBottom };

    const startC1 = { x: start.x, y: start.y + k * startDrop };
    const startC2 = { x: start.x - startDrop + k * startDrop, y: corridorTop };
    const topC1 = { x: targetLane + cornerRadius - k * cornerRadius, y: corridorTop };
    const topC2 = { x: targetLane, y: corridorTop + cornerRadius - k * cornerRadius };
    const bottomC1 = { x: targetLane, y: corridorBottom - cornerRadius + k * cornerRadius };
    const bottomC2 = { x: targetLane + cornerRadius - k * cornerRadius, y: corridorBottom };
    const endC1 = { x: end.x - endDrop + k * endDrop, y: corridorBottom };
    const endC2 = { x: end.x, y: end.y + k * endDrop };

    const horizontalSamples = (a, b) => clamp(Math.ceil(Math.abs(b.x - a.x) / 14), 2, 28);
    const verticalSamples = clamp(Math.ceil(Math.abs(bottomCornerIn.y - topCornerOut.y) / 14), 2, 28);
    let points = sampleCubic(start, startC1, startC2, startLead, 8);
    points = appendPoints(points, sampleLine(startLead, topCornerIn, horizontalSamples(startLead, topCornerIn)));
    points = appendPoints(points, sampleCubic(topCornerIn, topC1, topC2, topCornerOut, 8));
    points = appendPoints(points, sampleLine(topCornerOut, bottomCornerIn, verticalSamples));
    points = appendPoints(points, sampleCubic(bottomCornerIn, bottomC1, bottomC2, bottomCornerOut, 8));
    points = appendPoints(points, sampleLine(bottomCornerOut, endLead, horizontalSamples(bottomCornerOut, endLead)));
    points = appendPoints(points, sampleCubic(endLead, endC1, endC2, end, 8));
    const marginStartFraction = polylineFractionAtPoint(points, topCornerOut);
    const marginEndFraction = polylineFractionAtPoint(points, bottomCornerIn);
    const marginFraction = (marginStartFraction + marginEndFraction) / 2;

    const renderedDelta = dy / Math.max(1, lineHeight || 26);
    return {
      mode: renderedDelta <= 1.45 ? "adjacent" : "far",
      route: "corridor",
      start,
      end,
      laneX: targetLane,
      depth: Math.min(start.x, end.x) - targetLane,
      corridorTop,
      corridorBottom,
      cornerRadius,
      marginStartFraction,
      marginEndFraction,
      marginFraction,
      startDrop,
      endDrop,
      points,
      d: `M ${start.x} ${start.y}` +
        ` C ${startC1.x} ${startC1.y}, ${startC2.x} ${startC2.y}, ${startLead.x} ${startLead.y}` +
        ` L ${topCornerIn.x} ${topCornerIn.y}` +
        ` C ${topC1.x} ${topC1.y}, ${topC2.x} ${topC2.y}, ${topCornerOut.x} ${topCornerOut.y}` +
        ` L ${bottomCornerIn.x} ${bottomCornerIn.y}` +
        ` C ${bottomC1.x} ${bottomC1.y}, ${bottomC2.x} ${bottomC2.y}, ${bottomCornerOut.x} ${bottomCornerOut.y}` +
        ` L ${endLead.x} ${endLead.y}` +
        ` C ${endC1.x} ${endC1.y}, ${endC2.x} ${endC2.y}, ${end.x} ${end.y}`,
    };
  }

  function planArc(a, b, options = {}) {
    const facing = sameLineFacing(a, b);
    if (facing) {
      const lineHeight = Math.max(1, options.lineHeight || 26);
      const corridorY = Math.min(
        facing.left.bottom + clamp((lineHeight - facing.left.height) / 2, 2.5, 6),
        facing.right.bottom + clamp((lineHeight - facing.right.height) / 2, 2.5, 6),
      );
      // Reserve enough of the leading for the widest kind envelope. The cradle
      // remains visible below the underline without entering the next line.
      const maxDepth = corridorY - Math.max(facing.start.y, facing.end.y) - 1.5;
      return { ...cradlePlan(facing.start, facing.end, maxDepth), facing, corridorY };
    }
    const startsWithA = a.contact.y <= b.contact.y;
    const startMember = startsWithA ? a : b;
    const endMember = startsWithA ? b : a;
    return corridorPlan(
      startMember.contact,
      endMember.contact,
      startMember.primaryFragment,
      endMember.primaryFragment,
      options.gutterX || 0,
      options.laneOffset || 0,
      options.lineHeight || 26,
    );
  }

  function offsetPoints(points, distance, profile = () => 1) {
    const last = points.length - 1;
    return points.map((point, index) => {
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(last, index + 1)];
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const length = Math.hypot(dx, dy) || 1;
      const factor = profile(last ? index / last : 0);
      return {
        x: point.x + (-dy / length) * distance * factor,
        y: point.y + (dx / length) * distance * factor,
      };
    });
  }

  function parallelRails(points, separation = PARALLEL_SEPARATION, taperStart = true, taperEnd = true) {
    const profile = (t) => {
      const start = taperStart ? smoothstep(t / 0.18) : 1;
      const end = taperEnd ? smoothstep((1 - t) / 0.18) : 1;
      return start * end;
    };
    return [offsetPoints(points, -separation, profile), offsetPoints(points, separation, profile)];
  }

  function polylineLength(points) {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return length;
  }

  function polylineFractionAtPoint(points, target) {
    const total = polylineLength(points);
    if (!total) return 0;
    let cursor = 0;
    let bestDistance = Infinity;
    let bestAlong = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segment = Math.hypot(dx, dy);
      if (!segment) continue;
      const t = clamp(((target.x - a.x) * dx + (target.y - a.y) * dy) / (segment * segment), 0, 1);
      const projected = { x: a.x + dx * t, y: a.y + dy * t };
      const distance = Math.hypot(projected.x - target.x, projected.y - target.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestAlong = cursor + segment * t;
      }
      cursor += segment;
    }
    return bestAlong / total;
  }

  function slicePolyline(points, from, to) {
    const total = polylineLength(points);
    const start = clamp(from, 0, total);
    const end = clamp(to, start, total);
    const out = [];
    let cursor = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const segment = Math.hypot(b.x - a.x, b.y - a.y);
      const segStart = cursor;
      const segEnd = cursor + segment;
      if (segEnd >= start && segStart <= end && segment > 0) {
        const lo = clamp((start - segStart) / segment, 0, 1);
        const hi = clamp((end - segStart) / segment, 0, 1);
        const p0 = { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo };
        const p1 = { x: a.x + (b.x - a.x) * hi, y: a.y + (b.y - a.y) * hi };
        if (!out.length || pointKey(out[out.length - 1]) !== pointKey(p0)) out.push(p0);
        if (pointKey(out[out.length - 1]) !== pointKey(p1)) out.push(p1);
      }
      cursor = segEnd;
      if (cursor > end) break;
    }
    return out;
  }

  function contrastHalves(points, gap = 8, shear = 1.2, centerFraction = 0.5) {
    const total = polylineLength(points);
    const halfGap = Math.min(gap / 2, total * 0.16);
    const requestedCenter = clamp(centerFraction, 0, 1) * total;
    const center = clamp(requestedCenter, halfGap + 0.01, Math.max(halfGap + 0.01, total - halfGap - 0.01));
    const left = slicePolyline(points, 0, center - halfGap);
    const right = slicePolyline(points, center + halfGap, total);
    return [
      offsetPoints(left, -shear, (t) => smoothstep(t)),
      offsetPoints(right, shear, (t) => 1 - smoothstep(t)),
    ];
  }

  function planThread(members, options = {}) {
    const laneX = options.laneX || 0;
    const separation = options.separation || PARALLEL_SEPARATION;
    const lineHeight = options.lineHeight || 26;
    const k = 0.5522847498;
    const entries = members
      .map((member) => ({ member, contact: member.contact, corridor: memberCorridor(member, lineHeight) }))
      .sort((a, b) => a.contact.y - b.contact.y || a.contact.x - b.contact.x);
    if (!entries.length) return null;

    const terminal = (entry, corridorY = entry.corridor.y) => {
      const drop = corridorY - entry.contact.y;
      const lead = { x: entry.contact.x - drop, y: corridorY };
      const c1 = { x: entry.contact.x - drop + k * drop, y: corridorY };
      const c2 = { x: entry.contact.x, y: entry.contact.y + k * drop };
      return {
        drop,
        lead,
        c1,
        c2,
        points: sampleCubic(lead, c1, c2, entry.contact, 8),
        d: `M ${lead.x} ${lead.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${entry.contact.x} ${entry.contact.y}`,
      };
    };

    if (Math.abs(entries[entries.length - 1].contact.y - entries[0].contact.y) <= SAME_LINE_TOLERANCE) {
      const ordered = [...entries].sort((a, b) => a.contact.x - b.contact.x);
      const railY = Math.max(...ordered.map((entry) => entry.corridor.y)) + separation;
      const branches = ordered.map((entry) => {
        const terminalPlan = terminal(entry, railY);
        const parallel = parallelRails(terminalPlan.points, separation, false, true)
          .sort((left, right) => left[0].y - right[0].y);
        parallel[0][0] = { x: terminalPlan.lead.x, y: railY - separation };
        parallel[1][0] = { x: terminalPlan.lead.x, y: railY + separation };
        parallel[0][parallel[0].length - 1] = { ...entry.contact };
        parallel[1][parallel[1].length - 1] = { ...entry.contact };
        return {
          contact: entry.contact,
          corridorY: railY,
          port: terminalPlan.lead,
          points: terminalPlan.points,
          d: terminalPlan.d,
          parallel,
        };
      });
      const startX = Math.min(...branches.map((branch) => branch.port.x));
      const endX = Math.max(...branches.map((branch) => branch.port.x));
      return {
        mode: "inline-thread",
        route: "corridor",
        contacts: ordered.map((entry) => entry.contact),
        railY,
        spine: { start: { x: startX, y: railY }, end: { x: endX, y: railY } },
        parallelSpine: {
          start: { x: startX, y: railY },
          end: { x: endX, y: railY },
        },
        branches,
      };
    }

    const groups = [];
    entries.forEach((entry) => {
      const group = groups[groups.length - 1];
      if (group && Math.abs(entry.contact.y - group.contactY) <= SAME_LINE_TOLERANCE) {
        group.entries.push(entry);
        group.corridorY = Math.max(group.corridorY, entry.corridor.y);
      } else {
        groups.push({ contactY: entry.contact.y, corridorY: entry.corridor.y, entries: [entry] });
      }
    });

    const groupSpecs = groups.map((group, groupIndex) => {
      const previousGap = groupIndex ? group.corridorY - groups[groupIndex - 1].corridorY : Infinity;
      const nextGap = groupIndex < groups.length - 1 ? groups[groupIndex + 1].corridorY - group.corridorY : Infinity;
      const available = Math.min(previousGap, nextGap);
      const terminals = group.entries.map((entry) => ({ entry, terminalPlan: terminal(entry, group.corridorY) }));
      const horizontalRoom = Math.max(4, Math.min(...terminals.map(({ terminalPlan }) => terminalPlan.lead.x - laneX)));
      const radius = Math.max(0.75, Math.min(8, Number.isFinite(available) ? available * 0.24 : 8, horizontalRoom * 0.24));
      const sign = groupIndex === 0 ? 1 : groupIndex === groups.length - 1 ? -1 : previousGap >= nextGap ? -1 : 1;
      const port = { x: laneX, y: group.corridorY + sign * radius };
      const marginOut = { x: laneX + radius, y: group.corridorY };
      const c1 = { x: laneX, y: port.y - sign * k * radius };
      const c2 = { x: laneX + radius - k * radius, y: group.corridorY };
      const forkX = Math.min(...terminals.map(({ terminalPlan }) => terminalPlan.lead.x));
      return { ...group, groupIndex, terminals, port, marginOut, c1, c2, forkX };
    });

    const branches = groupSpecs.flatMap((group) => group.terminals.map(({ entry, terminalPlan }, terminalIndex) => {
      const isLeader = terminalIndex === group.terminals.findIndex(({ terminalPlan: candidate }) => candidate.lead.x === group.forkX);
      const fork = { x: group.forkX, y: group.corridorY };
      let points;
      let d;
      if (isLeader) {
        const horizontalSamples = clamp(Math.ceil(Math.abs(terminalPlan.lead.x - group.marginOut.x) / 14), 2, 28);
        points = sampleCubic(group.port, group.c1, group.c2, group.marginOut, 8);
        points = appendPoints(points, sampleLine(group.marginOut, terminalPlan.lead, horizontalSamples));
        points = appendPoints(points, terminalPlan.points);
        d = `M ${group.port.x} ${group.port.y}` +
          ` C ${group.c1.x} ${group.c1.y}, ${group.c2.x} ${group.c2.y}, ${group.marginOut.x} ${group.marginOut.y}` +
          ` L ${terminalPlan.lead.x} ${terminalPlan.lead.y}` +
          ` C ${terminalPlan.c1.x} ${terminalPlan.c1.y}, ${terminalPlan.c2.x} ${terminalPlan.c2.y}, ${entry.contact.x} ${entry.contact.y}`;
      } else {
        points = [fork];
        if (terminalPlan.lead.x > fork.x + 0.01) {
          const horizontalSamples = clamp(Math.ceil(Math.abs(terminalPlan.lead.x - fork.x) / 14), 2, 28);
          points = appendPoints(points, sampleLine(fork, terminalPlan.lead, horizontalSamples));
        }
        points = appendPoints(points, terminalPlan.points);
        d = `M ${fork.x} ${fork.y}` +
          (terminalPlan.lead.x > fork.x + 0.01 ? ` L ${terminalPlan.lead.x} ${terminalPlan.lead.y}` : "") +
          ` C ${terminalPlan.c1.x} ${terminalPlan.c1.y}, ${terminalPlan.c2.x} ${terminalPlan.c2.y}, ${entry.contact.x} ${entry.contact.y}`;
      }
      const parallel = parallelRails(points, separation, false, true)
        .sort((left, right) => left[0].x - right[0].x);
      if (isLeader) {
        parallel[0][0] = { x: laneX - separation, y: group.port.y };
        parallel[1][0] = { x: laneX + separation, y: group.port.y };
      }
      parallel[0][parallel[0].length - 1] = { ...entry.contact };
      parallel[1][parallel[1].length - 1] = { ...entry.contact };
      return {
        contact: entry.contact,
        corridorY: group.corridorY,
        port: group.port,
        marginOut: group.marginOut,
        portGroup: group.groupIndex,
        sharedFork: fork,
        isPortLeader: isLeader,
        lead: terminalPlan.lead,
        points,
        d,
        parallel,
      };
    }));
    const spineTop = groupSpecs[0].port.y;
    const spineBottom = groupSpecs[groupSpecs.length - 1].port.y;
    return {
      mode: "thread",
      route: "corridor",
      contacts: entries.map((entry) => entry.contact),
      branches,
      spine: {
        start: { x: laneX, y: Math.min(spineTop, spineBottom) },
        end: { x: laneX, y: Math.max(spineTop, spineBottom) },
      },
      rails: [laneX - separation, laneX + separation],
    };
  }

  function resolveSegmentHue(segmentGids, activeGids, focusGid, hueByGid) {
    const active = segmentGids.filter((gid) => activeGids.includes(gid));
    const owner = focusGid && active.includes(focusGid) ? focusGid : active[active.length - 1] || segmentGids[0];
    return owner ? hueByGid[owner] : null;
  }

  function orderSegmentGids(segmentGids, activeGids, focusGid) {
    const active = segmentGids.filter((gid) => activeGids.includes(gid));
    if (!focusGid || !active.includes(focusGid)) return active;
    return active.filter((gid) => gid !== focusGid).concat(focusGid);
  }

  root.TraceGeometry = Object.freeze({
    constants: Object.freeze({
      UNDERLINE_HEIGHT,
      UNDERLINE_CENTER_OFFSET,
      TOUCH_RADIUS,
      TOUCH_OVERLAP,
      PARALLEL_SEPARATION,
      SAME_LINE_TOLERANCE,
      MIN_BOW_DEPTH,
    }),
    clamp,
    smoothstep,
    relativeClientRects,
    mergeLineFragments,
    contactFor,
    planMember,
    memberCorridor,
    sampleCubic,
    planArc,
    offsetPoints,
    parallelRails,
    contrastHalves,
    planThread,
    resolveSegmentHue,
    orderSegmentGids,
    polylineLength,
    polylineFractionAtPoint,
  });
})(globalThis);
