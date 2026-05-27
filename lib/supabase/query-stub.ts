/**
 * Minimal Supabase PostgREST query builder stub for unconfigured clients.
 * Supports the chains used by lib/data.ts (select + order, eq + maybeSingle).
 */
function emptyListResult() {
  return Promise.resolve({ data: [] as unknown[], error: null, count: null })
}

function emptySingleResult() {
  return Promise.resolve({ data: null, error: null })
}

function chainAfterSelect() {
  const orderChain = {
    ascending: () => emptyListResult(),
    descending: () => emptyListResult(),
    limit: () => emptyListResult(),
    range: () => emptyListResult(),
    then: (
      onfulfilled?: (v: { data: unknown[]; error: null }) => unknown,
      onrejected?: (reason: unknown) => unknown
    ) => emptyListResult().then(onfulfilled, onrejected),
  }
  return {
    order: () => orderChain,
    eq: () => ({
      maybeSingle: () => emptySingleResult(),
      single: () => emptySingleResult(),
    }),
    in: () => emptyListResult(),
    limit: () => emptyListResult(),
    then: (
      onfulfilled?: (v: { data: unknown[]; error: null }) => unknown,
      onrejected?: (reason: unknown) => unknown
    ) => emptyListResult().then(onfulfilled, onrejected),
  }
}

export function createQueryStub() {
  return {
    select: () => chainAfterSelect(),
    insert: () => ({ select: () => emptySingleResult() }),
    upsert: () => ({ select: () => emptySingleResult() }),
    update: () => ({ eq: () => emptySingleResult() }),
    delete: () => ({ eq: () => emptySingleResult() }),
  }
}
