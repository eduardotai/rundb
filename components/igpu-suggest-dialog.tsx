'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface IgpuSuggestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name of the iGPU to suggest (canonical). */
  igpuCanonical: string;
  /** Optional CPU name for context. */
  cpuLabel?: string;
  onUse: () => void;
  onPickManually: () => void;
}

/**
 * Non-invasive one-click fill when the user tries to save/submit with empty GPU
 * and the selected CPU has integrated graphics.
 */
export function IgpuSuggestDialog({
  open,
  onOpenChange,
  igpuCanonical,
  cpuLabel,
  onUse,
  onPickManually,
}: IgpuSuggestDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use integrated graphics?</DialogTitle>
          <DialogDescription className="space-y-2 text-left">
            <span className="block">
              {cpuLabel ? (
                <>
                  <span className="font-medium text-foreground">{cpuLabel}</span> includes
                  integrated graphics.
                </>
              ) : (
                <>This CPU includes integrated graphics.</>
              )}
            </span>
            <span className="block">
              You can use{' '}
              <span className="font-medium text-foreground">{igpuCanonical}</span> as your GPU
              for an iGPU-only rig — or pick a GPU manually.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onPickManually}>
            Pick manually
          </Button>
          <Button type="button" onClick={onUse}>
            Use integrated graphics
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
