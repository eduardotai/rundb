-- Optional iGPU columns on hardware_catalog (CPU → integrated GPU linkage)
-- Idempotent. Static catalog works without this; apply when using live DB overrides.

ALTER TABLE hardware_catalog
  ADD COLUMN IF NOT EXISTS has_igpu boolean;

ALTER TABLE hardware_catalog
  ADD COLUMN IF NOT EXISTS igpu_canonical text;

COMMENT ON COLUMN hardware_catalog.has_igpu IS 'CPU only: whether the SKU includes integrated graphics';
COMMENT ON COLUMN hardware_catalog.igpu_canonical IS 'CPU only: canonical GPU catalog name for the iGPU when has_igpu is true';
