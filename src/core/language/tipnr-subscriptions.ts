/**
 * KJV epistle subscriptions embedded in the AKJV source package.
 *
 * These fourteen blocks are historical edition paratext appended to the last
 * canonical verse of an epistle. They are useful provenance, but they are not
 * part of the verse text and must never populate TIPNR's normal `byRef` index.
 */
export const KJV_EPISTLE_SUBSCRIPTION_REFS = [
  "ROM.16.27",
  "1CO.16.24",
  "2CO.13.14",
  "GAL.6.18",
  "EPH.6.24",
  "PHP.4.23",
  "COL.4.18",
  "1TH.5.28",
  "2TH.3.18",
  "1TI.6.21",
  "2TI.4.22",
  "TIT.3.15",
  "PHM.1.25",
  "HEB.13.25",
] as const;

export type KjvEpistleSubscriptionRef = typeof KJV_EPISTLE_SUBSCRIPTION_REFS[number];

const KJV_EPISTLE_SUBSCRIPTION_REF_SET = new Set<string>(KJV_EPISTLE_SUBSCRIPTION_REFS);

export function isKjvEpistleSubscriptionRef(ref: string): ref is KjvEpistleSubscriptionRef {
  return KJV_EPISTLE_SUBSCRIPTION_REF_SET.has(ref);
}
