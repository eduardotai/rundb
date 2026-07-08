import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferCpuIgpuFields,
  enrichEntryWithIgpu,
  resolveIgpuForCpu,
  shouldOfferIgpuOnEmptyGpu,
  IGPU_CANONICAL,
} from './cpu-igpu';
import type { HardwareCatalogEntry } from './types';
import { getAllHardwareCatalog } from './hardware-catalog';

describe('inferCpuIgpuFields', () => {
  it('maps Ryzen 5 5600G to Vega 7', () => {
    const r = inferCpuIgpuFields('AMD Ryzen 5 5600G', 'AMD');
    assert.equal(r.hasIgpu, true);
    if (r.hasIgpu) assert.equal(r.igpuCanonical, IGPU_CANONICAL.VEGA_7);
  });

  it('maps Ryzen 7 8700G to 780M', () => {
    const r = inferCpuIgpuFields('AMD Ryzen 7 8700G', 'AMD');
    assert.equal(r.hasIgpu, true);
    if (r.hasIgpu) assert.equal(r.igpuCanonical, IGPU_CANONICAL.Radeon_780M);
  });

  it('maps AM5 X3D desktop to Radeon Graphics', () => {
    const r = inferCpuIgpuFields('AMD Ryzen 7 7800X3D', 'AMD');
    assert.equal(r.hasIgpu, true);
    if (r.hasIgpu) assert.equal(r.igpuCanonical, IGPU_CANONICAL.RADEON_GRAPHICS);
  });

  it('maps AM4 non-G to no iGPU', () => {
    const r = inferCpuIgpuFields('AMD Ryzen 5 5600X', 'AMD');
    assert.equal(r.hasIgpu, false);
  });

  it('maps Intel F-series to no iGPU', () => {
    assert.equal(inferCpuIgpuFields('Intel Core i5-12400F', 'Intel').hasIgpu, false);
    assert.equal(inferCpuIgpuFields('Intel Core i7-14700KF', 'Intel').hasIgpu, false);
  });

  it('maps Intel i5-12400 to UHD 730', () => {
    const r = inferCpuIgpuFields('Intel Core i5-12400', 'Intel');
    assert.equal(r.hasIgpu, true);
    if (r.hasIgpu) assert.equal(r.igpuCanonical, IGPU_CANONICAL.UHD_730);
  });

  it('maps Intel K non-F to UHD 770', () => {
    const r = inferCpuIgpuFields('Intel Core i5-13600K', 'Intel');
    assert.equal(r.hasIgpu, true);
    if (r.hasIgpu) assert.equal(r.igpuCanonical, IGPU_CANONICAL.UHD_770);
  });

  it('maps Core Ultra to Arc Graphics', () => {
    const r = inferCpuIgpuFields('Intel Core Ultra 7 265K', 'Intel');
    assert.equal(r.hasIgpu, true);
    if (r.hasIgpu) assert.equal(r.igpuCanonical, IGPU_CANONICAL.ARC_IGPU);
  });
});

describe('enrichEntryWithIgpu', () => {
  it('preserves explicit structured fields', () => {
    const entry: HardwareCatalogEntry = {
      canonical: 'AMD Ryzen 5 5600G',
      componentType: 'cpu',
      vendor: 'AMD',
      series: 'Zen 3',
      source: 'test',
      lastUpdated: '2026-07-08',
      hasIgpu: true,
      igpuCanonical: 'AMD Radeon Vega 7 Graphics',
    };
    const enriched = enrichEntryWithIgpu(entry);
    assert.equal(enriched.hasIgpu, true);
    assert.equal(enriched.igpuCanonical, 'AMD Radeon Vega 7 Graphics');
  });

  it('fills missing fields via inference', () => {
    const entry: HardwareCatalogEntry = {
      canonical: 'Intel Core i5-12400F',
      componentType: 'cpu',
      vendor: 'Intel',
      series: 'Alder Lake',
      source: 'test',
      lastUpdated: '2026-07-08',
    };
    const enriched = enrichEntryWithIgpu(entry);
    assert.equal(enriched.hasIgpu, false);
  });

  it('leaves GPUs unchanged', () => {
    const entry: HardwareCatalogEntry = {
      canonical: 'NVIDIA GeForce RTX 4070',
      componentType: 'gpu',
      vendor: 'NVIDIA',
      series: 'RTX 40',
      source: 'test',
      lastUpdated: '2026-07-08',
    };
    assert.equal(enrichEntryWithIgpu(entry), entry);
  });
});

describe('resolveIgpuForCpu + catalog', () => {
  const catalog = getAllHardwareCatalog();

  it('resolves 5600G against live catalog with iGPU GPU row present', () => {
    const r = resolveIgpuForCpu('AMD Ryzen 5 5600G', catalog);
    assert.ok(r);
    assert.equal(r!.hasIgpu, true);
    if (r!.hasIgpu) {
      assert.equal(r!.igpuCanonical, IGPU_CANONICAL.VEGA_7);
      assert.ok(r!.igpuEntry, 'iGPU should exist as GPU catalog entry');
      assert.equal(r!.igpuEntry!.componentType, 'gpu');
    }
  });

  it('offers one-click only when GPU empty and CPU has iGPU', () => {
    const offer = shouldOfferIgpuOnEmptyGpu('AMD Ryzen 5 5600G', '', catalog);
    assert.equal(offer.offer, true);
    if (offer.offer) assert.equal(offer.igpuCanonical, IGPU_CANONICAL.VEGA_7);

    const noOffer = shouldOfferIgpuOnEmptyGpu(
      'AMD Ryzen 5 5600G',
      'NVIDIA GeForce RTX 4070',
      catalog
    );
    assert.equal(noOffer.offer, false);

    const fSeries = shouldOfferIgpuOnEmptyGpu('Intel Core i5-12400F', '', catalog);
    assert.equal(fSeries.offer, false);
  });

  it('enriched catalog CPUs all have explicit hasIgpu boolean', () => {
    const cpus = catalog.filter((e) => e.componentType === 'cpu');
    assert.ok(cpus.length > 50);
    for (const cpu of cpus) {
      assert.equal(typeof cpu.hasIgpu, 'boolean', cpu.canonical);
      if (cpu.hasIgpu) {
        assert.ok(cpu.igpuCanonical, `missing igpuCanonical on ${cpu.canonical}`);
        const gpu = catalog.find((g) => g.canonical === cpu.igpuCanonical);
        assert.ok(gpu, `iGPU row missing for ${cpu.canonical} → ${cpu.igpuCanonical}`);
      }
    }
  });
});
