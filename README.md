# Geoportal GAMO — Sistema de Drenaje Pluvial (Oruro)

Mapa web interactivo del sistema de drenaje pluvial del casco viejo de Oruro:
cámaras de inspección, sumideros y tuberías. Los datos se leen directamente
desde GeoPackage (convertidos a GeoJSON) — no requiere base de datos en la nube.

## Contenido

- `index.html`, `script.js`, `styles.css` — la aplicación web (Leaflet).
- `datos.geojson` — datos de las 4 capas reproyectados a WGS84 (lat/lon).
- `geopacage/` — GeoPackage originales (EPSG:32719, UTM 19S).
- `convertir_gpkg.py` — regenera `datos.geojson` desde los `.gpkg`.
- `ABRIR_GEOPORTAL.bat` — abre el geoportal con un servidor local.

## Cómo usar

Abrir **`ABRIR_GEOPORTAL.bat`** (levanta un servidor local y abre el navegador).
No abrir `index.html` con doble clic: `fetch()` no funciona sobre `file://`.

## Actualizar los datos

Si cambian los GeoPackage en `geopacage/`, regenerar el GeoJSON:

```
python convertir_gpkg.py
```

Requiere `pyproj` (`pip install pyproj`).

## Funciones

- 4 capas que se prenden/apagan: cámaras, sumideros, tuberías de cámaras y de sumideros.
- Simbología por accesibilidad (cámaras) y símbolo propio para sumideros.
- Grosor de tubería proporcional al diámetro.
- Animación del flujo de agua en el sentido ORIGEN → DESTINO.
- Popups con foto (Google Drive), datos técnicos y ficha técnica en PDF.
- Cálculo de rutas y geolocalización.

## Créditos

- Geogr. John Leonardo Cabrera Espíndola
- Geogr. Luis Freddy Quenta Alegría

La Paz / Oruro, Bolivia
