-- Create public.users table to support user management and unified roles
CREATE TABLE IF NOT EXISTS public.users (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email text NOT NULL UNIQUE,
  full_name text,
  role text NOT NULL DEFAULT 'viewer',
  permissions text,
  created_date timestamptz DEFAULT now(),
  updated_date timestamptz DEFAULT now()
);

-- Disable Row Level Security on users
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

-- Safely copy any existing user roles into the public.users table
INSERT INTO public.users (email, role, full_name, created_date)
SELECT email, role, display_name, created_at
FROM public.user_roles
ON CONFLICT (email) DO UPDATE 
SET 
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name;
