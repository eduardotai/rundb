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
import { parsePaste } from '@/lib/hardware-detector';

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
      // Structured JSON v2 (recommended) — gives exact CPU model, GPU, RAM, OS, resolution.
      // Run in PowerShell, copy the one-line JSON output, paste here. This + browser refresh = full accurate rig.
      cmd: `powershell -NoProfile -Command "$cpu=(Get-CimInstance Win32_Processor|Select -First 1).Name; $gpu=(Get-CimInstance Win32_VideoController|? {$_.AdapterRAM -gt 0}|Select -First 1).Name; $ram=[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB); $os=(Get-CimInstance Win32_OperatingSystem).Caption; $vid=Get-CimInstance Win32_VideoController|Select -First 1; $w=$vid.CurrentHorizontalResolution; $h=$vid.CurrentVerticalResolution; @{rundb=1;cpu=$cpu;gpu=$gpu;ram=$ram;os=$os;resolution=\"\${w}x\${h}\"} | ConvertTo-Json -Compress"`,
      hint: 'Run in PowerShell. Copy the JSON it prints and paste it. Delivers real CPU + RAM + GPU. Browser can still add refresh rate.',
    },
    linux: {
      // ProtonDB gold standard inxi (prose parser supports driver/kernel/distro). For structured JSON use a one-liner emitting {rundb, cpu, gpu, ram, ...}
      cmd: `inxi -Fxxxz`,
      hint: 'Highest-signal Linux path (like ProtonDB). Install inxi if missing. Paste full output. (JSON one-liner alternative also supported.)',
    },
    macos: {
      cmd: `system_profiler -json SPHardwareDataType SPDisplaysDataType`,
      hint: 'Run in Terminal with -json flag for structured parse (vram/resolution via Apple JSON schema).',
    },
    steam: {
      cmd: `Steam → Help → System Information (right-click → Copy all text)`,
      hint: 'Strong cross-platform baseline. Paste the full block (Processor + Video Card sections are most useful).',
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

  const handleParse = () => {
    if (!pasteText.trim()) {
      showUserError('Paste some output first.');
      return;
    }
    setIsParsing(true);
    setTimeout(() => {
      try {
        // Use the robust multi-format parser from hardware-detector (includes strong inxi support)
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
            This is the real way to detect your actual CPU model + exact RAM (browser "Detect" can only give rough hints). Run the one-liner for your OS, paste the output. 100% local, same technique ProtonDB uses.
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
              placeholder="Paste JSON from the one-liner, or inxi/dxdiag/Steam/system_profiler output..."
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
              <div className="font-medium mb-1">Preview (parsed locally)</div>
              <div>CPU: {parsed.cpu || '—'}</div>
              <div>GPU: {parsed.gpu || '—'}</div>
              <div>RAM: {parsed.ram ? `${parsed.ram} GB` : '—'}</div>
              {parsed.vram != null && <div>VRAM: {parsed.vram} GB</div>}
              <div>Resolution: {parsed.resolution || '—'}</div>
              {parsed.refreshRate != null && <div>Refresh: {parsed.refreshRate} Hz</div>}
              {parsed.osVersion && <div>OS: {parsed.osVersion}</div>}
              <div className="text-xs text-muted-foreground mt-1">Confidence: {Math.round(parsed.confidence * 100)}% • method: {parsed.method}</div>
              {parsed.limitations && parsed.limitations.length > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">Limitations: {parsed.limitations.slice(0,2).join('; ')}{parsed.limitations.length > 2 ? '…' : ''}</div>
              )}
            </div>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground pt-2 border-t space-y-1">
          <div>Parsed 100% in your browser. Nothing is sent until you Save.</div>
          <div className="text-[10px] opacity-80">
            Linux tip: <code className="font-mono">inxi -Fxxxz</code> gives the same high-precision data ProtonDB uses (driver, kernel, distro).
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
