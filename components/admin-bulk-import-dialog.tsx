'use client';

import React, { useState } from 'react';
import { bulkImportGames, parseCSV } from '@/lib/data';
import type { BulkImportResult } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { showUserError } from '@/lib/toast';
import { Upload } from 'lucide-react';

interface AdminBulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete?: () => void;
}

export function AdminBulkImportDialog({ open, onOpenChange, onImportComplete }: AdminBulkImportDialogProps) {
  const [importTab, setImportTab] = useState<'csv' | 'json'>('csv');
  const [importText, setImportText] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [parsedPreview, setParsedPreview] = useState<any[]>([]);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setImportText(text);
      processImportText(text, file.name.endsWith('.json') ? 'json' : 'csv');
    };
    reader.readAsText(file);
  };

  const processImportText = (text: string, forceType?: 'csv' | 'json') => {
    const type = forceType || importTab;
    setImportResult(null);
    try {
      let rows: any[] = [];
      if (type === 'json') {
        const parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        rows = parseCSV(text);
      }
      setParsedPreview(rows.slice(0, 12));
    } catch {
      showUserError('Could not read that file. Make sure it is valid JSON.');
      setParsedPreview([]);
    }
  };

  const runBulkImport = async () => {
    if (!importText.trim() || parsedPreview.length === 0) {
      showUserError('No data to import.');
      return;
    }
    setIsImporting(true);
    try {
      const rows = importTab === 'json' ? JSON.parse(importText) : parseCSV(importText);
      const result = bulkImportGames(Array.isArray(rows) ? rows : [rows]);
      setImportResult(result);

      if (result.success > 0) {
        toast.success(`Imported ${result.success} game(s)`);
        onImportComplete?.();
      } else {
        showUserError('Import had some errors.');
      }
    } catch {
      showUserError('Import failed. Please try again.');
    } finally {
      setIsImporting(false);
    }
  };

  const reset = () => {
    setImportText('');
    setParsedPreview([]);
    setImportResult(null);
    setImportFileName('');
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk Import Games (CSV / JSON)</DialogTitle>
          <DialogDescription>
            Upload or paste data. Columns: name, slug, developer, genres (comma or array), releaseYear, coverImage, publisher.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={importTab} onValueChange={(v) => { setImportTab(v as any); if (importText) processImportText(importText, v as any); }}>
            <TabsList>
              <TabsTrigger value="csv">CSV</TabsTrigger>
              <TabsTrigger value="json">JSON Array</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex gap-3">
            <label className="flex-1 cursor-pointer rounded-md border border-dashed border-border p-6 text-center hover:bg-accent/50">
              <Upload className="mx-auto h-6 w-6 mb-2" />
              <div className="text-sm font-medium">Upload .csv or .json</div>
              <input type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={handleFileUpload} />
              {importFileName && <div className="mt-1 text-xs text-primary">{importFileName}</div>}
            </label>
            <div className="flex-1">
              <Textarea
                placeholder={importTab === 'csv' ? 'name,slug,developer,genres,releaseYear\nCyberpunk 2077,cyberpunk-2077,CDPR,"Action,RPG",2020' : '[{ "name": "New Game", "slug": "new-game" }]'}
                value={importText}
                onChange={(e) => { setImportText(e.target.value); processImportText(e.target.value); }}
                className="h-32 font-mono text-xs"
              />
            </div>
          </div>

          {parsedPreview.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Preview (first rows) — with thumbnails where cover provided</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                {parsedPreview.slice(0, 8).map((row: any, idx: number) => {
                  const cover = row.coverImage || row.cover_url || row.cover || '';
                  const name = row.name || row.Name || 'Game';
                  return (
                    <div key={idx} className="flex items-center gap-2 rounded border bg-background p-1 text-[10px]">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover} alt="" className="h-8 w-6 object-cover rounded border" />
                      ) : (
                        <div className="h-8 w-6 bg-muted rounded border flex items-center justify-center text-[8px] text-muted-foreground">📷</div>
                      )}
                      <div className="truncate font-mono">{name}</div>
                    </div>
                  );
                })}
              </div>
              <pre className="max-h-32 overflow-auto rounded border bg-background p-2 text-[10px]">{JSON.stringify(parsedPreview.slice(0, 4), null, 2)}</pre>
            </div>
          )}

          {importResult && (
            <div className="rounded bg-muted p-3 text-sm">
              Success: <strong>{importResult.success}</strong> • Errors: {importResult.errors.length}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" className="hover:bg-accent/70" onClick={reset}>Reset</Button>
          <Button 
            onClick={runBulkImport} 
            disabled={isImporting || parsedPreview.length === 0}
            className="bg-white text-black font-medium hover:bg-white/90"
          >
            {isImporting ? 'Importing…' : 'Run Import'}
          </Button>
          <Button variant="ghost" className="hover:bg-accent/70" onClick={close}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
