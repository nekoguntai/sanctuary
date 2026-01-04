-- Remove unsupported hardware device models
-- These devices don't have USB/QR adapters implemented

DELETE FROM "hardware_device_models" WHERE slug IN ('krux', 'keepkey', 'satochip', 'ngrave-zero');
