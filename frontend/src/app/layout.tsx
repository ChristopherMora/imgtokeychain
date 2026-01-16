import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Imagen a Llavero 3D',
  description: 'Convierte tu imagen en un llavero 3D imprimible en segundos',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        {children}
      </body>
    </html>
  )
}
