import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readExistingGameKeys } from '../scripts/import-latest-games'

test('readExistingGameKeys paginates past Supabase default 1000-row responses', async () => {
  const firstPage = Array.from({ length: 1000 }, (_, i) => ({
    slug: `game-${i}`,
    steam_app_id: String(i),
  }))
  const secondPage = [{ slug: 'late-game', steam_app_id: '9999' }]
  const ranges: Array<[number, number]> = []

  const client = {
    from(table: string) {
      assert.equal(table, 'games')
      return {
        select(columns: string) {
          assert.equal(columns, 'slug, steam_app_id')
          return {
            order(column: string, options: { ascending: boolean }) {
              assert.equal(column, 'slug')
              assert.deepEqual(options, { ascending: true })
              return {
                async range(from: number, to: number) {
                  ranges.push([from, to])
                  return {
                    data: from === 0 ? firstPage : secondPage,
                    error: null,
                  }
                },
              }
            },
          }
        },
      }
    },
  }

  const existing = await readExistingGameKeys(client)

  assert.deepEqual(ranges, [[0, 999], [1000, 1999]])
  assert.equal(existing.rows.length, 1001)
  assert.equal(existing.slugs.has('late-game'), true)
  assert.equal(existing.steamAppIds.has('9999'), true)
})
