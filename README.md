# Generador QR

Proyecto Node.js local para crear códigos QR a partir de una URL, con color hexadecimal, icono centrado, descarga y almacenamiento en una base SQLite local.

## Requisitos

- Node.js 18 o superior
- npm

## Instalación

```bash
npm install
```

## Arranque

```bash
npm run dev
```

O en modo normal:

```bash
npm start
```

## Funcionalidades

- Genera QR desde una URL válida.
- Permite elegir el color del QR con formato hexadecimal.
- Permite cargar un icono para colocarlo en el centro.
- Descarga el QR como SVG para conservar color e icono.
- Guarda cada generación en `data/qr.sqlite`.

## Estructura

- `server.js`: servidor Express y API.
- `public/`: interfaz web.
- `data/`: base SQLite local.
- `uploads/`: iconos cargados.
