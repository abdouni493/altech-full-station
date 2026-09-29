-- ─── CREATE PRODUCTS & PRODUCT-IMAGES STORAGE BUCKETS IN SUPABASE ───────────
-- Executes bucket creation and sets RLS policies allowing public reads and uploads.

-- 1. Create the 'products' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('products', 'products', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Create the 'product-images' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Policy for public access (Read)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Public Access for products bucket'
  ) THEN
    CREATE POLICY "Public Access for products bucket"
    ON storage.objects FOR SELECT
    USING (bucket_id IN ('products', 'product-images'));
  END IF;
END $$;

-- 4. Policy for public uploads (Insert)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Public Upload for products bucket'
  ) THEN
    CREATE POLICY "Public Upload for products bucket"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id IN ('products', 'product-images'));
  END IF;
END $$;

-- 5. Policy for updates & deletes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Public Update/Delete for products bucket'
  ) THEN
    CREATE POLICY "Public Update/Delete for products bucket"
    ON storage.objects FOR ALL
    USING (bucket_id IN ('products', 'product-images'));
  END IF;
END $$;
