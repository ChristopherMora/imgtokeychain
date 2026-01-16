-- =============================================================================
-- Script de inicialización de la base de datos
-- =============================================================================

-- Crear extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla de jobs (trabajos de conversión)
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    error_message TEXT,
    
    -- Parámetros de entrada
    original_filename VARCHAR(255) NOT NULL,
    file_size INTEGER NOT NULL,
    width_mm DECIMAL(10,2),
    height_mm DECIMAL(10,2),
    thickness_mm DECIMAL(10,2),
    
    -- Configuración del aro
    ring_enabled BOOLEAN DEFAULT false,
    ring_diameter_mm DECIMAL(10,2),
    ring_thickness_mm DECIMAL(10,2),
    ring_position VARCHAR(20),
    
    -- Rutas de archivos
    input_path VARCHAR(500),
    processed_image_path VARCHAR(500),
    svg_path VARCHAR(500),
    stl_path VARCHAR(500),
    
    -- Metadatos
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    
    -- Índices para búsqueda rápida
    CONSTRAINT check_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

-- Índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);

-- Tabla de usuarios (opcional para MVP, útil para futuro)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE,
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- Relación opcional entre jobs y usuarios
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- Función para actualizar timestamp automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para actualizar updated_at
DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at
    BEFORE UPDATE ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Seed data inicial (opcional)
-- INSERT INTO users (email, name) VALUES ('demo@imgtokey.com', 'Usuario Demo');

COMMENT ON TABLE jobs IS 'Trabajos de conversión de imagen a STL';
COMMENT ON TABLE users IS 'Usuarios del sistema';
