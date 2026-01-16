import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-primary-600">
              🔑 Imagen a Llavero 3D
            </h1>
            <nav className="flex gap-4">
              <Link href="/crear-llavero" className="text-gray-600 hover:text-primary-600">
                Crear
              </Link>
              <Link href="/galeria" className="text-gray-600 hover:text-primary-600">
                Galería
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-5xl font-bold text-gray-900 mb-6">
            Convierte tu logo en un<br />
            <span className="text-primary-600">llavero 3D imprimible</span>
          </h2>
          
          <p className="text-xl text-gray-600 mb-8">
            Sube tu imagen y obtén un archivo STL listo para imprimir en menos de 30 segundos
          </p>

          <div className="flex justify-center gap-4 mb-12">
            <Link
              href="/crear-llavero"
              className="px-8 py-4 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 transition-colors shadow-lg hover:shadow-xl"
            >
              Crear Llavero Ahora →
            </Link>
            <Link
              href="#como-funciona"
              className="px-8 py-4 bg-white text-primary-600 rounded-lg font-semibold hover:bg-gray-50 transition-colors shadow"
            >
              Cómo Funciona
            </Link>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-8 mt-16">
            <div className="bg-white p-6 rounded-xl shadow-md">
              <div className="text-4xl mb-4">⚡</div>
              <h3 className="text-xl font-bold mb-2">Súper Rápido</h3>
              <p className="text-gray-600">
                Genera tu STL en menos de 30 segundos
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-md">
              <div className="text-4xl mb-4">🎨</div>
              <h3 className="text-xl font-bold mb-2">Personalizable</h3>
              <p className="text-gray-600">
                Ajusta tamaño, grosor y posición del aro
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-md">
              <div className="text-4xl mb-4">👁️</div>
              <h3 className="text-xl font-bold mb-2">Preview 3D</h3>
              <p className="text-gray-600">
                Visualiza tu diseño antes de descargar
              </p>
            </div>
          </div>
        </div>

        {/* Como funciona */}
        <div id="como-funciona" className="max-w-4xl mx-auto mt-24">
          <h3 className="text-3xl font-bold text-center mb-12">
            ¿Cómo Funciona?
          </h3>
          
          <div className="grid md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-600">
                1
              </div>
              <h4 className="font-bold mb-2">Sube tu Imagen</h4>
              <p className="text-sm text-gray-600">PNG o JPG de tu logo</p>
            </div>

            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-600">
                2
              </div>
              <h4 className="font-bold mb-2">Ajusta Parámetros</h4>
              <p className="text-sm text-gray-600">Tamaño, grosor, aro</p>
            </div>

            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-600">
                3
              </div>
              <h4 className="font-bold mb-2">Preview 3D</h4>
              <p className="text-sm text-gray-600">Verifica el resultado</p>
            </div>

            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-600">
                4
              </div>
              <h4 className="font-bold mb-2">Descarga STL</h4>
              <p className="text-sm text-gray-600">Listo para imprimir</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-16">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center text-gray-600">
            <p>© 2026 Imagen a Llavero 3D - Hecho con ❤️ para makers</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
