import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildCoverCandidates } from '../lib/server/cover-candidates'

test('cover candidates fall back catalog -> IGDB -> Steam so a dead source is not fatal', () => {
  const c = buildCoverCandidates({
    catalogCover: { url: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2623190/library_600x900_2x.jpg', attribution: 'steam' },
    igdbCoverImageId: 'co9pul',
    igdbMatches: true,
    steamAppId: '2623190',
  })
  assert.equal(c.length, 3)
  assert.equal(c[0].url, 'https://cdn.cloudflare.steamstatic.com/steam/apps/2623190/library_600x900_2x.jpg')
  assert.match(c[1].url, /images\.igdb\.com\/igdb\/image\/upload\/t_original\/co9pul\.jpg$/)
  assert.match(c[2].url, /steam\/apps\/2623190\/library_600x900_2x\.jpg$/)
})

test('cover candidates use IGDB first when there is no catalog cover', () => {
  const c = buildCoverCandidates({
    catalogCover: null,
    igdbCoverImageId: 'cobc5n',
    igdbMatches: true,
    steamAppId: '2483190',
  })
  assert.equal(c.length, 2)
  assert.match(c[0].url, /t_original\/cobc5n\.jpg$/)
  assert.match(c[1].url, /apps\/2483190\//)
})

test('cover candidates omit IGDB when there is no match or no image id', () => {
  const c = buildCoverCandidates({ catalogCover: null, igdbCoverImageId: null, igdbMatches: false, steamAppId: '730' })
  assert.equal(c.length, 1)
  assert.match(c[0].url, /apps\/730\//)
})

test('cover candidates are empty when nothing is available', () => {
  const c = buildCoverCandidates({ catalogCover: null, igdbCoverImageId: null, igdbMatches: false, steamAppId: null })
  assert.equal(c.length, 0)
})
