'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { showUserSuccess, showUserError } from '@/lib/toast';
import { sanitizeFullName } from '@/lib/sanitize';
import { ClipboardCopy } from 'lucide-react';
import type { DetectedHardware } from '@/lib/types';

interface PasteHardwareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (detected: DetectedHardware) => void;
}

export function PasteHardwareModal({ open, onOpenChange, onApply }: PasteHardwareModalProps) {
  const [activeTab, setActiveTab] = useState<'windows' | 'linux' | 'macos' | 'steam'>('windows');
  const [pasteText, setPasteText] = useState('');
  const [parsed, setParsed] = useState<DetectedHardware | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  const EXAMPLES: Record<string, { cmd: string; hint: string }> = {
    windows: {
      cmd: `dxdiag /t %TEMP%\\rundb_dxdiag.txt && type %TEMP%\\rundb_dxdiag.txt`,
      hint: 'Run in Command Prompt or PowerShell. Copy the entire output.',
    },
    linux: {
      cmd: `lspci -v | grep -iE 'vga|3d|display'; lscpu | grep -i 'model name'; free -h | grep Mem; xrandr | grep current`,
      hint: 'Run in terminal. Paste relevant sections.',
    },
    macos: {
      cmd: `system_profiler SPHardwareDataType SPDisplaysDataType`,
      hint: 'Run in Terminal. Look for Chip, Model, Resolution.',
    },
    steam: {
      cmd: `Steam → Help → System Information (copy GPU/CPU/RAM sections)`,
      hint: 'In Steam: Help → System Information. Paste Processor + Video sections.',
    },
  };

  const handleCopy = async () => {
    const example = EXAMPLES[activeTab];
    try {
      await navigator.clipboard.writeText(example.cmd);
      showUserSuccess('Command copied', 'Paste the output (not the command) below.');
    } catch {
      showUserError('Could not copy. Select and copy manually.');
    }
  };

  const parsePaste = (text: string): DetectedHardware => {
    const raw: any = { sourceTextSample: text.slice(0, 280) };
    let cpu: string | undefined;
    let gpu: string | undefined;
    let ram: number | undefined;
    let resolution: string | undefined;
    let confidence = 0.55;
    const limitations: string[] = ['Parsed from pasted text — please review'];

    // dxdiag / common Windows
    const procMatch = text.match(/Processor:\s*(.+?)(?:\n|Memory|Display|$)/i);
    if (procMatch?.[1]) {
      cpu = sanitizeFullName(procMatch[1].replace(/\(.*\)/g, '').trim());
      confidence = Math.max(confidence, 0.88);
    }

    const gpuMatch = text.match(/(?:Card name|Name|Video Card|Chipset Model):\s*(.+?)(?:\n|$)/i);
    if (gpuMatch?.[1]) {
      gpu = sanitizeFullName(gpuMatch[1]);
      confidence = Math.max(confidence, 0.9);
    }

    const ramMatch = text.match(/(?:Memory:\s*|Installed RAM:\s*)(\d+)\s*(MB|GB)/i);
    if (ramMatch) {
      let val = parseInt(ramMatch[1], 10);
      if (ramMatch[2].toUpperCase() === 'MB') val = Math.round(val / 1024);
      if (val >= 4 && val <= 128) ram = val;
    }

    const resMatch = text.match(/(?:Current Resolution|Resolution):\s*(\d+x\d+)/i);
    if (resMatch?.[1]) resolution = resMatch[1];

    // Linux / macOS fallbacks
    if (!cpu) {
      const cpuL = text.match(/model name\s*:\s*(.+)/i) || text.match(/Chip:\s*(.+)/i);
      if (cpuL) cpu = sanitizeFullName(cpuL[1]);
    }
    if (!gpu) {
      const vga = text.match(/VGA compatible.*?:\s*(.+?)(?:\n|$)/i);
      if (vga) gpu = sanitizeFullName(vga[1]);
    }

    if (!cpu && !gpu) {
      limitations.push('Limited info found — try selecting more of the output');
      confidence = 0.35;
    }

    return {
      cpu,
      gpu,
      ram,
      resolution,
      raw,
      method: 'paste',
      confidence: Math.min(0.96, Math.max(0.3, confidence)),
      timestamp: new Date().toISOString(),
      limitations,
    };
  };

  const handleParse = () => {
    if (!pasteText.trim()) {
      showUserError('Paste some output first.');
      return;
    }
    setIsParsing(true);
    setTimeout(() => {
      try {
        const result = parsePaste(pasteText);
        setParsed(result);
        showUserSuccess('Parsed', `Confidence ${Math.round(result.confidence * 100)}%`);
      } catch {
        showUserError('Could not parse. Try more of the output.');
        setParsed(null);
      } finally {
        setIsParsing(false);
      }
    }, 80);
  };

  const handleApply = () => {
    if (!parsed) return;
    onApply(parsed);
    setPasteText('');
    setParsed(null);
    onOpenChange(false);
  };

  const handleClose = () => {
    setPasteText('');
    setParsed(null);
    onOpenChange(false);
  };

  const currentExample = EXAMPLES[activeTab];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl !bg-[#111827] border-[#334155]">
        <DialogHeader>
          <DialogTitle>Paste Hardware Output (Most Accurate)</DialogTitle>
          <DialogDescription>
            Run a native command or Steam System Information. Parsed locally in your browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
            <TabsList className="grid grid-cols-4">
              <TabsTrigger value="windows">Windows</TabsTrigger>
              <TabsTrigger value="linux">Linux</TabsTrigger>
              <TabsTrigger value="macos">macOS</TabsTrigger>
              <TabsTrigger value="steam">Steam</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center justify-between rounded border border-dashed p-3 text-xs">
            <div>
              <div className="font-medium">{currentExample.hint}</div>
              <code className="block font-mono text-[10px] text-muted-foreground break-all mt-0.5">{currentExample.cmd}</code>
            </div>
            <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 shrink-0">
              <ClipboardCopy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>

          <div>
            <div className="mb-1.5 flex justify-between text-xs">
              <span className="font-medium text-muted-foreground">Paste output here</span>
              <Button variant="ghost" size="sm" onClick={() => { setPasteText(''); setParsed(null); }} className="h-6 text-[10px]">Clear</Button>
            </div>
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste dxdiag, lspci, system_profiler, or Steam System Information output..."
              className="h-40 font-mono text-sm"
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleParse} disabled={isParsing || !pasteText.trim()} className="flex-1">
              {isParsing ? 'Parsing...' : 'Parse Output'}
            </Button>
            <Button onClick={handleApply} disabled={!parsed} variant="default" className="flex-1">
              Apply to Form
            </Button>
          </div>

          {parsed && (
            <div className="rounded border bg-background/50 p-3 text-sm">
              <div className="font-medium mb-1">Preview</div>
              <div>CPU: {parsed.cpu || '—'}</div>
              <div>GPU: {parsed.gpu || '—'}</div>
              <div>RAM: {parsed.ram ? `${parsed.ram} GB` : '—'}</div>
              <div>Resolution: {parsed.resolution || '—'}</div>
              <div className="text-xs text-muted-foreground mt-1">Confidence: {Math.round(parsed.confidence * 100)}%</div>
            </div>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground pt-2 border-t">
          Parsed 100% in your browser. Nothing is sent until you Save your rig.
        </div>
      </DialogContent>
    </Dialog>
  );
}
