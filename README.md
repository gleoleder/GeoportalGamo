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

Para que la página cargue rápido, primero se dibuja `datos.geojson` (GitHub
Pages lo sirve comprimido desde un nodo cercano) y después se pide a Supabase
solo lo que cambió desde esa copia (`geoportal_cambios`, unos pocos KB).

**Tiempo real**: cada edición guardada desde QGIS cambia
`public.geoportal_estado.version`. El geoportal escucha ese cambio con
Supabase Realtime (supabase-js se descarga después de dibujar el mapa), vuelve
a pedir solo los elementos que cambiaron y mantiene abierta la ficha que se
estaba consultando. Si el
canal en tiempo real no está disponible, consulta la versión cada minuto. El
indicador de la barra superior late cuando la conexión en tiempo real está
activa.
`python ejecutar.py` del proyecto PostGIS deja actualizado `datos.geojson`
(opción `GEOPORTAL_DIR` en su `.env`); después hay que publicarlo:

```
git add datos.geojson
git commit -m "Actualizar datos"
git push
```

`convertir_gpkg.py` y la carpeta `geopacage/` corresponden a la versión
anterior (lectura directa de GeoPackage) y ya no generan el formato que usa
la aplicación.

**Edición en la web**: con *Iniciar sesión*, los usuarios autorizados agregan
cámaras, sumideros y tuberías (barra *Agregar* del mapa), editan o eliminan
elementos desde su ficha y suben fotografías (se reducen en el navegador y se
guardan en Supabase Storage). La función `geoportal_editar` de la base verifica el
usuario y valida cada cambio igual que en QGIS; la respuesta trae los
elementos afectados, que se dibujan al instante. Los usuarios se administran
con `usuarios_web.py` del proyecto PostGIS.

La clave anon de `config.js` es pública por diseño: permite leer los datos e
iniciar sesión, pero editar exige un usuario autorizado. Nunca poner aquí la contraseña de la base ni la clave
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
- Tuberías en color único (predeterminado) o por pendiente, con grosor según
  el diámetro y línea discontinua cuando el trazado es inferido; animación
  del sentido del flujo (activa por defecto).
- Pendiente en el sentido del flujo calculada con las cotas de fondo
  (terreno del MDS menos la profundidad medida); etiqueta con signo y flecha
  sobre cada tramo, en rojo las contrapendientes y con borde punteado los
  valores a revisar.
- Rangos de pendiente editables: predeterminados (con clase de
  contrapendiente), cuantiles o límites propios, con cuatro paletas de color
  (la elección se recuerda en el navegador).
- Todo se dibuja en canvas (puntos, líneas y la animación del flujo), sin un
  elemento de la página por punto: el mapa se mueve unas tres veces más rápido
  que con marcadores y la animación casi no consume recursos. Las etiquetas de
  pendiente se crean solo para los tramos visibles.
- Fichas emergentes con todos los atributos depurados, la fotografía de campo
  y las conexiones de cada elemento; las tuberías incluyen un perfil
  longitudinal (terreno, cámaras y fondo de la tubería) y sus cotas.
- En el celular la ficha se abre en una hoja que sube desde abajo (todo el
  ancho, letra y botones grandes): el elemento queda a la vista y marcado
  encima; se agranda arrastrándola hacia arriba y se cierra hacia abajo, con
  la ✕ o tocando el mapa. En la computadora sigue la ventanita sobre el mapa.
- Ficha técnica en PDF: fotografía o perfil, mapa de ubicación preciso
  (teselas y elementos proyectados en EPSG:3857, con el elemento resaltado,
  los vecinos, escala gráfica y norte) y atributos.
- Búsqueda por código o nombre de canal, rutas (OSRM), geolocalización,
  coordenadas UTM 19S del cursor, escala y norte.

## Créditos

- Geogr. John Leonardo Cabrera Espíndola
- Geogr. Luis Freddy Quenta Alegría

La Paz / Oruro, Bolivia
