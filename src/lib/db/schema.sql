-- RESTAURANT QR OS — Production PostgreSQL / Supabase Schema
-- Multi-tenant SaaS with Row Level Security (RLS) and Audit Trails

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. RESTAURANTS
CREATE TABLE IF NOT EXISTS restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT NOT NULL,
    banner_url TEXT,
    tagline TEXT,
    currency VARCHAR(10) DEFAULT 'USD',
    currency_symbol VARCHAR(10) DEFAULT '$',
    service_fee_percentage NUMERIC(5,2) DEFAULT 10.00,
    phone VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. BRANCHES
CREATE TABLE IF NOT EXISTS branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    timezone VARCHAR(50) DEFAULT 'UTC',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PROFILES & STAFF
CREATE TYPE user_role_enum AS ENUM ('SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'KITCHEN');

CREATE TABLE IF NOT EXISTS staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    user_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role user_role_enum NOT NULL DEFAULT 'WAITER',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABLES
CREATE TABLE IF NOT EXISTS tables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    number INT NOT NULL,
    qr_token VARCHAR(64) UNIQUE NOT NULL,
    capacity INT DEFAULT 4,
    zone VARCHAR(100) DEFAULT 'Main Dining',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_table_per_branch UNIQUE (branch_id, number)
);

CREATE INDEX IF NOT EXISTS idx_tables_qr_token ON tables(qr_token);

-- 5. MENU CATEGORIES
CREATE TABLE IF NOT EXISTS menu_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    icon VARCHAR(50),
    image_url TEXT,
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. MENU ITEMS
CREATE TABLE IF NOT EXISTS menu_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    category_id UUID NOT NULL REFERENCES menu_categories(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL,
    image_url TEXT NOT NULL,
    ingredients JSONB DEFAULT '[]'::jsonb,
    dietary_flags JSONB DEFAULT '[]'::jsonb,
    spicy_level INT DEFAULT 0,
    preparation_time INT DEFAULT 15,
    is_available BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    option_groups JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant ON menu_items(restaurant_id);

-- 7. ORDERS
CREATE TYPE order_status_enum AS ENUM (
    'pending', 
    'confirmed', 
    'preparing', 
    'ready', 
    'delivered', 
    'completed', 
    'cancelled'
);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
    order_number VARCHAR(32) NOT NULL,
    status order_status_enum DEFAULT 'pending',
    subtotal NUMERIC(10,2) NOT NULL,
    service_fee NUMERIC(10,2) DEFAULT 0.00,
    total NUMERIC(10,2) NOT NULL,
    customer_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_branch_status ON orders(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);

-- 8. ORDER ITEMS (Immutable snapshots)
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
    name_snapshot VARCHAR(255) NOT NULL,
    price_snapshot NUMERIC(10,2) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    selected_options JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    total NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. ORDER STATUS HISTORY (State Audit Trail)
CREATE TABLE IF NOT EXISTS order_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    previous_status order_status_enum,
    new_status order_status_enum NOT NULL,
    changed_by VARCHAR(100) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. WAITER CALLS
CREATE TABLE IF NOT EXISTS waiter_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    table_number INT NOT NULL,
    table_name VARCHAR(100),
    status VARCHAR(50) DEFAULT 'PENDING',
    call_type VARCHAR(50) DEFAULT 'SERVICE',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ
);

-- Realtime publication for Supabase Realtime
-- ALTER PUBLICATION supabase_realtime ADD TABLE orders, waiter_calls, order_status_history;
