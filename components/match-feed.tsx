'use client';

import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReportCard } from '@/components/report-card';
import { getMatchesForRigAsync } from '@/lib/data';
import type { Game, PerformanceTier, UserPC } from '@/lib/types';
import type { MatchSort, RigMatch } from '@/lib/similarity';

const TIERS: PerformanceTier[] = ['Excellent', 'Good', 'Playable', 'Struggling', 'Unplayable'];
const RESOLUTIONS = ['1920x1080', '2560x1440', '3840x2160'];
const DEFAULT_MIN_SCORE = 60;

interface MatchFeedProps {
  rig: UserPC;
  allGames: Game[];
}

export function MatchFeed({ rig, allGames }: MatchFeedProps) {
  const [gameId, setGameId] = useState('all');
  const [resolution, setResolution] = useState('all');
  const [tier, setTier] = useState('all');
  const [sort, setSort] = useState<MatchSort>('match');
  const [minScore, setMinScore] = useState(DEFAULT_MIN_SCORE);
  const [matches, setMatches] = useState<RigMatch[]>([]);
  const [loading, setLoading] = useState(true);

  const gameNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const game of allGames) names.set(game.id, game.name);
    return names;
  }, [allGames]);

  useEffect(() => {
    let cancelled = false;

    async function loadMatches() {
      setLoading(true);
      try {
        const result = await getMatchesForRigAsync(rig, {
          gameId: gameId === 'all' ? undefined : gameId,
          resolution: resolution === 'all' ? undefined : resolution,
          tier: tier === 'all' ? undefined : (tier as PerformanceTier),
          sort,
          minScore,
        });
        if (!cancelled) setMatches(result);
      } catch (error) {
        console.warn('[MatchFeed] getMatchesForRigAsync failed', error);
        if (!cancelled) setMatches([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMatches();

    return () => {
      cancelled = true;
    };
  }, [rig, gameId, resolution, tier, sort, minScore]);

  const usingLooserMatches = minScore < DEFAULT_MIN_SCORE;

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Users className="h-4 w-4 text-primary" />
        {loading
          ? 'Finding rigs like yours...'
          : `${matches.length} report${matches.length === 1 ? '' : 's'} from rigs like yours`}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <Label className="mb-1 block text-xs">Game</Label>
          <Select value={gameId} onValueChange={setGameId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All games</SelectItem>
              {allGames.map((game) => (
                <SelectItem key={game.id} value={game.id}>
                  {game.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0">
          <Label className="mb-1 block text-xs">Resolution</Label>
          <Select value={resolution} onValueChange={setResolution}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any</SelectItem>
              {RESOLUTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0">
          <Label className="mb-1 block text-xs">Outcome</Label>
          <Select value={tier} onValueChange={setTier}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any</SelectItem>
              {TIERS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0">
          <Label className="mb-1 block text-xs">Sort</Label>
          <Select value={sort} onValueChange={(value) => setSort(value as MatchSort)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="match">Best match</SelectItem>
              <SelectItem value="fps">Highest FPS</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-40 animate-pulse rounded-lg border border-border bg-muted/30" />
          ))}
        </div>
      ) : matches.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {matches.map((match) => (
            <ReportCard
              key={match.report.id}
              report={{
                ...match.report,
                gameName: match.report.gameName || gameNameById.get(match.report.gameId),
              }}
              userRig={rig}
              breakdown={match.breakdown}
              showGame
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          <p>No {usingLooserMatches ? '' : 'close '}matches yet for this filter combination.</p>
          {!usingLooserMatches ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setMinScore(0)}>
              Show looser matches
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setMinScore(DEFAULT_MIN_SCORE)}>
              Back to close matches only
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
