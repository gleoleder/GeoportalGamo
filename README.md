# Geoportal GAMO — Sistema de Drenaje Pluvial (Oruro)

Mapa web interactivo del sistema de drenaje pluvial del casco viejo de Oruro:
cámaras de inspección, sumideros y tuberías. Los datos se leen de la base
PostGIS del proyecto en Supabase y, si no está configurada o no responde,
de `datos.geojson`.

## Contenido

- `index.html`, `script.js`, `styles.css` — la aplicación web (Leaflet).
- `config.js` — URL y clave anon de Supabase (vacías = usar `datos.geojson`).
- `datos.geojson` — datos de las 4 capas reproyectados a WGS84 (lat/lon).
- `geopacage/` — GeoPackage originales (EPSG:32719, UTM 19S).
- `convertir_gpkg.py` — regenera `datos.geojson` desde los `.gpkg`.
- `ABRIR_GEOPORTAL.bat` — abre el geoportal con un servidor local.

## Cómo usar

Abrir **`ABRIR_GEOPORTAL.bat`** (levanta un servidor local y abre el navegador).
No abrir `index.html` con doble clic: `fetch()` no funciona sobre `file://`.

## Conectar con Supabase

La base depurada se construye con el proyecto `DRENAJE_ORURO_POSTGIS`, que
publica la función `geoportal_capas()`. Para leerla, completar `config.js`:

```js
window.GEOPORTAL_CONFIG = {
    supabaseUrl: 'https://TU_PROYECTO.supabase.co',
    supabaseAnonKey: 'clave anon o publishable'
};
```

La clave anon es pública por diseño: solo permite ejecutar esa función de
lectura. Nunca poner aquí la contraseña de la base ni la clave service_role.

## Actualizar los datos sin Supabase

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
