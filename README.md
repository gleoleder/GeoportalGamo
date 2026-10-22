# Geoportal GAMO — Sistema de drenaje mixto del Casco Viejo de Oruro

Mapa web de consulta del sistema de drenaje mixto del Casco Viejo de Oruro:
cámaras de inspección, sumideros, tuberías, canales y sus secciones
levantadas, con el estado, la condición y el nivel de certeza de cada
elemento (relevamiento de campo de julio de 2025).

Publicado en https://gleoleder.github.io/GeoportalGamo/

## Contenido

- `index.html`, `styles.css`, `script.js` — la aplicación (Leaflet 1.9 y jsPDF).
- `config.js` — URL y clave anon de Supabase (vacías = usar `datos.geojson`).
- `datos.geojson` — copia local de las capas, usada si Supabase no responde.
- `ABRIR_GEOPORTAL.bat` — abre el geoportal con un servidor local.

## Datos

Las capas provienen de la base PostGIS depurada del proyecto
`DRENAJE_ORURO_POSTGIS`. El geoportal llama a la función de solo lectura
`geoportal_datos` (`POST /rest/v1/rpc/geoportal_datos`), que devuelve en
GeoJSON (EPSG:4326) las capas `camaras`, `sumideros`, `tuberias_camaras`,
`tuberias_sumideros`, `canales`, `progresivas` y `area`, más un resumen del
proceso.

Para actualizar la copia local después de reprocesar la base:

```
copy ..\DRENAJE_ORURO_POSTGIS\resultados\geoportal.geojson datos.geojson
```

`convertir_gpkg.py` y la carpeta `geopacage/` corresponden a la versión
anterior (lectura directa de GeoPackage) y ya no generan el formato que usa
la aplicación.

La clave anon de `config.js` es pública por diseño: solo permite ejecutar la
función de lectura. Nunca poner aquí la contraseña de la base ni la clave
service_role.

## Cómo usar en local

Abrir **`ABRIR_GEOPORTAL.bat`** (levanta un servidor local y abre el navegador).
No abrir `index.html` con doble clic: `fetch()` no funciona sobre `file://`.

## Funciones

- Panel con pestañas: capas, búsqueda, resumen, rutas y notas metodológicas.
- Simbolización seleccionable: cámaras por accesibilidad, estado físico,
  funcionamiento, condición interior o certeza; sumideros por condición,
  estado o certeza; secciones de canal por estado estructural o certeza.
- Leyendas con el número de elementos por categoría.
- Tuberías con grosor según el diámetro y línea discontinua cuando el trazado
  es inferido; animación opcional del sentido del flujo.
- Fichas emergentes con todos los atributos depurados, la fotografía de campo
  y las conexiones de cada elemento.
- Ficha técnica en PDF (fotografía, mapa de ubicación y atributos).
- Búsqueda por código o nombre de canal, rutas (OSRM), geolocalización,
  coordenadas UTM 19S del cursor, escala y norte.

## Créditos

- Geogr. John Leonardo Cabrera Espíndola
- Geogr. Luis Freddy Quenta Alegría

La Paz / Oruro, Bolivia
