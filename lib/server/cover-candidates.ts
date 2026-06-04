/**
 * Ordered cover-source candidates for game ingestion.
 *
 * A game's cover may come from several sources; some can be dead for a given title
 * (e.g. Steam serves no portrait capsule for many Xbox/very-new games — the
 * library_600x900 URL 404s). The ingester tries these in order and uses the first
 * that actually uploads, so a dead preferred source falls through instead of leaving
 * the game cover-less. Alias-free imports keep this unit loadable under `tsx --test`.
 */
import { steamLibraryCoverUrl } from '../cover-image-url'

export interface CoverCandidate {
  url: string
  attr: string
}

const STEAM_ATTR =
  'Cover from Steam CDN (https://store.steampowered.com/). © Valve Corporation.'
const IGDB_ATTR =
  'Sourced from IGDB (https://www.igdb.com). Images © respective copyright holders. Used for non-commercial informational purposes.'

export interface CoverCandidateInput {
  catalogCover?: { url: string; attribution: string } | null
  igdbCoverImageId?: string | null
  igdbMatches?: boolean
  steamAppId?: string | null
}

/** Cover sources in priority order: curated catalog -> IGDB -> Steam library art. */
export function buildCoverCandidates(input: CoverCandidateInput): CoverCandidate[] {
  const out: CoverCandidate[] = []

  if (input.catalogCover?.url) {
    out.push({ url: input.catalogCover.url, attr: input.catalogCover.attribution })
  }
  if (input.igdbMatches && input.igdbCoverImageId) {
    out.push({
      url: `https://images.igdb.com/igdb/image/upload/t_original/${input.igdbCoverImageId}.jpg`,
      attr: IGDB_ATTR,
    })
  }
  if (input.steamAppId) {
    out.push({ url: steamLibraryCoverUrl(input.steamAppId), attr: STEAM_ATTR })
  }

  return out
}
