'use client';

import { useCallback, useState } from 'react';
import type { DetectedHardware } from '@/lib/types';
import { mergeDetected } from '@/lib/hardware-detector';

export type DetectionUiState = 'idle' | 'detecting' | 'detected' | 'applied';

/**
 * Shared detect → review → apply state machine for hardware identification
 * surfaces (submit dialog, compatibility checker). Pairs with
 * HardwareDetectButton + DetectedHardwareBanner + PasteHardwareModal.
 *
 * Detection is never auto-applied: results land in `detectedRig` for the review
 * banner, and only `applyDetected` (user action) writes into the surface via the
 * provided callback. Paste results are merged with any prior browser detection
 * and applied directly (the paste modal is itself the review step).
 */
export function useHardwareDetection(applyToSurface: (detected: DetectedHardware) => void) {
  const [detectedRig, setDetectedRig] = useState<DetectedHardware | null>(null);
  const [detectionState, setDetectionState] = useState<DetectionUiState>('idle');
  const [pasteModalOpen, setPasteModalOpen] = useState(false);

  const handleDetected = useCallback((result: DetectedHardware) => {
    setDetectedRig(result);
    setDetectionState('detected');
  }, []);

  const applyDetected = useCallback(
    (detected: DetectedHardware) => {
      applyToSurface(detected);
      setDetectionState('applied');
      setDetectedRig(null);
    },
    [applyToSurface]
  );

  const clearDetection = useCallback(() => {
    setDetectedRig(null);
    setDetectionState('idle');
  }, []);

  const refineDetection = useCallback(() => setDetectedRig(null), []);

  const openPasteModal = useCallback(() => setPasteModalOpen(true), []);

  const handlePasteApply = useCallback(
    (pasteDetected: DetectedHardware) => {
      applyDetected(mergeDetected(detectedRig, pasteDetected));
      setPasteModalOpen(false);
    },
    [applyDetected, detectedRig]
  );

  return {
    detectedRig,
    detectionState,
    pasteModalOpen,
    setPasteModalOpen,
    handleDetected,
    applyDetected,
    clearDetection,
    refineDetection,
    openPasteModal,
    handlePasteApply,
  };
}
