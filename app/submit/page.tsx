'use client';

import { useState } from 'react';
import { useGames } from '@/lib/data';
import { SubmitReportDialog } from '@/components/submit-report-dialog';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import type { Game } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function SubmitPage() {
  const [selectedGameSlug, setSelectedGameSlug] = useState('');
  const [showDialog, setShowDialog] = useState(false);

  const { games } = useGames();
  const selectedGame = games.find((g: Game) => g.slug === selectedGameSlug);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Submit a Report</h1>
      <p className="mt-2 text-muted-foreground">Choose a game and tell the community how it actually runs on your hardware.</p>

      <div className="mt-8">
        <label className="text-sm font-medium">Game</label>
        <Select
          value={selectedGameSlug || undefined}
          onValueChange={(v) => setSelectedGameSlug(v)}
        >
          <SelectTrigger className="mt-1.5 w-full">
            <SelectValue placeholder="Select a game..." />
          </SelectTrigger>
          <SelectContent>
            {games.map((g: Game) => (
              <SelectItem key={g.id} value={g.slug}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6">
        <Button
          size="lg"
          disabled={!selectedGame}
          onClick={() => setShowDialog(true)}
          className="w-full"
        >
          Continue to Report Form
        </Button>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Prefer browsing first? <Link href="/games" className="underline">Go to game list</Link>
      </p>

      {selectedGame && (
        <SubmitReportDialog
          open={showDialog}
          onOpenChange={setShowDialog}
          game={selectedGame}
        />
      )}
    </div>
  );
}
