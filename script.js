// =====================================================================
// Geoportal del drenaje mixto del Casco Viejo de Oruro
// Lee la base PostGIS del proyecto (Supabase, función geoportal_datos)
// o, sin conexión, la copia local datos.geojson.
// =====================================================================

let map;
let userLocation = null;
let routeLayers = [];
let origenMarker = null;
let destinoMarker = null;
let seleccionandoPunto = null;
let currentRoutes = [];
let flujoActivo = true;
const flujos = {};
let lienzos = {};
let lienzoFlujo = null;
let resumenDatos = null;
let fuenteDatos = '';

// ---------------------------------------------------------------------
// Paleta y temas de simbolización
// ---------------------------------------------------------------------
const SIN_DATO = '#aab4be';
const ESTADO = [
    ['BUENO', 'Bueno', '#2f7d5c'],
    ['REGULAR', 'Regular', '#c39233'],
    ['MALO', 'Malo', '#a8423a']
];
const CONDICION = [
    ['LIMPIO', 'Limpio', '#2f7d5c'],
    ['SEDIMENTADO', 'Sedimentado', '#c39233'],
    ['COLMATADO', 'Colmatado', '#a8423a'],
    ['OBSTRUIDO', 'Obstruido', '#6e2a33']
];
const CERTEZA = [
    ['CONFIRMADO', 'Confirmado', '#1d5a85'],
    ['PROBABLE', 'Probable', '#5f93bd'],
    ['INFERIDO', 'Inferido', '#a9bfd3'],
    ['NO DETERMINADO', 'No determinado', '#d3dbe3']
];
const ACCESIBILIDAD = [
    ['ACCESIBLE OPERATIVO', 'Accesible operativa', '#2f7d5c'],
    ['ACCESIBLE CON DIFICULTAD', 'Accesible con dificultad', '#c39233'],
    ['NO ACCESIBLE', 'No accesible', '#a8423a'],
    ['INFERIDO', 'Inferida', '#7f8b97']
];
// Rangos de pendiente (%) configurables desde el panel. Cada rango es
// [mínimo incluido, máximo excluido, rótulo, color].
const PALETAS_PENDIENTE = {
    riesgo: { nombre: 'Rojo a azul', colores: ['#a8423a', '#d29b3d', '#6fa6cf', '#2f6f9f', '#173f5f'] },
    semaforo: { nombre: 'Rojo a verde', colores: ['#a8423a', '#d98c3f', '#d9c45a', '#7fb069', '#2f7d5c'] },
    azules: { nombre: 'Azules', colores: ['#cfe1f0', '#94bddd', '#5a96c6', '#2f6f9f', '#163f61'] },
    calido: { nombre: 'Amarillo a morado', colores: ['#f0cf6a', '#e68f4f', '#c4505a', '#7e3b6f', '#3b2a55'] }
};
// La pendiente tiene signo (sentido del flujo): bajo 0 % hay contrapendiente.
const LIMITES_PREDETERMINADOS = [0, 0.5, 2, 5, 10];
const CLAVE_RANGOS = 'geoportal.pendiente.v2';
let configPendiente = { modo: 'predeterminado', limites: LIMITES_PREDETERMINADOS, paleta: 'riesgo' };
try {
    const guardada = JSON.parse(localStorage.getItem(CLAVE_RANGOS) || 'null');
    if (guardada && Array.isArray(guardada.limites) && PALETAS_PENDIENTE[guardada.paleta]) configPendiente = guardada;
} catch (e) { /* sin almacenamiento local: se usan los valores predeterminados */ }

function interpolarColores(colores, n) {
    if (n === colores.length) return colores.slice();
    const rgb = colores.map(c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)));
    return Array.from({ length: n }, (_, i) => {
        const t = n === 1 ? 0 : i / (n - 1) * (rgb.length - 1);
        const a = Math.floor(t), b = Math.min(a + 1, rgb.length - 1), f = t - a;
        return '#' + rgb[a].map((v, k) => Math.round(v + (rgb[b][k] - v) * f).toString(16).padStart(2, '0')).join('');
    });
}

function textoLimite(v) {
    const dec = Number.isInteger(v) ? 0 : Number.isInteger(v * 10) ? 1 : 2;
    return Number(v).toLocaleString('es-BO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function construirRangos(limites, paleta) {
    const colores = interpolarColores(PALETAS_PENDIENTE[paleta].colores, limites.length + 1);
    const bordes = [-Infinity, ...limites, Infinity];
    return colores.map((color, i) => {
        const min = bordes[i], max = bordes[i + 1];
        const rotulo = min === -Infinity && max === 0 ? 'Contrapendiente (menor a 0 %)'
            : min === -Infinity ? `Menor a ${textoLimite(max)} %`
            : max === Infinity ? `${textoLimite(min)} % o más`
            : `${textoLimite(min)} – ${textoLimite(max)} %`;
        return [min, max, rotulo, color];
    });
}

let PENDIENTE = construirRangos(configPendiente.limites, configPendiente.paleta);

function rangoDe(rangos, v) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return null;
    return rangos.find(([min, max]) => Number(v) >= min && Number(v) < max) || null;
}

function colorPendiente(v) {
    const r = rangoDe(PENDIENTE, v);
    return r ? r[3] : SIN_DATO;
}

const TEMAS = {
    camaras: {
        accesibilidad: { titulo: 'Accesibilidad', clases: ACCESIBILIDAD },
        estado_fisico: { titulo: 'Estado físico', clases: ESTADO },
        funcionamiento_drenaje: { titulo: 'Funcionamiento del drenaje', clases: ESTADO },
        condicion_interior: { titulo: 'Condición interior', clases: CONDICION },
        nivel_certeza: { titulo: 'Nivel de certeza', clases: CERTEZA }
    },
    sumideros: {
        condicion: { titulo: 'Condición de funcionamiento', clases: CONDICION },
        estado_estructura: { titulo: 'Estado de la estructura', clases: ESTADO },
        estado_rejilla: { titulo: 'Estado de la rejilla', clases: ESTADO },
        nivel_certeza: { titulo: 'Nivel de certeza', clases: CERTEZA }
    },
    progresivas: {
        estado_estructural: { titulo: 'Estado estructural', clases: ESTADO },
        nivel_certeza: { titulo: 'Nivel de certeza', clases: CERTEZA }
    },
    tuberias_camaras: {
        unico: { titulo: 'Color único', unico: true },
        pendiente_pct: { titulo: 'Pendiente en el sentido del flujo', rangos: PENDIENTE }
    },
    tuberias_sumideros: {
        unico: { titulo: 'Color único', unico: true },
        pendiente_pct: { titulo: 'Pendiente en el sentido del flujo', rangos: PENDIENTE }
    }
};

const CAPAS = {
    camaras: { nombre: 'Cámaras de inspección', grupo: 'Red de drenaje', tipo: 'punto', tema: 'accesibilidad', pane: 'pCamaras' },
    sumideros: { nombre: 'Sumideros', grupo: 'Red de drenaje', tipo: 'punto', tema: 'condicion', pane: 'pSumideros' },
    tuberias_camaras: { nombre: 'Tuberías de cámaras', grupo: 'Red de drenaje', tipo: 'linea', tema: 'unico', pane: 'pTuberias', color: '#24577a', zoomEtiquetas: 17 },
    tuberias_sumideros: { nombre: 'Tuberías de sumideros', grupo: 'Red de drenaje', tipo: 'linea', tema: 'unico', pane: 'pTuberias', color: '#5c9bc8', zoomEtiquetas: 19 },
    canales: { nombre: 'Ejes de canales', grupo: 'Canales', tipo: 'linea', pane: 'pCanales', color: '#127369' },
    progresivas: { nombre: 'Secciones levantadas', grupo: 'Canales', tipo: 'punto', tema: 'estado_estructural', pane: 'pProgresivas', zoomMin: 16 },
    area: { nombre: 'Área de estudio', grupo: 'Referencia', tipo: 'poligono', pane: 'pArea', color: '#13283b' }
};
const ORDEN_PANEL = ['camaras', 'sumideros', 'tuberias_camaras', 'tuberias_sumideros', 'canales', 'progresivas', 'area'];

// Registro de entidades por capa: { props, capa, layer, latlng }
const registro = {};
const grupos = {};
const visibles = {};
const etiquetas = {};
let etiquetasActivas = true;

// ---------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------
const NOMBRES_CANAL = {
    'ZANJA DE CORONACION': 'Zanja de coronación',
    'AV. MONTES Y AV. PANORAMICA': 'Av. Montes y Av. Panorámica',
    'AV. SAN JOSE': 'Av. San José',
    'AV. TTE. LEON': 'Av. Tte. León',
    '6 DE OCTUBRE': '6 de Octubre',
    'AV. HEROES DEL CHACO': 'Av. Héroes del Chaco',
    '1 DE NOVIEMBRE': '1 de Noviembre',
    'AV. VILLARROEL': 'Av. Villarroel',
    'SGTO. FLORES': 'Sgto. Flores',
    'CAMINO A LA VIRGEN': 'Camino a la Virgen',
    'CANAL VELASCO GALVARRO': 'Velasco Galvarro'
};

const ETIQUETAS = {
    'MIXTO': 'Mixto (pluvial y sanitario)',
    'VIA': 'Vía',
    'ADOQUIN': 'Adoquín',
    'HORMIGON': 'Hormigón',
    'HORMIGON CICLOPEO': 'Hormigón ciclópeo',
    'HORMIGON ARMADO': 'Hormigón armado',
    'PVC': 'PVC',
    'METALICO': 'Metálico',
    'NINGUNA': 'Ninguna',
    'GEOMETRIA': 'Por conexión geométrica',
    'CODIGO': 'Por código de campo',
    'SIN RESOLVER': 'Sin resolver',
    'CAMARA': 'Cámara de inspección',
    'SUMIDERO': 'Sumidero',
    'TUBERIA': 'Tubería de cámara',
    'CANAL': 'Canal',
    'RED': 'Red principal (sin identificar)',
    'NO RESUELTO': 'Sin determinar',
    'OBSERVADA': 'Observada directamente',
    'ESTIMADA': 'Estimada (sin acceso al interior)',
    'OTRA': 'Otra codificación',
    'COTAS DE FONDO': 'Cotas de fondo (terreno menos profundidad)',
    'TERRENO ENTRE CAMARAS': 'Terreno entre cámaras (sin profundidades)',
    'MDS': 'Modelo digital de superficie',
    'INTERPOLADA': 'Interpolada (elemento editado; falta muestrear el MDS)',
    'EDICION': 'Edición en QGIS'
};

function esc(v) {
    return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nombreCanal(v) {
    return NOMBRES_CANAL[v] || v;
}

function etiqueta(v) {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v);
    if (ETIQUETAS[s]) return ETIQUETAS[s];
    if (NOMBRES_CANAL[s]) return NOMBRES_CANAL[s];
    for (const tema of [ESTADO, CONDICION, CERTEZA, ACCESIBILIDAD]) {
        const c = tema.find(([valor]) => valor === s);
        if (c) return c[1];
    }
    const t = s.toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
}

function numero(v, decimales = 2) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return null;
    return Number(v).toLocaleString('es-BO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

function conUnidad(v, unidad, decimales = 2) {
    const n = numero(v, decimales);
    return n === null ? null : `${n} ${unidad}`;
}

function siNo(v) {
    if (v === true) return 'Sí';
    if (v === false) return 'No';
    return null;
}

function fecha(v) {
    if (!v) return null;
    const [a, m, d] = String(v).split('-');
    return d ? `${d}/${m}/${a}` : v;
}

function conCanales(texto) {
    if (!texto) return null;
    return Object.entries(NOMBRES_CANAL).reduce((t, [k, nombre]) => t.split(k).join(nombre), String(texto));
}

function colorTema(capa, props, tema) {
    const campo = tema || CAPAS[capa].tema;
    const def = TEMAS[capa]?.[campo];
    if (!def || def.unico) return CAPAS[capa].color || SIN_DATO;
    if (def.rangos) {
        const r = rangoDe(def.rangos, props[campo]);
        return r ? r[3] : SIN_DATO;
    }
    const c = def.clases.find(([valor]) => valor === props[campo]);
    return c ? c[2] : SIN_DATO;
}

function colorDe(clases, valor) {
    const c = clases.find(([v]) => v === valor);
    return c ? c[2] : SIN_DATO;
}

// Conversión de WGS 84 a UTM (zona 19 Sur) para la lectura de coordenadas
function aUTM(lat, lon, zona = 19) {
    const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
    const lam0 = ((zona - 1) * 6 - 180 + 3) * Math.PI / 180;
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
    const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
        - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
        + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
        - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
    const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
    let y = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
        + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
    if (lat < 0) y += 10000000;
    return [x, y];
}

// ---------------------------------------------------------------------
// Fotografías de Google Drive
// ---------------------------------------------------------------------
function convertDriveUrl(url) {
    const id = extraerDriveId(url);
    return id ? `https://lh3.googleusercontent.com/d/${id}=w1000` : url;
}

function extraerDriveId(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
        url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
        url.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim())) return url.trim();
    return null;
}

// URLs candidatas para una foto de Drive (se prueban en cascada)
function urlsFotoDrive(url) {
    const id = extraerDriveId(url);
    if (!id) return [url];
    return [
        `https://lh3.googleusercontent.com/d/${id}=w1000`,
        `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
        `https://drive.google.com/uc?export=view&id=${id}`
    ];
}

// ---------------------------------------------------------------------
// Símbolos
// ---------------------------------------------------------------------
const cacheIconos = {};

function svgCamara(color, t = 26) {
    return `<svg width="${t}" height="${t}" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="13.5" fill="#fff" stroke="#22303d" stroke-width="2"/>
        <circle cx="16" cy="16" r="9.6" fill="${color}"/>
        <path d="M10.6 12.8h10.8M10.6 16h10.8M10.6 19.2h10.8" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>`;
}

function svgSumidero(color, t = 21) {
    return `<svg width="${t}" height="${t}" viewBox="0 0 28 28" aria-hidden="true">
        <rect x="2.5" y="2.5" width="23" height="23" rx="3" fill="#fff" stroke="#22303d" stroke-width="2"/>
        <rect x="6" y="6" width="16" height="16" rx="1.5" fill="${color}"/>
        <path d="M10.3 7.6v12.8M14 7.6v12.8M17.7 7.6v12.8" stroke="#fff" stroke-width="1.5"/></svg>`;
}

function svgProgresiva(color, t = 15) {
    return `<svg width="${t}" height="${t}" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3.2" y="3.2" width="9.6" height="9.6" transform="rotate(45 8 8)" fill="${color}" stroke="#fff" stroke-width="1.6"/></svg>`;
}

function svgLinea(color, grosor = 3, discontinua = false, casco = false) {
    return `<svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true">
        ${casco ? `<line x1="1" y1="6" x2="21" y2="6" stroke="#fff" stroke-width="${grosor + 3}"/>` : ''}
        <line x1="1" y1="6" x2="21" y2="6" stroke="${color}" stroke-width="${grosor}" ${discontinua ? 'stroke-dasharray="4 3"' : ''}/></svg>`;
}

function svgArea() {
    return `<svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
        <rect x="2" y="2" width="18" height="12" fill="rgba(19,40,59,0.05)" stroke="#13283b" stroke-width="1.6" stroke-dasharray="4 2.5"/></svg>`;
}

function icono(capa, color) {
    const clave = `${capa}|${color}`;
    if (!cacheIconos[clave]) {
        const def = {
            camaras: [svgCamara(color), 26],
            sumideros: [svgSumidero(color), 21],
            progresivas: [svgProgresiva(color), 15]
        }[capa];
        cacheIconos[clave] = L.divIcon({
            className: 'mk',
            html: def[0],
            iconSize: [def[1], def[1]],
            iconAnchor: [def[1] / 2, def[1] / 2],
            popupAnchor: [0, -def[1] / 2]
        });
    }
    return cacheIconos[clave];
}

function simboloCapa(capa, color) {
    switch (capa) {
        case 'camaras': return svgCamara(color || '#2f7d5c', 20);
        case 'sumideros': return svgSumidero(color || '#c39233', 17);
        case 'progresivas': return svgProgresiva(color || '#c39233', 14);
        case 'canales': return svgLinea(CAPAS.canales.color, 4, false, true);
        case 'area': return svgArea();
        default: return svgLinea(CAPAS[capa].color, 3);
    }
}

function esInferida(props) {
    return props.nivel_certeza === 'INFERIDO' || props.nivel_certeza === 'NO DETERMINADO';
}

function grosorTuberia(props) {
    const d = Number(props.diametro_pulg);
    return d > 0 ? Math.max(2, Math.min(7, 1.4 + d * 0.32)) : 2.2;
}

// ---------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------
const MAPAS_BASE = {
    gris: {
        nombre: 'Calles (gris)',
        capa: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap', maxZoom: 22, maxNativeZoom: 19, className: 'base-gris'
        })
    },
    calles: {
        nombre: 'Calles',
        capa: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap', maxZoom: 22, maxNativeZoom: 19
        })
    },
    satelite: {
        nombre: 'Satélite',
        capa: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '© Esri, Maxar', maxZoom: 22, maxNativeZoom: 19
        })
    },
    topo: {
        nombre: 'Topográfico',
        capa: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
            attribution: '© Esri', maxZoom: 22, maxNativeZoom: 19
        })
    }
};
let baseActual = null;

function initMap() {
    map = L.map('map', { maxZoom: 22, zoomSnap: 0.25, zoomControl: false }).setView([-17.9647, -67.1064], 15);

    // Orden de dibujo: área, canales, tuberías, flujo, secciones, sumideros, cámaras
    [['pArea', 380], ['pCanales', 400], ['pTuberias', 410], ['pFlujo', 415], ['pEtiquetas', 612],
     ['pProgresivas', 620], ['pSumideros', 630], ['pCamaras', 640]].forEach(([n, z]) => {
        map.createPane(n).style.zIndex = z;
    });
    map.getPane('pFlujo').style.pointerEvents = 'none';
    map.getPane('pEtiquetas').style.pointerEvents = 'none';

    // Líneas y polígonos en canvas (más livianos que SVG con cientos de tramos);
    // la animación del flujo usa SVG para poder animarse con CSS.
    lienzos = {
        pArea: L.canvas({ pane: 'pArea' }),
        pCanales: L.canvas({ pane: 'pCanales', tolerance: 4 }),
        pTuberias: L.canvas({ pane: 'pTuberias', tolerance: 6 })
    };
    lienzoFlujo = L.svg({ pane: 'pFlujo' });

    L.control.zoom({ position: 'topright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
    agregarControles();
    L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 140 }).addTo(map);
    cambiarMapaBase('gris');

    map.on('zoomend', actualizarZoom);
    actualizarZoom();
    map.on('click', e => { if (seleccionandoPunto) agregarPuntoSeleccionado(e.latlng); });
    map.on('popupopen', e => prepararFicha(e.popup));
    map.on('popupclose', () => { fichaVisible = null; });
}

function agregarControles() {
    const Botones = L.Control.extend({
        options: { position: 'topright' },
        onAdd() {
            const div = L.DomUtil.create('div', 'leaflet-bar');
            div.innerHTML = `
                <button type="button" class="control-boton" data-c="general" title="Vista general" aria-label="Vista general">
                    <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
                <button type="button" class="control-boton" data-c="ubicacion" title="Mi ubicación" aria-label="Mi ubicación">
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/></svg></button>`;
            L.DomEvent.disableClickPropagation(div);
            div.addEventListener('click', e => {
                const b = e.target.closest('[data-c]');
                if (!b) return;
                if (b.dataset.c === 'general') vistaGeneral();
                if (b.dataset.c === 'ubicacion') obtenerUbicacion();
            });
            return div;
        }
    });
    new Botones().addTo(map);

    const Norte = L.Control.extend({
        options: { position: 'topright' },
        onAdd() {
            const div = L.DomUtil.create('div', 'norte');
            div.title = 'Norte';
            div.innerHTML = `<svg width="20" height="34" viewBox="0 0 20 34" aria-label="Norte">
                <text x="10" y="10" text-anchor="middle" font-size="10" font-weight="600" fill="#16222e" font-family="IBM Plex Sans, sans-serif">N</text>
                <path d="M10 13 L15 31 L10 27 L5 31 Z" fill="#16222e"/><path d="M10 13 L10 27 L5 31 Z" fill="#7a8897"/></svg>`;
            return div;
        }
    });
    new Norte().addTo(map);

    const Coordenadas = L.Control.extend({
        options: { position: 'bottomright' },
        onAdd() {
            const div = L.DomUtil.create('div', 'coords');
            div.textContent = 'UTM 19S';
            map.on('mousemove', e => {
                const [x, y] = aUTM(e.latlng.lat, e.latlng.lng);
                div.textContent = `UTM 19S  E ${Math.round(x).toLocaleString('es-BO')}  N ${Math.round(y).toLocaleString('es-BO')}`;
            });
            return div;
        }
    });
    new Coordenadas().addTo(map);
}

function actualizarZoom() {
    const z = map.getZoom();
    const el = map.getContainer();
    el.classList.toggle('z-muy-lejos', z < 15);
    el.classList.toggle('z-lejos', z >= 15 && z < 16);
    el.classList.toggle('z-medio', z >= 16 && z < 18);
    actualizarEtiquetas();
    // Las secciones de canal solo se muestran de cerca
    if (grupos.progresivas) {
        const debe = visibles.progresivas && z >= CAPAS.progresivas.zoomMin;
        if (debe && !map.hasLayer(grupos.progresivas)) grupos.progresivas.addTo(map);
        if (!debe && map.hasLayer(grupos.progresivas)) map.removeLayer(grupos.progresivas);
    }
}

function cambiarMapaBase(clave) {
    if (baseActual) map.removeLayer(baseActual);
    baseActual = MAPAS_BASE[clave].capa().addTo(map);
    baseActual.bringToBack();
    document.querySelectorAll('#mapasBase button').forEach(b => {
        b.setAttribute('aria-checked', String(b.dataset.base === clave));
    });
}

function vistaGeneral() {
    const area = registro.area?.[0];
    if (area) map.fitBounds(area.layer.getBounds(), { padding: [24, 24] });
}

// ---------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------
// La copia local (GitHub Pages, servida desde un nodo cercano) se dibuja
// primero; en paralelo se consulta la base en Supabase y, si sus datos son
// más recientes, se vuelve a dibujar con ellos.
async function obtenerLocal() {
    const response = await fetch('datos.geojson');
    if (!response.ok) throw new Error('No se pudo leer datos.geojson');
    return response.json();
}

function cabecerasSupabase() {
    const cfg = window.GEOPORTAL_CONFIG || {};
    const headers = { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' };
    // Las claves anon antiguas son JWT y también van en Authorization
    if (cfg.supabaseAnonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${cfg.supabaseAnonKey}`;
    return headers;
}

async function obtenerSupabase() {
    const cfg = window.GEOPORTAL_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return null;
    try {
        const response = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/geoportal_datos`, { method: 'POST', headers: cabecerasSupabase(), body: '{}' });
        if (response.ok) return await response.json();
        console.warn('Supabase respondió', response.status);
    } catch (error) {
        console.warn('No se pudo consultar Supabase:', error);
    }
    return null;
}

// Versión de los datos: cambia con cada procesamiento y con cada edición
function versionDe(geojson) {
    const meta = geojson?.resumen?.metadatos || {};
    return meta.version || meta.procesado || '';
}

// Marca de tiempo de PostgreSQL (microsegundos) en milisegundos
function tiempoDe(v) {
    return Date.parse(String(v).replace(/(\.\d{3})\d+/, '$1'));
}

function mismaVersion(a, b) {
    const ta = tiempoDe(a), tb = tiempoDe(b);
    return Number.isNaN(ta) || Number.isNaN(tb) ? a === b : ta === tb;
}

function horaVersion(v) {
    const t = tiempoDe(v);
    return Number.isNaN(t) ? String(v)
        : new Date(t).toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' });
}

function estadoDatos(clase, texto) {
    const el = document.getElementById('estadoDatos');
    el.className = `barra__estado ${clase}`;
    el.querySelector('.texto').textContent = texto;
    el.title = texto;
}

// Solo lo que cambió en la base después de una versión (unos pocos KB)
async function obtenerCambios(desde) {
    const cfg = window.GEOPORTAL_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !desde) return null;
    try {
        const response = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/geoportal_cambios`,
            { method: 'POST', headers: cabecerasSupabase(), body: JSON.stringify({ p_desde: desde }) });
        if (response.ok) return await response.json();
        console.warn('Supabase respondió', response.status);
    } catch (error) {
        console.warn('No se pudo consultar Supabase:', error);
    }
    return null;
}

const claveDe = f => `${f.properties?._capa}|${f.properties?._clave}`;

function hayCambios(delta) {
    return delta.completo || delta.features.length > 0 || delta.eliminados.length > 0;
}

// Reemplaza en los datos actuales los elementos nuevos, modificados o eliminados
function combinarCambios(base, delta) {
    if (delta.completo || !base) return { type: 'FeatureCollection', resumen: delta.resumen, features: delta.features };
    const fuera = new Set([...delta.eliminados, ...delta.features.map(claveDe)]);
    return {
        type: 'FeatureCollection',
        resumen: delta.resumen,
        features: base.features.filter(f => !fuera.has(claveDe(f))).concat(delta.features)
    };
}

async function cargarCapa() {
    let local = null;
    try {
        local = await obtenerLocal();
        mostrarDatos(local);
        fuenteDatos = 'local';
        estadoDatos('', 'Verificando con la base en línea');
    } catch (error) {
        console.warn(error);
    }

    // Con la copia local basta pedir lo que cambió después de ella
    const delta = local ? await obtenerCambios(versionDe(local)) : null;
    const remoto = delta ? combinarCambios(local, delta) : await obtenerSupabase();
    if (remoto) {
        if (!local || hayCambios(delta || { completo: true })) redibujar(remoto);
        else {
            datosActuales = remoto;
            resumenDatos = remoto.resumen;
        }
        versionActual = versionDe(remoto);
        fuenteDatos = 'supabase';
        estadoDatos('conectado', 'Base PostGIS en línea');
        construirResumen();
        iniciarTiempoReal();
    } else if (local) {
        estadoDatos('local', 'Copia local de los datos');
    } else {
        estadoDatos('fallo', 'Sin datos');
        document.getElementById('listaCapas').innerHTML =
            '<p class="ayuda">No se pudieron cargar los datos. Revise la conexión y recargue la página.</p>';
        aviso('No se pudieron cargar los datos del geoportal.', 'error');
    }
}

// ---------------------------------------------------------------------
// Actualización en tiempo real
// ---------------------------------------------------------------------
// Cada edición guardada desde QGIS cambia public.geoportal_estado.version.
// El geoportal escucha ese cambio con Supabase Realtime y vuelve a leer los
// datos; si el canal no está disponible, consulta la versión cada minuto.
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
let versionActual = '';
let tiempoRealIniciado = false;
let tiempoRealActivo = false;
let actualizando = false;
let temporizadorCambio = null;

// Un solo cliente de supabase-js para el tiempo real y la sesión de usuario
let promesaCliente = null;
function clienteSupabase() {
    const cfg = window.GEOPORTAL_CONFIG || {};
    if (!promesaCliente) {
        promesaCliente = cargarScript(SUPABASE_JS).then(() => {
            const cliente = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
            // supabase-js recomienda no llamar a la API dentro de este aviso
            cliente.auth.onAuthStateChange((evento, s) => setTimeout(() => cambioDeSesion(s), 0));
            return cliente;
        });
        promesaCliente.catch(() => { promesaCliente = null; });
    }
    return promesaCliente;
}

function iniciarTiempoReal() {
    const cfg = window.GEOPORTAL_CONFIG || {};
    if (tiempoRealIniciado || !cfg.supabaseUrl) return;
    tiempoRealIniciado = true;
    const revisar = async () => cambioDeVersion(await consultarVersion());
    setInterval(() => { if (!document.hidden && !tiempoRealActivo) revisar(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
    clienteSupabase().then(cliente => {
        cliente.channel('geoportal-estado')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'geoportal_estado' },
                cambio => cambioDeVersion(cambio.new?.version))
            .subscribe(estado => {
                tiempoRealActivo = estado === 'SUBSCRIBED';
                if (!actualizando) estadoEnLinea();
            });
    }).catch(error => console.warn('Tiempo real no disponible:', error));
}

async function consultarVersion() {
    const cfg = window.GEOPORTAL_CONFIG || {};
    try {
        const response = await fetch(`${cfg.supabaseUrl}/rest/v1/geoportal_estado?select=version&id=eq.1`,
            { headers: cabecerasSupabase(), cache: 'no-store' });
        if (!response.ok) return null;
        const [fila] = await response.json();
        return fila?.version || null;
    } catch (error) {
        return null;
    }
}

// QGIS guarda cada capa en una sentencia: se espera a que termine de guardar
function cambioDeVersion(version) {
    if (!version || mismaVersion(version, versionActual)) return;
    clearTimeout(temporizadorCambio);
    temporizadorCambio = setTimeout(actualizarDatos, 1200);
}

async function actualizarDatos(mensaje) {
    if (actualizando) {
        temporizadorCambio = setTimeout(actualizarDatos, 1200);
        return;
    }
    actualizando = true;
    estadoDatos('conectado', 'Actualizando datos…');
    try {
        const delta = datosActuales ? await obtenerCambios(versionActual) : null;
        const datos = delta ? combinarCambios(datosActuales, delta) : await obtenerSupabase();
        if (datos && (delta ? hayCambios(delta) : !mismaVersion(versionDe(datos), versionActual))) {
            redibujar(datos);
            versionActual = versionDe(datos);
            fuenteDatos = 'supabase';
            construirResumen();
            aviso(mensaje || `Datos actualizados desde la base (${horaVersion(versionActual)}).`);
        }
    } finally {
        actualizando = false;
        estadoEnLinea();
    }
}

function estadoEnLinea() {
    if (fuenteDatos !== 'supabase') return;
    if (tiempoRealActivo) estadoDatos('conectado vivo', 'En línea · actualización en tiempo real');
    else estadoDatos('conectado', 'Base PostGIS en línea');
}

// Redibuja conservando abierta la ficha que se estaba consultando
function redibujar(datos) {
    const abierta = fichaVisible;
    mostrarDatos(datos);
    if (!abierta) return;
    const reg = (registro[abierta.capa] || []).find(r => r.props.codigo === abierta.codigo);
    if (reg && map.hasLayer(grupos[reg.capa])) reg.layer.openPopup(reg.latlng || abierta.latlng);
}

let datosDibujados = false;
let datosActuales = null;  // FeatureCollection dibujado (se le aplican los cambios)

function mostrarDatos(geojson) {
    const features = geojson.features || [];
    if (!features.length) return;
    datosActuales = geojson;
    if (datosDibujados) limpiarCapas();
    resumenDatos = geojson.resumen || null;
    ORDEN_PANEL.forEach(c => {
        registro[c] = [];
        if (visibles[c] === undefined) visibles[c] = true;
    });
    features.forEach(f => {
        const capa = f.properties?._capa;
        if (CAPAS[capa] && f.geometry) registro[capa].push({ capa, props: f.properties, geometry: f.geometry });
    });
    ORDEN_PANEL.forEach(construirCapa);
    construirPanelCapas();
    construirResumen();
    actualizarZoom();
    if (!datosDibujados) vistaGeneral();
    datosDibujados = true;
    performance.mark('geoportal-datos-dibujados');
}

function limpiarCapas() {
    map.closePopup();
    [grupos, etiquetas, flujos].forEach(coleccion => {
        Object.keys(coleccion).forEach(c => {
            if (map.hasLayer(coleccion[c])) map.removeLayer(coleccion[c]);
            delete coleccion[c];
        });
    });
}

function construirCapa(capa) {
    const def = CAPAS[capa];
    const grupo = L.featureGroup();
    grupos[capa] = grupo;

    registro[capa].forEach(reg => {
        const p = reg.props;
        let layer;
        if (def.tipo === 'punto') {
            const [lon, lat] = reg.geometry.coordinates;
            reg.latlng = L.latLng(lat, lon);
            layer = L.marker(reg.latlng, {
                icon: icono(capa, colorTema(capa, p)),
                pane: def.pane,
                keyboard: false,
                title: p.codigo
            });
        } else if (capa === 'area') {
            layer = L.geoJSON(reg.geometry, {
                pane: def.pane,
                renderer: lienzos[def.pane],
                interactive: false,
                style: { color: def.color, weight: 2, dashArray: '10 6', fillColor: def.color, fillOpacity: 0.035 }
            });
        } else if (capa === 'canales') {
            const opciones = { pane: def.pane, renderer: lienzos[def.pane] };
            const casco = L.geoJSON(reg.geometry, { ...opciones, style: { color: '#ffffff', weight: 8, opacity: 0.9 } });
            const eje = L.geoJSON(reg.geometry, { ...opciones, style: { color: def.color, weight: 4.5, opacity: 1 } });
            layer = L.featureGroup([casco, eje]);
        } else {
            layer = L.geoJSON(reg.geometry, {
                pane: def.pane,
                renderer: lienzos[def.pane],
                style: {
                    color: colorTema(capa, p),
                    weight: capa === 'tuberias_camaras' ? grosorTuberia(p) : 2.4,
                    opacity: 0.95,
                    dashArray: esInferida(p) ? '7 5' : null
                }
            });
        }

        if (capa !== 'area') {
            layer.bindPopup(() => htmlFicha(reg), { className: 'ficha', maxWidth: 400, minWidth: 280, autoPanPadding: [40, 40] });
            if (def.tipo === 'linea') {
                const texto = capa === 'canales' ? nombreCanal(p.nombre)
                    : `${p.codigo}${p.pendiente_pct != null ? ` · pendiente ${numero(p.pendiente_pct, 2)} %` : ''}`;
                layer.bindTooltip(texto, { sticky: true, className: 'etiqueta-mapa', direction: 'top' });
            }
        }
        reg.layer = layer;
        grupo.addLayer(layer);
    });

    if (capa !== 'progresivas') grupo.addTo(map);
    if (capa === 'tuberias_camaras' || capa === 'tuberias_sumideros') {
        actualizarFlujo();
        actualizarEtiquetas();
    }
}

// Etiqueta con la pendiente (%) en el punto medio del tramo, orientada
// según la tubería; la flecha indica el sentido del flujo (origen → destino).
function crearEtiquetaPendiente(reg) {
    const v = reg.props.pendiente_pct;
    if (v === null || v === undefined) return null;
    const coords = reg.geometry.type === 'MultiLineString' ? reg.geometry.coordinates.flat() : reg.geometry.coordinates;
    if (coords.length < 2) return null;
    const pts = coords.map(([lon, lat]) => map.project(L.latLng(lat, lon), 18));
    const largos = pts.slice(1).map((pt, i) => pt.distanceTo(pts[i]));
    const total = largos.reduce((s, d) => s + d, 0);
    if (!total) return null;
    let i = 0, acumulado = 0;
    while (i < largos.length - 1 && acumulado + largos[i] < total / 2) acumulado += largos[i++];
    const a = pts[i], b = pts[i + 1];
    const t = (total / 2 - acumulado) / largos[i];
    const medio = map.unproject(L.point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), 18);
    let angulo = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    const invertida = angulo > 90 || angulo < -90;
    if (invertida) angulo += 180;
    const texto = `${numero(v, 1)} %`;
    // Rojo: contrapendiente; borde punteado: valor a revisar
    const clases = [v < 0 ? 'contra' : '', reg.props.pendiente_revisar ? 'revisar' : ''].join(' ').trim();
    return L.marker(medio, {
        pane: 'pEtiquetas',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
            className: 'etiqueta-pendiente',
            iconSize: [0, 0],
            html: `<span class="${clases}" style="transform:translate(-50%,-50%) rotate(${angulo.toFixed(1)}deg)">${invertida ? `← ${texto}` : `${texto} →`}</span>`
        })
    });
}

// Las etiquetas se crean la primera vez que se necesitan
function actualizarEtiquetas() {
    if (!map) return;
    const z = map.getZoom();
    ['tuberias_camaras', 'tuberias_sumideros'].forEach(capa => {
        if (!registro[capa]) return;
        const mostrar = etiquetasActivas && visibles[capa] && z >= CAPAS[capa].zoomEtiquetas;
        if (mostrar && !etiquetas[capa]) {
            etiquetas[capa] = L.layerGroup(registro[capa].map(crearEtiquetaPendiente).filter(Boolean));
        }
        const g = etiquetas[capa];
        if (!g) return;
        if (mostrar && !map.hasLayer(g)) g.addTo(map);
        if (!mostrar && map.hasLayer(g)) map.removeLayer(g);
    });
}

// ---------------------------------------------------------------------
// Panel de capas y leyendas
// ---------------------------------------------------------------------
function construirPanelCapas() {
    const cont = document.getElementById('listaCapas');
    const porGrupo = {};
    ORDEN_PANEL.forEach(c => (porGrupo[CAPAS[c].grupo] ||= []).push(c));

    cont.innerHTML = Object.entries(porGrupo).map(([grupo, capas]) => `
        <div class="grupo">
            <h2 class="grupo__titulo">${esc(grupo)}</h2>
            ${capas.map(htmlCapa).join('')}
            ${grupo === 'Red de drenaje' ? `
                <div class="capa rangos">
                    <h3 class="rangos__titulo">Rangos de pendiente de las tuberías</h3>
                    <div class="tema">
                        <label for="rangoModo">Rangos</label>
                        <select id="rangoModo">
                            <option value="predeterminado">Predeterminados (0 · 0,5 · 2 · 5 · 10 %)</option>
                            <option value="cuantiles">Cuantiles (5 clases con igual cantidad)</option>
                            <option value="personalizado">Personalizados</option>
                        </select>
                    </div>
                    <div class="tema">
                        <label for="rangoPaleta">Colores</label>
                        <select id="rangoPaleta">
                            ${Object.entries(PALETAS_PENDIENTE).map(([k, p]) => `<option value="${k}">${esc(p.nombre)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="rangos__escala" id="rangoEscala" aria-hidden="true"></div>
                    <div id="rangoEditor" hidden>
                        <label class="etiqueta" for="rangoLimites">Límites entre clases (%), separados por punto y coma</label>
                        <div class="rangos__fila">
                            <input class="campo" id="rangoLimites" inputmode="decimal" placeholder="0; 0,5; 2; 5; 10">
                            <button type="button" class="boton" id="rangoAplicar">Aplicar</button>
                        </div>
                        <p class="mensaje" id="rangoMensaje" role="status"></p>
                    </div>
                </div>
                <label class="interruptor"><input type="checkbox" id="chkPendientes" ${etiquetasActivas ? 'checked' : ''}>
                Mostrar la pendiente (%) sobre las tuberías</label>
                <label class="interruptor"><input type="checkbox" id="chkFlujo" ${flujoActivo ? 'checked' : ''}>
                Animar el sentido del flujo en las tuberías</label>` : ''}
        </div>`).join('');

    cont.querySelectorAll('[data-capa-chk]').forEach(chk => chk.addEventListener('change', () => {
        alternarCapa(chk.dataset.capaChk, chk.checked);
    }));
    cont.querySelectorAll('[data-tema]').forEach(sel => sel.addEventListener('change', () => {
        cambiarTema(sel.dataset.tema, sel.value);
    }));
    document.getElementById('chkFlujo').addEventListener('change', e => {
        flujoActivo = e.target.checked;
        actualizarFlujo();
    });
    prepararEditorRangos();
    document.getElementById('chkPendientes').addEventListener('change', e => {
        etiquetasActivas = e.target.checked;
        actualizarEtiquetas();
        if (etiquetasActivas && map.getZoom() < CAPAS.tuberias_camaras.zoomEtiquetas) {
            aviso('Acérquese para ver la pendiente sobre las tuberías (zoom 17 o mayor).');
        }
    });

    document.getElementById('mapasBase').innerHTML = Object.entries(MAPAS_BASE).map(([clave, b]) =>
        `<button type="button" role="radio" data-base="${clave}" aria-checked="${clave === 'gris'}">${esc(b.nombre)}</button>`).join('');
    document.querySelectorAll('#mapasBase button').forEach(b => b.addEventListener('click', () => cambiarMapaBase(b.dataset.base)));
}

function htmlCapa(capa) {
    const def = CAPAS[capa];
    const n = registro[capa].length;
    const cuenta = capa === 'area'
        ? `${numero(registro.area[0]?.props.area_ha, 1)} ha`
        : n.toLocaleString('es-BO');
    const temas = TEMAS[capa];
    return `
        <div class="capa${visibles[capa] === false ? ' apagada' : ''}" id="capa-${capa}">
            <div class="capa__cabeza">
                <input type="checkbox" id="chk-${capa}" data-capa-chk="${capa}" ${visibles[capa] === false ? '' : 'checked'}>
                <span class="capa__simbolo">${simboloCapa(capa)}</span>
                <label class="capa__nombre" for="chk-${capa}">${esc(def.nombre)}</label>
                <span class="capa__cuenta">${cuenta}</span>
            </div>
            <div class="capa__cuerpo">
                ${temas ? `
                    <div class="tema">
                        <label for="tema-${capa}">Simbolizar por</label>
                        <select id="tema-${capa}" data-tema="${capa}">
                            ${Object.entries(temas).map(([campo, t]) =>
                                `<option value="${campo}" ${campo === def.tema ? 'selected' : ''}>${esc(t.titulo)}</option>`).join('')}
                        </select>
                    </div>` : ''}
                <ul class="leyenda" id="leyenda-${capa}">${htmlLeyenda(capa)}</ul>
            </div>
        </div>`;
}

function htmlLeyenda(capa) {
    const def = CAPAS[capa];
    const regs = registro[capa];
    if (capa === 'tuberias_camaras' || capa === 'tuberias_sumideros') {
        const tema = TEMAS[capa][def.tema];
        const filas = [];
        if (tema.rangos) {
            tema.rangos.forEach(([, , rotulo, color]) => {
                const n = regs.filter(r => rangoDe(tema.rangos, r.props.pendiente_pct)?.[2] === rotulo).length;
                if (n) filas.push(`<li><span class="muestra">${svgLinea(color, 3)}</span><span class="texto">${esc(rotulo)}</span><span class="n">${n}</span></li>`);
            });
            const sin = regs.filter(r => !rangoDe(tema.rangos, r.props.pendiente_pct)).length;
            if (sin) filas.push(`<li><span class="muestra">${svgLinea(SIN_DATO, 3)}</span><span class="texto">Sin datos para calcular la pendiente</span><span class="n">${sin}</span></li>`);
        }
        const firme = regs.filter(r => !esInferida(r.props)).length;
        const gris = tema.rangos ? '#7a8897' : def.color;
        filas.push(
            `<li><span class="muestra">${svgLinea(gris, 3)}</span><span class="texto">Trazado confirmado o probable</span><span class="n">${firme}</span></li>`,
            `<li><span class="muestra">${svgLinea(gris, 3, true)}</span><span class="texto">Trazado inferido o no determinado</span><span class="n">${regs.length - firme}</span></li>`);
        if (capa === 'tuberias_camaras') filas.push('<li class="nota">El grosor es proporcional al diámetro.</li>');
        filas.push(`<li class="nota">${capa === 'tuberias_camaras'
            ? 'Pendiente en el sentido del flujo, con las cotas de fondo (terreno del MDS menos la profundidad medida) o, sin profundidades, con el terreno entre cámaras.'
            : 'Pendiente hidráulica en el sentido del flujo, con las cotas de fondo (terreno del MDS menos la profundidad medida).'}
            Negativa = contrapendiente (etiqueta roja); borde punteado = valor a revisar. Las etiquetas aparecen desde el zoom ${def.zoomEtiquetas}; la flecha indica el sentido del flujo.</li>`);
        return filas.join('');
    }
    if (TEMAS[capa]) {
        const tema = TEMAS[capa][def.tema];
        const campo = def.tema;
        const filas = tema.clases.map(([valor, rotulo, color]) => {
            const n = regs.filter(r => r.props[campo] === valor).length;
            return n ? `<li><span class="muestra">${simboloCapa(capa, color)}</span><span class="texto">${esc(rotulo)}</span><span class="n">${n}</span></li>` : '';
        });
        const sin = regs.filter(r => !tema.clases.some(([v]) => v === r.props[campo])).length;
        if (sin) filas.push(`<li><span class="muestra">${simboloCapa(capa, SIN_DATO)}</span><span class="texto">Sin dato</span><span class="n">${sin}</span></li>`);
        if (def.zoomMin) filas.push(`<li class="nota">Visibles desde el zoom ${def.zoomMin}; acérquese para verlas.</li>`);
        return filas.join('');
    }
    if (capa === 'canales') {
        const km = regs.reduce((s, r) => s + (Number(r.props.longitud_eje_m) || 0), 0) / 1000;
        return `<li class="nota">${numero(km, 2)} km de eje; la ficha de cada canal resume sus secciones.</li>`;
    }
    if (capa === 'area') return '<li class="nota">Límite del relevamiento: Casco Viejo de Oruro.</li>';
    return '';
}

// ---------------------------------------------------------------------
// Rangos de pendiente editables
// ---------------------------------------------------------------------
function valoresPendiente() {
    return ['tuberias_camaras', 'tuberias_sumideros']
        .flatMap(c => (registro[c] || []).map(r => r.props.pendiente_pct))
        .filter(v => v !== null && v !== undefined)
        .sort((a, b) => a - b);
}

function limitesCuantiles(clases = 5) {
    const v = valoresPendiente();
    if (!v.length) return LIMITES_PREDETERMINADOS;
    const limites = [];
    for (let k = 1; k < clases; k++) {
        const x = Math.round(v[Math.floor(k * v.length / clases)] * 10) / 10;
        if (!limites.includes(x)) limites.push(x);
    }
    return limites;
}

function leerLimites(texto) {
    const partes = texto.split(/[;\s]+/).map(p => p.trim()).filter(Boolean);
    const valores = partes.map(p => Number(p.replace(',', '.')));
    if (!valores.length) return { error: 'Escriba al menos un límite, por ejemplo: 0,5; 2; 5; 10' };
    if (valores.some(v => !Number.isFinite(v))) return { error: 'Use solo números separados por punto y coma (;). Ejemplo: 0,5; 2; 5; 10' };
    const limites = [...new Set(valores)].sort((a, b) => a - b);
    if (limites.length > 8) return { error: 'Use como máximo 8 límites (9 clases).' };
    return { limites };
}

function prepararEditorRangos() {
    const modo = document.getElementById('rangoModo');
    const paleta = document.getElementById('rangoPaleta');
    const entrada = document.getElementById('rangoLimites');
    modo.value = configPendiente.modo;
    paleta.value = configPendiente.paleta;
    entrada.value = configPendiente.limites.map(textoLimite).join('; ');
    document.getElementById('rangoEditor').hidden = configPendiente.modo !== 'personalizado';
    dibujarEscalaRangos();

    modo.addEventListener('change', () => {
        document.getElementById('rangoEditor').hidden = modo.value !== 'personalizado';
        if (modo.value === 'predeterminado') aplicarRangos({ modo: 'predeterminado', limites: LIMITES_PREDETERMINADOS });
        if (modo.value === 'cuantiles') aplicarRangos({ modo: 'cuantiles', limites: limitesCuantiles() });
        if (modo.value === 'personalizado') entrada.focus();
    });
    paleta.addEventListener('change', () => aplicarRangos({ paleta: paleta.value }));
    const aplicarPersonalizados = () => {
        const r = leerLimites(entrada.value);
        const msg = document.getElementById('rangoMensaje');
        if (r.error) {
            msg.textContent = r.error;
            msg.className = 'mensaje error';
            return;
        }
        msg.textContent = '';
        aplicarRangos({ modo: 'personalizado', limites: r.limites });
    };
    document.getElementById('rangoAplicar').addEventListener('click', aplicarPersonalizados);
    entrada.addEventListener('keydown', e => { if (e.key === 'Enter') aplicarPersonalizados(); });
}

function aplicarRangos(cambios) {
    configPendiente = { ...configPendiente, ...cambios };
    PENDIENTE = construirRangos(configPendiente.limites, configPendiente.paleta);
    TEMAS.tuberias_camaras.pendiente_pct.rangos = PENDIENTE;
    TEMAS.tuberias_sumideros.pendiente_pct.rangos = PENDIENTE;
    // Al elegir rangos, las tuberías pasan a simbolizarse por pendiente
    ['tuberias_camaras', 'tuberias_sumideros'].forEach(capa => {
        const selector = document.getElementById(`tema-${capa}`);
        if (selector) selector.value = 'pendiente_pct';
        cambiarTema(capa, 'pendiente_pct');
    });
    document.getElementById('rangoLimites').value = configPendiente.limites.map(textoLimite).join('; ');
    dibujarEscalaRangos();
    construirResumen();
    try { localStorage.setItem(CLAVE_RANGOS, JSON.stringify(configPendiente)); } catch (e) { /* sin almacenamiento */ }
}

function dibujarEscalaRangos() {
    const el = document.getElementById('rangoEscala');
    if (!el) return;
    el.innerHTML = PENDIENTE.map(([, , rotulo, color]) =>
        `<span style="background:${color}" title="${esc(rotulo)}"></span>`).join('');
}

function alternarCapa(capa, activa) {
    visibles[capa] = activa;
    document.getElementById(`capa-${capa}`).classList.toggle('apagada', !activa);
    if (capa === 'progresivas') {
        actualizarZoom();
        if (activa && map.getZoom() < CAPAS.progresivas.zoomMin) aviso('Las secciones de canal se muestran desde el zoom 16.');
    } else if (activa) {
        grupos[capa].addTo(map);
    } else {
        map.removeLayer(grupos[capa]);
    }
    actualizarFlujo();
    actualizarEtiquetas();
}

function cambiarTema(capa, campo) {
    CAPAS[capa].tema = campo;
    registro[capa].forEach(reg => {
        const color = colorTema(capa, reg.props);
        if (CAPAS[capa].tipo === 'punto') reg.layer.setIcon(icono(capa, color));
        else reg.layer.setStyle({ color });
    });
    document.getElementById(`leyenda-${capa}`).innerHTML = htmlLeyenda(capa);
}

// ---------------------------------------------------------------------
// Animación del sentido del flujo
// ---------------------------------------------------------------------
// Líneas del sentido del flujo: una capa SVG por tipo de tubería, animada
// con CSS (styles.css). Se crean solo al activar la animación.
function actualizarFlujo() {
    ['tuberias_camaras', 'tuberias_sumideros'].forEach(capa => {
        if (!registro[capa]) return;
        const mostrar = flujoActivo && visibles[capa];
        if (mostrar && !flujos[capa]) {
            flujos[capa] = L.geoJSON({ type: 'FeatureCollection', features: registro[capa].map(r => ({ type: 'Feature', geometry: r.geometry })) }, {
                pane: 'pFlujo',
                renderer: lienzoFlujo,
                interactive: false,
                style: { color: '#ffffff', weight: 1.6, opacity: 0.9, dashArray: '2 14', lineCap: 'round' }
            });
        }
        const f = flujos[capa];
        if (!f) return;
        if (mostrar && !map.hasLayer(f)) f.addTo(map);
        if (!mostrar && map.hasLayer(f)) map.removeLayer(f);
    });
}

// ---------------------------------------------------------------------
// Fichas
// ---------------------------------------------------------------------
// Cada campo: [propiedad, etiqueta, formato]. Formatos: texto, mono,
// estado:<tema>, num:<decimales>:<unidad>, sino, fecha, canal.
const FICHAS = {
    camaras: {
        tipo: 'Cámara de inspección',
        subtitulo: p => [etiqueta(p.tipo_camara), etiqueta(p.localizacion)].filter(Boolean).join(' · '),
        secciones: [
            ['Inspección', [
                ['accesibilidad', 'Accesibilidad', 'estado:ACCESIBILIDAD'],
                ['tipo_observacion', 'Tipo de observación', 'texto'],
                ['nivel_certeza', 'Nivel de certeza', 'estado:CERTEZA'],
                ['fecha_registro', 'Fecha de registro', 'fecha']]],
            ['Estado y funcionamiento', [
                ['estado_fisico', 'Estado físico', 'estado:ESTADO'],
                ['funcionamiento_drenaje', 'Funcionamiento del drenaje', 'estado:ESTADO'],
                ['condicion_interior', 'Condición interior', 'estado:CONDICION'],
                ['localizacion_dano', 'Localización del daño', 'texto'],
                ['sedimentos', 'Sedimentos', 'texto'],
                ['escalones', 'Escalones', 'sino'],
                ['estado_escalones', 'Estado de los escalones', 'estado:ESTADO']]],
            ['Características', [
                ['tipo_camara', 'Tipo de cámara', 'texto'],
                ['tipo_ci', 'Configuración', 'texto'],
                ['tipo_tapa', 'Tipo de tapa', 'texto'],
                ['diametro_tapa_m', 'Diámetro de la tapa', 'num:2:m'],
                ['altura_tapa_m', 'Altura de la tapa', 'num:3:m'],
                ['altura_solera_m', 'Altura de solera', 'num:2:m'],
                ['prof_tub_entrada_m', 'Profundidad de entrada', 'num:2:m'],
                ['prof_tub_salida_m', 'Profundidad de salida', 'num:2:m'],
                ['n_entradas', 'Tuberías de entrada', 'num:0:'],
                ['n_salidas', 'Tuberías de salida', 'num:0:'],
                ['gestion', 'Gestión de construcción', 'texto']]],
            ['Conexiones', [
                ['sumideros_asociados', 'Sumideros asociados', 'num:0:'],
                ['recibe_de', 'Recibe de las cámaras', 'mono'],
                ['descarga', 'Descarga', 'canal']]],
            ['Ubicación', [
                ['sector', 'Sector', 'sector'],
                ['ubicacion', 'Ubicación en la vía', 'texto'],
                ['rasante', 'Rasante', 'texto'],
                ['material_rasante', 'Material de la rasante', 'texto'],
                ['este', 'Este (UTM 19S)', 'num:2:m'],
                ['norte', 'Norte (UTM 19S)', 'num:2:m'],
                ['elevacion_mds_m', 'Elevación del terreno', 'num:2:m'],
                ['elevacion_fuente', 'Fuente de la elevación', 'texto']]]
        ],
        foto: p => p.foto_url || p.foto_descarga_url,
        texto: [['observaciones', 'Observaciones de campo']]
    },
    sumideros: {
        tipo: 'Sumidero',
        subtitulo: p => [etiqueta(p.tipo_rejilla), p.canal_receptor ? `Canal ${nombreCanal(p.canal_receptor)}` : (p.camara_referencia ? `Cámara ${p.camara_referencia}` : null)].filter(Boolean).join(' · '),
        secciones: [
            ['Inspección', [
                ['apertura', 'Abierto en la inspección', 'sino'],
                ['nivel_certeza', 'Nivel de certeza', 'estado:CERTEZA'],
                ['fecha_registro', 'Fecha de registro', 'fecha'],
                ['codigo_campo', 'Código registrado en campo', 'mono']]],
            ['Estado y funcionamiento', [
                ['condicion', 'Condición de funcionamiento', 'estado:CONDICION'],
                ['estado_estructura', 'Estado de la estructura', 'estado:ESTADO'],
                ['estado_rejilla', 'Estado de la rejilla', 'estado:ESTADO'],
                ['sedimento', 'Tipo de sedimento', 'texto'],
                ['altura_sedimento_m', 'Altura de sedimento', 'num:2:m']]],
            ['Características', [
                ['tipo_rejilla', 'Tipo de rejilla', 'texto'],
                ['material_rasante', 'Material de la rasante', 'texto'],
                ['cuneta', 'Cuneta', 'sino'],
                ['ancho_m', 'Ancho', 'num:2:m'],
                ['largo_m', 'Largo', 'num:2:m'],
                ['espesor_m', 'Espesor de la rejilla', 'num:2:m'],
                ['altura_solera_m', 'Altura de solera', 'num:2:m']]],
            ['Conexiones', [
                ['camara_referencia', 'Cámara de referencia', 'mono'],
                ['canal_receptor', 'Canal receptor', 'canal'],
                ['descarga', 'Descarga', 'canal']]],
            ['Ubicación', [
                ['sector', 'Sector', 'sector'],
                ['este', 'Este (UTM 19S)', 'num:2:m'],
                ['norte', 'Norte (UTM 19S)', 'num:2:m'],
                ['elevacion_mds_m', 'Elevación del terreno', 'num:2:m'],
                ['elevacion_fuente', 'Fuente de la elevación', 'texto']]]
        ],
        foto: p => p.foto_url || p.foto_descarga_url,
        texto: [['justificacion', 'Motivo (apertura)'], ['observaciones', 'Observaciones de campo']]
    },
    tuberias_camaras: {
        tipo: 'Tubería de cámara',
        subtitulo: p => `${p.origen || '¿?'} → ${conCanales(p.destino) || '¿?'}`,
        perfil: true,
        secciones: [
            ['Pendiente', [
                ['pendiente_pct', 'Pendiente en el sentido del flujo', 'pendiente'],
                ['observacion_pendiente', 'Interpretación', 'observacion'],
                ['metodo_pendiente', 'Calculada con', 'texto'],
                ['pendiente_pct', 'Desnivel en el tramo', 'desnivel'],
                ['longitud_m', 'Longitud del tramo', 'num:2:m'],
                ['distancia_campo_m', 'Distancia registrada en campo', 'num:2:m'],
                ['pendiente_hidraulica_pct', 'Pendiente hidráulica (cotas de fondo)', 'num:2:%'],
                ['pendiente_terreno_pct', 'Pendiente del terreno', 'num:2:%'],
                ['pendiente_registrada_pct', 'Pendiente de la base de campo (sin signo)', 'num:2:%']]],
            ['Cotas', [
                ['elevacion_inicio_m', 'Terreno en el origen', 'num:2:m'],
                ['prof_inicio_m', 'Profundidad en el origen', 'num:2:m'],
                ['cota_fondo_inicio_m', 'Cota de fondo en el origen', 'num:2:m'],
                ['elevacion_fin_m', 'Terreno en el destino', 'num:2:m'],
                ['prof_fin_m', 'Profundidad en el destino', 'num:2:m'],
                ['cota_fondo_fin_m', 'Cota de fondo en el destino', 'num:2:m']]],
            ['Conexión', [
                ['origen', 'Origen', 'mono'],
                ['destino', 'Destino', 'canal'],
                ['destino_tipo', 'Tipo de destino', 'texto'],
                ['metodo_origen', 'Origen determinado', 'texto'],
                ['metodo_destino', 'Destino determinado', 'texto'],
                ['nivel_certeza', 'Nivel de certeza', 'estado:CERTEZA']]],
            ['Características', [
                ['funcion', 'Función', 'texto'],
                ['material', 'Material', 'texto'],
                ['diametro_pulg', 'Diámetro', 'num:0:pulg'],
                ['profundidad_m', 'Profundidad', 'num:2:m'],
                ['estado', 'Estado', 'estado:ESTADO'],
                ['codigo_campo', 'Código registrado en campo', 'mono']]]
        ],
        texto: [['observaciones', 'Observaciones de campo']],
        nota: 'Pendiente = (cota de fondo en el origen − cota de fondo en el destino) / longitud × 100, en el sentido del flujo. Cota de fondo = elevación del terreno (MDS) menos la profundidad medida en campo. Sin profundidades se usa la pendiente del terreno entre cámaras. Negativa = contrapendiente.'
    },
    tuberias_sumideros: null,
    canales: {
        tipo: 'Canal',
        subtitulo: () => null,
        titulo: p => nombreCanal(p.nombre),
        secciones: [
            ['Levantamiento', [
                ['codigo', 'Código', 'mono'],
                ['longitud_eje_m', 'Longitud del eje', 'num:1:m'],
                ['longitud_registrada_m', 'Longitud registrada', 'num:1:m'],
                ['progresivas', 'Progresivas levantadas', 'num:0:'],
                ['secciones_medidas', 'Secciones medidas', 'num:0:'],
                ['secciones_estimadas', 'Secciones estimadas', 'num:0:'],
                ['sin_dimensiones', 'Sin dimensiones', 'num:0:'],
                ['area_seccion_media_m2', 'Área media de sección medida', 'num:2:m²']]],
            ['Relieve (MDS)', [
                ['elevacion_min_m', 'Elevación mínima', 'num:2:m'],
                ['elevacion_max_m', 'Elevación máxima', 'num:2:m'],
                ['desnivel_m', 'Desnivel', 'num:2:m'],
                ['pendiente_media_pct', 'Pendiente media', 'num:2:%'],
                ['tramos_contrapendiente', 'Tramos en contrapendiente', 'tramos']]],
            ['Estado', [
                ['estado_predominante', 'Estado predominante', 'estado:ESTADO'],
                ['progresivas_estado_malo', 'Progresivas en mal estado', 'num:0:'],
                ['progresivas_riesgo_alto', 'Progresivas con riesgo alto', 'num:0:'],
                ['progresivas_embovedadas', 'Progresivas embovedadas', 'num:0:']]]
        ],
        nota: 'Elevaciones y pendientes derivadas del MDS fotogramétrico; deben verificarse con cotas topográficas.'
    },
    progresivas: {
        tipo: 'Sección de canal',
        titulo: p => p.progresiva,
        subtitulo: p => nombreCanal(p.canal),
        secciones: [
            ['Sección', [
                ['dato_estimado', 'Dimensiones', 'medida'],
                ['ancho_superior_m', 'Ancho superior (A)', 'num:2:m'],
                ['ancho_inferior_m', 'Ancho inferior (B)', 'num:2:m'],
                ['profundidad_c_m', 'Profundidad (C)', 'num:2:m'],
                ['profundidad_d_m', 'Profundidad (D)', 'num:2:m'],
                ['area_seccion_m2', 'Área de la sección', 'num:2:m²'],
                ['distancia_m', 'Distancia a la siguiente', 'num:1:m'],
                ['nivel_certeza', 'Nivel de certeza', 'estado:CERTEZA']]],
            ['Construcción y estado', [
                ['revestimiento', 'Revestimiento', 'texto'],
                ['boveda', 'Bóveda', 'texto'],
                ['estado_estructural', 'Estado estructural', 'estado:ESTADO'],
                ['riesgo', 'Riesgo peatonal y vehicular', 'texto'],
                ['paso_vehicular', 'Paso vehicular', 'sino'],
                ['paso_peatonal', 'Paso peatonal', 'sino'],
                ['sedimentos', 'Sedimentos', 'texto']]],
            ['Conexiones y rejilla', [
                ['conexion_pluvial', 'Conexión al alcantarillado pluvial', 'sino'],
                ['conexion_sanitaria', 'Conexión al alcantarillado sanitario', 'sino'],
                ['conexion_natural', 'Conexión a drenaje natural', 'sino'],
                ['rejilla_solidos', 'Rejilla para sólidos', 'sino'],
                ['material_rejilla', 'Material de la rejilla', 'texto'],
                ['estado_rejilla', 'Estado de la rejilla', 'estado:ESTADO']]],
            ['Ubicación y relieve', [
                ['ramal', 'Ramal', 'texto'],
                ['fecha_registro', 'Fecha de registro', 'fecha'],
                ['este', 'Este (UTM 19S)', 'num:2:m'],
                ['norte', 'Norte (UTM 19S)', 'num:2:m'],
                ['elevacion_mds_m', 'Elevación (mínima en 1 m)', 'num:2:m'],
                ['pendiente_long_pct', 'Pendiente al siguiente tramo', 'num:2:%']]]
        ],
        texto: [['observaciones', 'Observaciones de campo']]
    }
};
// Tuberías de sumidero: tramos cortos de la acera a la calzada; el terreno
// no representa la tubería y solo se informa la pendiente hidráulica.
FICHAS.tuberias_sumideros = {
    ...FICHAS.tuberias_camaras,
    tipo: 'Tubería de sumidero',
    nota: 'Pendiente hidráulica = (cota de fondo en el sumidero − cota de fondo en el destino) / longitud × 100. Cota de fondo = elevación del terreno (MDS) menos la profundidad medida. En tramos cortos es muy sensible a los errores de profundidad. Negativa = contrapendiente.'
};

const PALETAS = { ESTADO, CONDICION, CERTEZA, ACCESIBILIDAD };

// Devuelve el valor ya formateado (texto plano) y, si aplica, su color
function valorCampo(props, [campo, , formato]) {
    const v = props[campo];
    if (formato === 'tramos') {
        return props.tramos ? { texto: `${v ?? 0} de ${props.tramos}` } : null;
    }
    if (formato === 'medida') {
        if (v === true) return { texto: 'Estimadas (no medidas)' };
        return props.nivel_certeza === 'CONFIRMADO' ? { texto: 'Medidas en campo' } : { texto: 'Sin registro' };
    }
    if (v === null || v === undefined || v === '') return null;
    if (formato.startsWith('estado:')) {
        const paleta = PALETAS[formato.split(':')[1]];
        return { texto: etiqueta(v), color: colorDe(paleta, v) };
    }
    if (formato.startsWith('num:')) {
        const [, dec, unidad] = formato.split(':');
        const n = numero(v, Number(dec));
        return n === null ? null : { texto: unidad ? `${n} ${unidad}` : n };
    }
    switch (formato) {
        case 'pendiente':
            return { texto: `${numero(v, 2)} %`, color: colorPendiente(v) };
        case 'observacion':
            return { texto: String(v), color: props.pendiente_revisar ? '#a8423a' : '#c39233' };
        case 'desnivel':
            return props.longitud_m ? { texto: `${numero(v * props.longitud_m / 100, 2)} m` } : null;
        case 'mono': return { texto: String(v), mono: true };
        case 'sino': return { texto: siNo(v) };
        case 'fecha': return { texto: fecha(v) };
        case 'canal': return { texto: conCanales(v) };
        case 'sector': return { texto: v === 'OTRA' ? 'Otra codificación (sumideros de canal)' : `Sector ${v}` };
        default: return { texto: etiqueta(v) };
    }
}

function seccionesFicha(reg) {
    const def = FICHAS[reg.capa];
    const secciones = def.secciones.map(([titulo, campos]) => ({
        titulo,
        filas: campos.map(c => ({ etiqueta: c[1], ...(valorCampo(reg.props, c) || {}) })).filter(f => f.texto)
    })).filter(s => s.filas.length);
    if (reg.latlng) {
        const ubic = secciones.find(s => s.titulo.startsWith('Ubicación'));
        const fila = { etiqueta: 'Latitud, longitud', texto: `${reg.latlng.lat.toFixed(6)}, ${reg.latlng.lng.toFixed(6)}` };
        if (ubic) ubic.filas.push(fila);
    }
    return secciones;
}

function tituloFicha(reg) {
    const def = FICHAS[reg.capa];
    return def.titulo ? def.titulo(reg.props) : reg.props.codigo;
}

function colorFicha(reg) {
    if (TEMAS[reg.capa]) return colorTema(reg.capa, reg.props);
    if (reg.capa === 'canales') return colorDe(ESTADO, reg.props.estado_predominante);
    return CAPAS[reg.capa].color;
}

let fichaActual = null;
let fichaVisible = null;  // ficha abierta: { capa, codigo, latlng }

function htmlFicha(reg) {
    fichaActual = reg;
    const def = FICHAS[reg.capa];
    const p = reg.props;
    const subtitulo = def.subtitulo ? def.subtitulo(p) : null;
    const chips = [];
    if (p.sector) chips.push(p.sector === 'OTRA' ? 'Otra codificación' : `Sector ${p.sector}`);
    if (p.nivel_certeza) chips.push(`<i style="background:${colorDe(CERTEZA, p.nivel_certeza)}"></i>${etiqueta(p.nivel_certeza)}`);
    if (reg.capa === 'progresivas' && p.cod_canal) chips.push(p.cod_canal);
    if (p.pendiente_pct !== undefined && p.pendiente_pct !== null && reg.capa.startsWith('tuberias')) {
        chips.unshift(`<i style="background:${colorPendiente(p.pendiente_pct)}"></i>Pendiente ${numero(p.pendiente_pct, 2)} %`);
        if (p.pendiente_revisar) chips.push('A revisar');
    }

    const foto = def.foto ? def.foto(p) : null;
    const urls = foto ? urlsFotoDrive(foto) : [];

    const cuerpo = seccionesFicha(reg).map(s => `
        <section class="ficha__seccion">
            <h4>${esc(s.titulo)}</h4>
            <dl class="ficha__datos">${s.filas.map(f => `
                <dt>${esc(f.etiqueta)}</dt>
                <dd>${f.color ? `<span class="estado"><i style="background:${f.color}"></i>${esc(f.texto)}</span>`
                    : f.mono ? `<span class="mono">${esc(f.texto)}</span>` : esc(f.texto)}</dd>`).join('')}
            </dl>
        </section>`).join('');

    const textos = (def.texto || []).filter(([campo]) => p[campo]).map(([campo, titulo]) => `
        <section class="ficha__seccion"><h4>${esc(titulo)}</h4><p class="ficha__texto">${esc(p[campo])}</p></section>`).join('');
    const nota = def.nota ? `<section class="ficha__seccion"><p class="ficha__texto">${esc(def.nota)}</p></section>` : '';

    return `
        <article style="--color-estado:${colorFicha(reg)}">
            <header class="ficha__cabeza">
                <div class="ficha__tipo">${esc(def.tipo)}</div>
                <div class="ficha__codigo${reg.capa === 'canales' ? ' ficha__codigo--nombre' : ''}">${esc(tituloFicha(reg))}</div>
                ${subtitulo ? `<div class="ficha__subtitulo">${esc(subtitulo)}</div>` : ''}
                ${chips.length ? `<div class="ficha__chips">${chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>` : ''}
            </header>
            <div class="ficha__cuerpo">
                ${def.foto ? `
                    <div class="ficha__foto">
                        ${urls.length ? `<img src="${esc(urls[0])}" alt="Fotografía de campo de ${esc(p.codigo)}" loading="lazy" referrerpolicy="no-referrer" data-urls='${esc(JSON.stringify(urls))}' data-original="${esc(foto)}">` : ''}
                        <div class="sin-foto" ${urls.length ? 'hidden' : ''}>Sin fotografía registrada</div>
                    </div>` : ''}
                ${def.perfil ? htmlPerfil(p) : ''}
                ${cuerpo}${textos}${nota}
            </div>
            <footer class="ficha__pie">
                <button type="button" class="boton" data-accion="pdf">
                    <svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>Ficha PDF</button>
                <button type="button" class="boton" data-accion="ruta">
                    <svg viewBox="0 0 24 24"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>Cómo llegar</button>
                ${foto ? `<a class="boton" href="${esc(foto)}" target="_blank" rel="noopener">
                    <svg viewBox="0 0 24 24"><path d="M4 7h3l2-2h6l2 2h3v12H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Foto original</a>` : ''}
                ${puedeEditar && TABLA_EDICION[reg.capa] ? `
                    <button type="button" class="boton" data-accion="editar">
                        <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>Editar</button>
                    <button type="button" class="boton boton--peligro" data-accion="eliminar">
                        <svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3"/></svg>Eliminar</button>` : ''}
            </footer>
        </article>`;
}

// Perfil longitudinal esquemático del tramo: terreno (MDS), cámaras o
// sumideros en los extremos y fondo de la tubería, con exageración vertical.
function svgPerfil(p, W = 320, H = 132) {
    const largo = Number(p.longitud_m);
    if (p.elevacion_inicio_m == null || p.elevacion_fin_m == null || !largo) return null;
    const zo = Number(p.elevacion_inicio_m), zd = Number(p.elevacion_fin_m);
    const conFondo = p.cota_fondo_inicio_m != null && p.cota_fondo_fin_m != null;
    const fo = Number(p.cota_fondo_inicio_m), fd = Number(p.cota_fondo_fin_m);
    const zs = conFondo ? [zo, zd, fo, fd] : [zo, zd];
    const min = Math.min(...zs), rango = Math.max(Math.max(...zs) - min, 0.5);
    const x0 = 48, x1 = W - 48, yA = 34, yB = H - 34;
    const y = z => +(yB - (z - min) / rango * (yB - yA)).toFixed(1);
    const exageracion = ((yB - yA) / rango) / ((x1 - x0) / largo);
    const corto = t => { const c = conCanales(t) || '¿?'; return c.length > 16 ? `${c.slice(0, 15)}…` : c; };
    const pozo = (x, zt, zf) => `<rect x="${x - 5}" y="${y(zt)}" width="10" height="${Math.max(y(zf) - y(zt), 2).toFixed(1)}" fill="#fff" stroke="#22303d" stroke-width="1.2"/>`;
    const cota = (x, z, ancla) => `<text x="${x}" y="${y(z) + 4}" text-anchor="${ancla}" font-size="9.5" fill="#4b5966">${numero(z, 2)}</text>`;
    const halo = 'stroke="#f6f8fa" stroke-width="3" paint-order="stroke"';
    const ym = conFondo ? (y(fo) + y(fd)) / 2 : (y(zo) + y(zd)) / 2;
    const texto = p.pendiente_pct != null ? `${numero(p.pendiente_pct, 2)} % →` : 'Sentido del flujo →';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="IBM Plex Sans, Arial, sans-serif">
        <rect width="${W}" height="${H}" fill="#f6f8fa"/>
        ${conFondo ? `<polygon points="${x0},${y(zo)} ${x1},${y(zd)} ${x1},${y(fd)} ${x0},${y(fo)}" fill="#ece4d6"/>` : ''}
        <polyline points="${x0 - 34},${y(zo)} ${x0},${y(zo)} ${x1},${y(zd)} ${x1 + 34},${y(zd)}" fill="none" stroke="#8a7a62" stroke-width="2"/>
        ${conFondo ? `${pozo(x0, zo, fo)}${pozo(x1, zd, fd)}
        <line x1="${x0}" y1="${y(fo)}" x2="${x1}" y2="${y(fd)}" stroke="${colorPendiente(p.pendiente_pct)}" stroke-width="4" stroke-linecap="round"/>
        ${cota(x0 - 8, fo, 'end')}${cota(x1 + 8, fd, 'start')}` : ''}
        <text x="${x0}" y="15" text-anchor="middle" font-size="10.5" font-weight="600" fill="#16222e">${esc(corto(p.origen))}</text>
        <text x="${x1}" y="15" text-anchor="middle" font-size="10.5" font-weight="600" fill="#16222e">${esc(corto(p.destino))}</text>
        <text x="${(x0 + x1) / 2}" y="${(ym - 9).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="${p.pendiente_pct < 0 ? '#a8423a' : '#16222e'}" ${halo}>${texto}</text>
        <text x="6" y="${H - 8}" font-size="9" fill="#7a8897">${numero(largo, 1)} m · exageración vertical ×${numero(exageracion, exageracion < 10 ? 1 : 0)}</text>
        <text x="${W - 6}" y="${H - 8}" text-anchor="end" font-size="9" fill="#7a8897">${conFondo ? 'Terreno (MDS) y fondo de la tubería' : 'Solo terreno: sin profundidades'}</text>
    </svg>`;
}

function htmlPerfil(p) {
    const svg = svgPerfil(p);
    return svg ? `<figure class="ficha__perfil" aria-label="Perfil longitudinal del tramo">${svg}</figure>` : '';
}

// Fotos con URLs alternativas y acciones de la ficha
function prepararFicha(popup) {
    const el = popup.getElement();
    if (!el) return;
    el._reg = fichaActual;
    fichaVisible = fichaActual ? { capa: fichaActual.capa, codigo: fichaActual.props.codigo, latlng: popup.getLatLng() } : null;
    if (!el.dataset.listo) {
        el.dataset.listo = '1';
        el.addEventListener('click', e => {
            const b = e.target.closest('[data-accion]');
            if (!b) return;
            if (b.dataset.accion === 'pdf') generarFichaPDF(el._reg);
            if (b.dataset.accion === 'ruta') comoLlegar(el._reg);
            if (b.dataset.accion === 'editar') abrirFormulario({ capa: el._reg.capa, accion: 'modificar', reg: el._reg });
            if (b.dataset.accion === 'eliminar') eliminarElemento(el._reg);
        });
    }
    // El contenido se regenera en cada apertura: la foto se prepara cada vez
    const img = el.querySelector('.ficha__foto img');
    if (img) {
        img.addEventListener('error', () => {
            const urls = JSON.parse(img.dataset.urls);
            const i = Number(img.dataset.idx || 0) + 1;
            if (i < urls.length) {
                img.dataset.idx = i;
                img.src = urls[i];
            } else {
                img.hidden = true;
                img.nextElementSibling.hidden = false;
                img.nextElementSibling.textContent = 'La fotografía no está disponible; use «Foto original».';
            }
        });
        img.addEventListener('click', () => window.open(img.dataset.original, '_blank', 'noopener'));
    }
}

function centroDe(reg) {
    if (reg.latlng) return reg.latlng;
    return reg.layer.getBounds().getCenter();
}

// ---------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------
const TIPO_BUSQUEDA = {
    camaras: 'Cámara', sumideros: 'Sumidero', tuberias_camaras: 'Tubería de cámara',
    tuberias_sumideros: 'Tubería de sumidero', canales: 'Canal', progresivas: 'Sección de canal'
};

function normalizar(s) {
    return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9+]/g, '');
}

function buscar(q) {
    const lista = document.getElementById('resultados');
    const nq = normalizar(q);
    if (nq.length < 2) { lista.innerHTML = ''; return; }
    const hallados = [];
    for (const capa of Object.keys(TIPO_BUSQUEDA)) {
        for (const reg of registro[capa] || []) {
            const textos = [reg.props.codigo, reg.props.codigo_campo, capa === 'canales' ? nombreCanal(reg.props.nombre) : null];
            const puntaje = Math.min(...textos.filter(Boolean).map(t => {
                const nt = normalizar(t);
                return nt === nq ? 0 : nt.startsWith(nq) ? 1 : nt.includes(nq) ? 2 : 9;
            }));
            if (puntaje < 9) hallados.push({ reg, puntaje });
        }
    }
    hallados.sort((a, b) => a.puntaje - b.puntaje || String(a.reg.props.codigo).localeCompare(b.reg.props.codigo));
    if (!hallados.length) {
        lista.innerHTML = '<li class="vacio">Sin coincidencias. Revise el código.</li>';
        return;
    }
    lista.innerHTML = hallados.slice(0, 30).map((h, i) => `
        <li><button type="button" role="option" data-i="${i}">
            <span class="codigo">${esc(h.reg.capa === 'canales' ? nombreCanal(h.reg.props.nombre) : h.reg.props.codigo)}</span>
            <span class="tipo">${esc(TIPO_BUSQUEDA[h.reg.capa])}</span></button></li>`).join('');
    lista.querySelectorAll('button').forEach(b => b.addEventListener('click', () => irA(hallados[Number(b.dataset.i)].reg)));
}

function irA(reg) {
    if (!visibles[reg.capa]) {
        const chk = document.getElementById(`chk-${reg.capa}`);
        chk.checked = true;
        alternarCapa(reg.capa, true);
    }
    if (window.innerWidth <= 760) alternarPanel(false);
    if (reg.latlng) {
        alTerminarMovimiento(() => {
            reg.layer.openPopup();
            const el = reg.layer.getElement();
            if (el) {
                el.classList.add('mk-resaltado');
                setTimeout(() => el.classList.remove('mk-resaltado'), 3000);
            }
        });
        map.setView(reg.latlng, Math.max(map.getZoom(), 19));
    } else {
        alTerminarMovimiento(() => reg.layer.openPopup(reg.layer.getBounds().getCenter()));
        map.fitBounds(reg.layer.getBounds(), { padding: [60, 60], maxZoom: 19 });
    }
}

// Ejecuta fn al terminar el desplazamiento del mapa (o enseguida si no hubo)
function alTerminarMovimiento(fn) {
    let hecho = false;
    const una = () => {
        if (hecho) return;
        hecho = true;
        map.off('moveend', una);
        fn();
    };
    map.on('moveend', una);
    setTimeout(una, 700);
}

// ---------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------
function construirResumen() {
    const n = c => (registro[c] || []).length;
    const km = c => (registro[c] || []).reduce((s, r) => s + (Number(r.props.longitud_m || r.props.longitud_eje_m) || 0), 0) / 1000;
    const inc = resumenDatos?.incidencias || {};
    const totalInc = (inc.CORRECCION || 0) + (inc.ADVERTENCIA || 0) + (inc.ERROR || 0);
    const meta = resumenDatos?.metadatos || {};

    const cifras = [
        [n('camaras').toLocaleString('es-BO'), 'cámaras de inspección'],
        [n('sumideros').toLocaleString('es-BO'), 'sumideros'],
        [`${numero(km('tuberias_camaras') + km('tuberias_sumideros'), 1)} km`, `de tuberías (${(n('tuberias_camaras') + n('tuberias_sumideros')).toLocaleString('es-BO')} tramos)`],
        [`${numero(km('canales'), 1)} km`, `de canales (${n('progresivas')} secciones)`],
        [`${numero(registro.area?.[0]?.props.area_ha, 1)} ha`, 'de área de estudio'],
        [totalInc ? totalInc.toLocaleString('es-BO') : '—', 'incidencias de control registradas']
    ];

    const barras = [
        ['Cámaras por accesibilidad', 'camaras', 'accesibilidad', ACCESIBILIDAD],
        ['Cámaras por estado físico', 'camaras', 'estado_fisico', ESTADO],
        ['Sumideros por condición', 'sumideros', 'condicion', CONDICION],
        ['Secciones de canal por estado estructural', 'progresivas', 'estado_estructural', ESTADO]
    ];

    const htmlBarra = (titulo, capa, campo, clases) => {
        const regs = registro[capa] || [];
        const conteo = clases.map(([v, r, c]) => [r, c, regs.filter(x => x.props[campo] === v).length]).filter(x => x[2]);
        const sin = regs.length - conteo.reduce((s, x) => s + x[2], 0);
        if (sin) conteo.push(['Sin dato', SIN_DATO, sin]);
        return `
            <div class="distribucion">
                <h3>${esc(titulo)}</h3>
                <div class="barra-dist" role="img" aria-label="${esc(titulo)}">
                    ${conteo.map(([, c, v]) => `<span style="width:${(100 * v / regs.length).toFixed(2)}%;background:${c}"></span>`).join('')}
                </div>
                <ul>${conteo.map(([r, c, v]) => `<li><i style="background:${c}"></i>${esc(r)}<span class="n">${v} · ${numero(100 * v / regs.length, 1)} %</span></li>`).join('')}</ul>
            </div>`;
    };

    const htmlPendiente = (titulo, capa) => {
        const regs = registro[capa] || [];
        const valores = regs.map(r => r.props.pendiente_pct).filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
        if (!valores.length) return '';
        const mediana = valores.length % 2 ? valores[(valores.length - 1) / 2]
            : (valores[valores.length / 2 - 1] + valores[valores.length / 2]) / 2;
        const conteo = PENDIENTE.map(([, , r, c]) => [r, c, regs.filter(x => rangoDe(PENDIENTE, x.props.pendiente_pct)?.[2] === r).length]).filter(x => x[2]);
        const sin = regs.length - valores.length;
        if (sin) conteo.push(['Sin datos para calcular', SIN_DATO, sin]);
        const contra = valores.filter(v => v < 0).length;
        const revisar = regs.filter(r => r.props.pendiente_revisar).length;
        return `
            <div class="distribucion">
                <h3>${esc(titulo)}</h3>
                <div class="barra-dist" role="img" aria-label="${esc(titulo)}">
                    ${conteo.map(([, c, v]) => `<span style="width:${(100 * v / regs.length).toFixed(2)}%;background:${c}"></span>`).join('')}
                </div>
                <ul>${conteo.map(([r, c, v]) => `<li><i style="background:${c}"></i>${esc(r)}<span class="n">${v} · ${numero(100 * v / regs.length, 1)} %</span></li>`).join('')}</ul>
                <p class="ayuda" style="margin:6px 0 0">Mediana: ${numero(mediana, 2)} % · de ${numero(valores[0], 2)} a ${numero(valores[valores.length - 1], 2)} % · ${contra} en contrapendiente · ${revisar} a revisar</p>
            </div>`;
    };

    const certeza = resumenDatos?.certeza;
    const htmlCerteza = certeza ? `
        <div class="distribucion">
            <h3>Nivel de certeza por capa</h3>
            ${[['camara', 'Cámaras'], ['sumidero', 'Sumideros'], ['tuberia_camara', 'Tuberías de cámaras'],
               ['tuberia_sumidero', 'Tuberías de sumideros'], ['canal_progresiva', 'Secciones de canal']].map(([k, nombre]) => {
                const t = Object.values(certeza[k] || {}).reduce((s, v) => s + v, 0);
                return `<div style="margin-bottom:8px"><div class="ayuda" style="margin:0 0 4px">${nombre}</div>
                    <div class="barra-dist">${CERTEZA.map(([v, , c]) => (certeza[k]?.[v] ? `<span title="${etiqueta(v)}: ${certeza[k][v]}" style="width:${(100 * certeza[k][v] / t).toFixed(2)}%;background:${c}"></span>` : '')).join('')}</div></div>`;
            }).join('')}
            <ul>${CERTEZA.map(([, r, c]) => `<li><i style="background:${c}"></i>${r}</li>`).join('')}</ul>
        </div>` : '';

    document.getElementById('resumen').innerHTML = `
        <div class="cifras">${cifras.map(([v, r]) => `<div class="cifra"><span class="valor">${v}</span><span class="rotulo">${esc(r)}</span></div>`).join('')}</div>
        ${barras.map(b => htmlBarra(...b)).join('')}
        ${htmlPendiente('Tuberías de cámaras por pendiente', 'tuberias_camaras')}
        ${htmlPendiente('Tuberías de sumideros por pendiente', 'tuberias_sumideros')}
        ${htmlCerteza}
        ${totalInc ? `<p class="pie-dato">Control de calidad: ${inc.CORRECCION || 0} correcciones con reglas documentadas, ${inc.ADVERTENCIA || 0} advertencias y ${inc.ERROR || 0} errores pendientes de verificación.</p>` : ''}
        <p class="pie-dato">${meta.procesado ? `Base procesada el ${esc(meta.procesado)}. ` : ''}${meta.version ? `Última actualización: ${esc(horaVersion(meta.version))}. ` : ''}${meta.ediciones ? `${meta.ediciones} ediciones desde QGIS. ` : ''}Fuente: ${fuenteDatos === 'supabase' ? 'base PostGIS en línea' : 'copia local de los datos'}.</p>`;
}

// ---------------------------------------------------------------------
// Panel, pestañas y avisos
// ---------------------------------------------------------------------
function alternarPanel(abrir) {
    const cerrado = abrir === undefined ? !document.body.classList.contains('panel-cerrado') : !abrir;
    document.body.classList.toggle('panel-cerrado', cerrado);
    document.getElementById('btnPanel').setAttribute('aria-expanded', String(!cerrado));
    setTimeout(() => map.invalidateSize(), 260);
}

function mostrarPestana(nombre) {
    document.querySelectorAll('.pestanas [role="tab"]').forEach(t => {
        const activa = t.dataset.tab === nombre;
        t.setAttribute('aria-selected', String(activa));
        document.getElementById(`p-${t.dataset.tab}`).hidden = !activa;
    });
}

let temporizadorAviso = null;
function aviso(texto, tipo = '') {
    const el = document.getElementById('aviso');
    el.textContent = texto;
    el.className = `aviso ${tipo}`;
    el.hidden = false;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => { el.hidden = true; }, 4500);
}

// ---------------------------------------------------------------------
// Ubicación y rutas
// ---------------------------------------------------------------------
const origenIcon = L.divIcon({ className: '', html: '<div class="marcador-ruta origen"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
const destinoIcon = L.divIcon({ className: '', html: '<div class="marcador-ruta destino"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });

function obtenerUbicacion(callback) {
    if (!navigator.geolocation) {
        aviso('Su navegador no permite obtener la ubicación.', 'error');
        return;
    }
    aviso('Obteniendo su ubicación…');
    navigator.geolocation.getCurrentPosition(
        position => {
            const { latitude: lat, longitude: lon } = position.coords;
            userLocation = [lat, lon];
            if (window.userMarker) map.removeLayer(window.userMarker);
            window.userMarker = L.marker([lat, lon], {
                icon: L.divIcon({ className: '', html: '<div class="marcador-usuario"></div>', iconSize: [16, 16], iconAnchor: [8, 8] })
            }).addTo(map).bindTooltip('Su ubicación', { className: 'etiqueta-mapa' });
            if (callback) callback();
            else map.setView([lat, lon], 17);
            aviso('Ubicación obtenida.');
        },
        error => {
            const mensajes = { 1: 'Permiso de ubicación denegado.', 2: 'Ubicación no disponible.', 3: 'Se agotó el tiempo de espera.' };
            aviso(mensajes[error.code] || 'No se pudo obtener la ubicación.', 'error');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function mostrarEstadoRuta(mensaje, tipo) {
    const status = document.getElementById('routeStatus');
    status.textContent = mensaje;
    status.className = `mensaje ${tipo || ''}`;
}

function fijarPunto(tipo, lat, lon) {
    document.getElementById(`${tipo}Lat`).value = lat.toFixed(6);
    document.getElementById(`${tipo}Lon`).value = lon.toFixed(6);
    if (tipo === 'origen') {
        if (origenMarker) map.removeLayer(origenMarker);
        origenMarker = L.marker([lat, lon], { icon: origenIcon }).addTo(map).bindTooltip('Origen', { className: 'etiqueta-mapa' });
    } else {
        if (destinoMarker) map.removeLayer(destinoMarker);
        destinoMarker = L.marker([lat, lon], { icon: destinoIcon }).addTo(map).bindTooltip('Destino', { className: 'etiqueta-mapa' });
    }
}

function usarUbicacionActual(tipo) {
    const aplicar = () => {
        fijarPunto(tipo, userLocation[0], userLocation[1]);
        mostrarEstadoRuta('Su ubicación quedó como origen.', 'success');
    };
    if (userLocation) aplicar(); else obtenerUbicacion(aplicar);
}

function seleccionarEnMapa(tipo) {
    seleccionandoPunto = tipo;
    mostrarEstadoRuta(`Haga clic en el mapa para fijar el ${tipo}.`, '');
    map.getContainer().style.cursor = 'crosshair';
    if (window.innerWidth <= 760) alternarPanel(false);
}

function agregarPuntoSeleccionado(latlng) {
    fijarPunto(seleccionandoPunto, latlng.lat, latlng.lng);
    mostrarEstadoRuta(`${seleccionandoPunto === 'origen' ? 'Origen' : 'Destino'} fijado en el mapa.`, 'success');
    map.getContainer().style.cursor = '';
    seleccionandoPunto = null;
    if (window.innerWidth <= 760) alternarPanel(true);
}

function comoLlegar(reg) {
    const c = centroDe(reg);
    fijarPunto('destino', c.lat, c.lng);
    map.closePopup();
    mostrarPestana('rutas');
    alternarPanel(true);
    if (userLocation) {
        fijarPunto('origen', userLocation[0], userLocation[1]);
        calcularRuta();
    } else {
        mostrarEstadoRuta(`Destino: ${reg.props.codigo || nombreCanal(reg.props.nombre)}. Indique el origen con «Mi ubicación» o en el mapa.`, '');
    }
}

async function calcularRuta() {
    const origenLat = parseFloat(document.getElementById('origenLat').value);
    const origenLon = parseFloat(document.getElementById('origenLon').value);
    const destinoLat = parseFloat(document.getElementById('destinoLat').value);
    const destinoLon = parseFloat(document.getElementById('destinoLon').value);
    const profile = document.getElementById('routeProfile').value;

    if ([origenLat, origenLon, destinoLat, destinoLon].some(isNaN)) {
        mostrarEstadoRuta('Indique coordenadas válidas para el origen y el destino.', 'error');
        return;
    }
    mostrarEstadoRuta('Calculando rutas…', '');

    try {
        const osrmProfile = profile === 'driving-car' ? 'driving' : profile === 'cycling-regular' ? 'cycling' : 'foot';
        const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${origenLon},${origenLat};${destinoLon},${destinoLat}?overview=full&geometries=geojson&alternatives=true`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('el servicio de rutas no respondió');
        const data = await response.json();
        if (data.code !== 'Ok' || !data.routes?.length) throw new Error('no se encontró un recorrido');

        currentRoutes = data.routes.slice(0, 3);
        routeLayers.forEach(l => map.removeLayer(l));
        routeLayers = [];
        const estilos = [
            { color: '#1d5a85', nombre: 'Ruta principal', weight: 6, opacity: 0.85 },
            { color: '#5f93bd', nombre: 'Alternativa 1', weight: 5, opacity: 0.75 },
            { color: '#8fb3cf', nombre: 'Alternativa 2', weight: 5, opacity: 0.75 }
        ];
        const todas = [];
        currentRoutes.slice().reverse().forEach((route, k) => {
            const i = currentRoutes.length - 1 - k;
            const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
            todas.push(...coords);
            const e = estilos[i];
            routeLayers.push(L.polyline(coords, { color: e.color, weight: e.weight, opacity: e.opacity })
                .bindTooltip(`${e.nombre}: ${(route.distance / 1000).toFixed(2)} km`, { sticky: true, className: 'etiqueta-mapa' })
                .addTo(map));
        });
        if (!origenMarker) fijarPunto('origen', origenLat, origenLon);
        if (!destinoMarker) fijarPunto('destino', destinoLat, destinoLon);
        map.fitBounds(L.latLngBounds(todas), { padding: [50, 50] });

        const info = document.getElementById('routeInfo');
        const modo = { 'driving-car': 'vehículo', 'cycling-regular': 'bicicleta', 'foot-walking': 'a pie' }[profile];
        info.innerHTML = currentRoutes.map((r, i) => `
            <div class="ruta" style="border-left-color:${estilos[i].color}">
                <strong>${estilos[i].nombre}</strong>
                ${(r.distance / 1000).toFixed(2)} km · ${Math.round(r.duration / 60)} min en ${modo}
            </div>`).join('');
        info.hidden = false;
        document.getElementById('btnLimpiarRuta').hidden = false;
        mostrarEstadoRuta(`${currentRoutes.length === 1 ? 'Se encontró 1 ruta' : `Se encontraron ${currentRoutes.length} rutas`}.`, 'success');
    } catch (error) {
        mostrarEstadoRuta(`No se pudo calcular la ruta: ${error.message}.`, 'error');
    }
}

function limpiarRuta() {
    routeLayers.forEach(l => map.removeLayer(l));
    routeLayers = [];
    [origenMarker, destinoMarker].forEach(m => m && map.removeLayer(m));
    origenMarker = destinoMarker = null;
    ['origenLat', 'origenLon', 'destinoLat', 'destinoLon'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('routeInfo').hidden = true;
    document.getElementById('btnLimpiarRuta').hidden = true;
    currentRoutes = [];
    mostrarEstadoRuta('', '');
}

// ---------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    if (window.innerWidth <= 760) document.body.classList.add('panel-cerrado');
    initMap();
    document.getElementById('btnPanel').addEventListener('click', () => alternarPanel());
    document.querySelectorAll('.pestanas [role="tab"]').forEach(t => t.addEventListener('click', () => mostrarPestana(t.dataset.tab)));
    document.getElementById('buscador').addEventListener('input', e => buscar(e.target.value));
    document.getElementById('buscador').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.querySelector('#resultados button')?.click();
    });
    prepararSesion();
    cargarCapa();
});

// =====================================================================
// Edición desde el geoportal (usuarios autorizados)
// =====================================================================
// Las cuentas son de Supabase Auth (las crea usuarios_web.py del proyecto
// PostGIS). La base solo acepta cambios de usuarios autorizados y los valida
// igual que las ediciones de QGIS; el mapa se actualiza en tiempo real.
const DOMINIO_USUARIOS = 'geoportal.local';  // el mismo de usuarios_web.py
const TABLA_EDICION = { camaras: 'camara', sumideros: 'sumidero', tuberias_camaras: 'tuberia_camara', tuberias_sumideros: 'tuberia_sumidero' };
const NOMBRE_ELEMENTO = { camaras: 'cámara', sumideros: 'sumidero', tuberias_camaras: 'tubería de cámara', tuberias_sumideros: 'tubería de sumidero' };

// [columna, etiqueta, tipo]. Tipos: codigo, lista:<dominio>, numero, entero, sino, fecha, texto.
// Los campos calculados (sector, certeza, elevación, pendiente…) los completa la base.
const CAMPOS_TUBERIA = [
    ['funcion', 'Función', 'lista:funcion'],
    ['material', 'Material', 'lista:material_tuberia'],
    ['diametro_pulg', 'Diámetro (pulg)', 'numero'],
    ['profundidad_m', 'Profundidad (m)', 'numero']
];
const CAMPOS_EDICION = {
    camaras: [
        ['cod_cam', 'Código', 'codigo'],
        ['accesibilidad', 'Accesibilidad', 'lista:accesibilidad'],
        ['estado_fisico', 'Estado físico', 'lista:estado'],
        ['funcionamiento_drenaje', 'Funcionamiento del drenaje', 'lista:estado'],
        ['condicion_interior', 'Condición interior', 'lista:condicion'],
        ['localizacion', 'Localización', 'lista:localizacion'],
        ['ubicacion', 'Ubicación en la vía', 'lista:ubicacion'],
        ['tipo_camara', 'Tipo de cámara', 'lista:tipo_camara'],
        ['tipo_ci', 'Configuración', 'lista:tipo_ci'],
        ['tipo_tapa', 'Tipo de tapa', 'lista:tipo_tapa'],
        ['diametro_tapa_m', 'Diámetro de la tapa (m)', 'numero'],
        ['altura_tapa_m', 'Altura de la tapa (m)', 'numero'],
        ['rasante', 'Rasante', 'lista:rasante'],
        ['material_rasante', 'Material de la rasante', 'lista:material_rasante'],
        ['altura_solera_m', 'Altura de solera (m)', 'numero'],
        ['prof_tub_entrada_m', 'Profundidad de entrada (m)', 'numero'],
        ['prof_tub_salida_m', 'Profundidad de salida (m)', 'numero'],
        ['n_entradas', 'Tuberías de entrada', 'entero'],
        ['n_salidas', 'Tuberías de salida', 'entero'],
        ['localizacion_dano', 'Localización del daño', 'lista:localizacion_dano'],
        ['escalones', 'Escalones', 'sino'],
        ['estado_escalones', 'Estado de los escalones', 'lista:estado'],
        ['gestion', 'Gestión de construcción', 'entero'],
        ['fecha_registro', 'Fecha de registro', 'fecha'],
        ['observaciones', 'Observaciones', 'texto']
    ],
    sumideros: [
        ['cod_sum', 'Código', 'codigo'],
        ['apertura', 'Abierto en la inspección', 'sino'],
        ['condicion', 'Condición de funcionamiento', 'lista:condicion'],
        ['estado_estructura', 'Estado de la estructura', 'lista:estado'],
        ['tipo_rejilla', 'Tipo de rejilla', 'lista:tipo_rejilla'],
        ['estado_rejilla', 'Estado de la rejilla', 'lista:estado'],
        ['sedimento', 'Tipo de sedimento', 'lista:sedimento'],
        ['altura_sedimento_m', 'Altura de sedimento (m)', 'numero'],
        ['material_rasante', 'Material de la rasante', 'lista:material_rasante'],
        ['cuneta', 'Cuneta', 'sino'],
        ['ancho_m', 'Ancho (m)', 'numero'],
        ['largo_m', 'Largo (m)', 'numero'],
        ['espesor_m', 'Espesor de la rejilla (m)', 'numero'],
        ['altura_solera_m', 'Altura de solera (m)', 'numero'],
        ['fecha_registro', 'Fecha de registro', 'fecha'],
        ['justificacion', 'Motivo (apertura)', 'texto'],
        ['observaciones', 'Observaciones', 'texto']
    ],
    tuberias_camaras: [...CAMPOS_TUBERIA, ['estado', 'Estado', 'lista:estado'], ['observaciones', 'Observaciones', 'texto']],
    tuberias_sumideros: [...CAMPOS_TUBERIA, ['observaciones', 'Observaciones', 'texto']]
};

let sesion = null;          // { correo, usuario }
let puedeEditar = false;
let dominios = null;        // listas controladas para los formularios
let controlEdicion = null;
let modoEdicion = null;     // agregar con clics en el mapa
let capaGuia = null;        // marcas mientras se dibuja una tubería
let vistaPrevia = null;     // elemento nuevo mientras el formulario está abierto
let formularioActual = null;
let inicioClic = null;

const esperar = ms => new Promise(r => setTimeout(r, ms));
const primeraMayuscula = t => t.charAt(0).toUpperCase() + t.slice(1);

// ---- Sesión ------------------------------------------------------------
function prepararSesion() {
    const cfg = window.GEOPORTAL_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
    document.getElementById('btnSesion').hidden = false;
    document.getElementById('btnSesion').addEventListener('click', abrirSesion);
    document.getElementById('formSesion').addEventListener('submit', entrar);
    document.getElementById('sesionSalir').addEventListener('click', salir);
    document.getElementById('formEdicion').addEventListener('submit', guardarFormulario);
    document.getElementById('dialogoEdicion').addEventListener('close', () => {
        if (vistaPrevia) map.removeLayer(vistaPrevia);
        vistaPrevia = null;
    });
    document.querySelectorAll('dialog [data-cerrar]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
}

function abrirSesion() {
    const activa = !!sesion;
    document.getElementById('sesionEntrada').hidden = activa;
    document.getElementById('sesionActiva').hidden = !activa;
    document.getElementById('sesionEntrar').hidden = activa;
    document.getElementById('sesionSalir').hidden = !activa;
    document.querySelector('#dialogoSesion [data-cerrar]').textContent = activa ? 'Cerrar' : 'Cancelar';
    if (activa) {
        document.getElementById('sesionNombre').textContent = puedeEditar
            ? `Usuario «${sesion.usuario}», autorizado para editar. Use la barra «Agregar» del mapa o los botones «Editar» y «Eliminar» de cada ficha.`
            : `Usuario «${sesion.usuario}», sin permiso de edición. Pida al administrador que lo autorice.`;
    }
    document.getElementById('sesionMensaje').textContent = '';
    document.getElementById('dialogoSesion').showModal();
    if (!activa) document.getElementById('sesionUsuario').focus();
    clienteSupabase().catch(() => {});  // la biblioteca se descarga mientras se escribe
}

async function entrar(e) {
    e.preventDefault();
    const usuario = document.getElementById('sesionUsuario').value.trim().toLowerCase();
    const clave = document.getElementById('sesionClave').value;
    const mensaje = document.getElementById('sesionMensaje');
    const boton = document.getElementById('sesionEntrar');
    if (!usuario || !clave) {
        mensaje.textContent = 'Escriba su usuario y su contraseña.';
        return;
    }
    boton.disabled = true;
    boton.textContent = 'Entrando…';
    mensaje.textContent = '';
    try {
        const cliente = await clienteSupabase();
        const correo = usuario.includes('@') ? usuario : `${usuario}@${DOMINIO_USUARIOS}`;
        const { error } = await cliente.auth.signInWithPassword({ email: correo, password: clave });
        if (error) {
            mensaje.textContent = /invalid login credentials/i.test(error.message)
                ? 'Usuario o contraseña incorrectos.' : `No se pudo iniciar sesión: ${error.message}`;
            return;
        }
        document.getElementById('sesionClave').value = '';
        document.getElementById('dialogoSesion').close();
    } catch (error) {
        mensaje.textContent = 'No se pudo conectar con el servidor. Revise su conexión a internet.';
    } finally {
        boton.disabled = false;
        boton.textContent = 'Entrar';
    }
}

async function salir() {
    const cliente = await clienteSupabase();
    await cliente.auth.signOut();
    document.getElementById('dialogoSesion').close();
}

// Inicio o cierre de sesión (también al volver a abrir la página con la sesión guardada)
async function cambioDeSesion(s) {
    const correo = s?.user?.email || null;
    if (correo === (sesion?.correo || null)) return;  // renovación del token
    sesion = correo ? { correo, usuario: correo.endsWith(`@${DOMINIO_USUARIOS}`) ? correo.split('@')[0] : correo } : null;
    puedeEditar = false;
    if (sesion) {
        try {
            const cliente = await clienteSupabase();
            const permiso = await cliente.rpc('geoportal_puede_editar');
            if (permiso.data === true) {
                dominios ||= (await cliente.rpc('geoportal_dominios')).data || {};
                puedeEditar = true;
            }
        } catch (error) {
            console.warn('No se pudo verificar el permiso de edición:', error);
        }
        aviso(puedeEditar ? `Sesión iniciada: ${sesion.usuario}. Puede agregar y editar elementos.`
            : `Sesión iniciada: ${sesion.usuario}, sin permiso de edición.`, puedeEditar ? '' : 'error');
    } else {
        aviso('Sesión cerrada.');
    }
    pintarSesion();
}

function pintarSesion() {
    const boton = document.getElementById('btnSesion');
    document.getElementById('textoSesion').textContent = sesion ? sesion.usuario : 'Iniciar sesión';
    boton.classList.toggle('activa', !!sesion);
    boton.title = sesion ? 'Sesión iniciada (clic para cerrarla)' : 'Iniciar sesión para editar';
    if (puedeEditar && !controlEdicion) controlEdicion = crearControlEdicion().addTo(map);
    if (!puedeEditar && controlEdicion) {
        cancelarModo();
        controlEdicion.remove();
        controlEdicion = null;
    }
    map.closePopup();  // las fichas muestran u ocultan «Editar» según la sesión
}

// ---- Barra «Agregar» y selección en el mapa ----------------------------
function crearControlEdicion() {
    const Control = L.Control.extend({
        options: { position: 'topleft' },
        onAdd() {
            const div = L.DomUtil.create('div', 'edicion');
            div.setAttribute('role', 'toolbar');
            div.setAttribute('aria-label', 'Agregar elementos');
            div.innerHTML = `
                <span class="edicion__titulo">Agregar</span>
                ${Object.keys(TABLA_EDICION).map(capa => `
                    <button type="button" data-agregar="${capa}" aria-pressed="false">${simboloCapa(capa)}<span>${esc(primeraMayuscula(NOMBRE_ELEMENTO[capa]))}</span></button>`).join('')}
                <div class="edicion__guia" role="status" hidden><span></span><button type="button" data-cancelar>Cancelar</button></div>`;
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);
            div.addEventListener('click', e => {
                const b = e.target.closest('button');
                if (b?.dataset.agregar) iniciarModo(b.dataset.agregar);
                if (b?.hasAttribute('data-cancelar')) cancelarModo();
            });
            return div;
        }
    });
    return new Control();
}

function guia(texto) {
    const el = document.querySelector('.edicion__guia');
    if (!el) return;
    el.hidden = !texto;
    if (texto) el.querySelector('span').textContent = texto;
}

function iniciarModo(capa) {
    cancelarModo();
    const tuberia = capa.startsWith('tuberias');
    const deSumidero = capa === 'tuberias_sumideros';
    modoEdicion = {
        capa, tuberia, origen: null,
        origenes: deSumidero ? ['sumideros'] : ['camaras'],
        destinos: deSumidero ? ['camaras', 'sumideros'] : ['camaras']
    };
    // Los elementos que se deben tocar tienen que verse en el mapa
    [...modoEdicion.origenes, ...modoEdicion.destinos].forEach(c => {
        if (tuberia && !visibles[c]) {
            document.getElementById(`chk-${c}`).checked = true;
            alternarCapa(c, true);
        }
    });
    guia(tuberia
        ? `Haga clic en ${deSumidero ? 'el sumidero' : 'la cámara'} de origen (de donde sale el agua).`
        : `Haga clic en el mapa donde está ${capa === 'camaras' ? 'la cámara' : 'el sumidero'}. Acérquese para ubicarlo con precisión.`);
    map.closePopup();
    const c = map.getContainer();
    c.classList.add('seleccionando');
    c.addEventListener('pointerdown', alPresionarEdicion, true);
    c.addEventListener('click', alClicEdicion, true);
    map.on('mousemove', alMoverEdicion);
    document.addEventListener('keydown', alTeclaEdicion);
    document.querySelectorAll('.edicion [data-agregar]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.agregar === capa)));
}

function cancelarModo() {
    if (!modoEdicion) return;
    modoEdicion = null;
    const c = map.getContainer();
    c.classList.remove('seleccionando');
    c.removeEventListener('pointerdown', alPresionarEdicion, true);
    c.removeEventListener('click', alClicEdicion, true);
    map.off('mousemove', alMoverEdicion);
    document.removeEventListener('keydown', alTeclaEdicion);
    if (capaGuia) map.removeLayer(capaGuia);
    capaGuia = null;
    guia(null);
    document.querySelectorAll('.edicion [data-agregar]').forEach(b => b.setAttribute('aria-pressed', 'false'));
}

function alPresionarEdicion(e) {
    inicioClic = [e.clientX, e.clientY];
}

function alTeclaEdicion(e) {
    if (e.key === 'Escape') cancelarModo();
}

function alMoverEdicion(e) {
    const linea = capaGuia?.getLayers().find(l => l instanceof L.Polyline && !(l instanceof L.CircleMarker));
    if (modoEdicion?.origen && linea) linea.setLatLngs([modoEdicion.origen.latlng, e.latlng]);
}

// Se captura el clic antes que Leaflet: mientras se agrega no se abren fichas
function alClicEdicion(e) {
    if (e.target.closest('.leaflet-control')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (inicioClic && Math.hypot(e.clientX - inicioClic[0], e.clientY - inicioClic[1]) > 6) return;  // fue un arrastre
    const m = modoEdicion;
    const latlng = map.mouseEventToLatLng(e);
    if (!m.tuberia) {
        cancelarModo();
        abrirFormulario({ capa: m.capa, accion: 'agregar', latlng,
            geometria: { type: 'Point', coordinates: [redondear(latlng.lng), redondear(latlng.lat)] } });
        return;
    }
    const reg = elementoCercano(latlng, m.origen ? m.destinos : m.origenes);
    if (!reg || reg === m.origen) {
        aviso(m.origen ? 'Haga clic sobre el elemento de destino.' : 'Haga clic sobre el elemento de origen.');
        return;
    }
    if (!m.origen) {
        m.origen = reg;
        capaGuia = L.layerGroup([
            L.circleMarker(reg.latlng, { radius: 15, color: '#a8423a', weight: 3, fill: false, interactive: false, pane: 'pEtiquetas' }),
            L.polyline([reg.latlng, reg.latlng], { color: '#a8423a', weight: 3, dashArray: '6 6', interactive: false, pane: 'pEtiquetas' })
        ]).addTo(map);
        guia(`Origen: ${reg.props.codigo}. Ahora haga clic en ${m.capa === 'tuberias_sumideros' ? 'la cámara o el sumidero' : 'la cámara'} de destino.`);
        return;
    }
    cancelarModo();
    abrirFormulario({ capa: m.capa, accion: 'agregar', origen: m.origen, destino: reg,
        geometria: { type: 'LineString', coordinates: [m.origen.geometry.coordinates, reg.geometry.coordinates] } });
}

function redondear(v) {
    return Math.round(v * 1e7) / 1e7;
}

function elementoCercano(latlng, capas, tolerancia = 24) {
    const p = map.latLngToContainerPoint(latlng);
    let mejor = null, minimo = tolerancia;
    capas.forEach(capa => (registro[capa] || []).forEach(reg => {
        const d = map.latLngToContainerPoint(reg.latlng).distanceTo(p);
        if (d < minimo) { minimo = d; mejor = reg; }
    }));
    return mejor;
}

// Código sugerido: sector de la cámara más cercana y el siguiente número libre;
// los sumideros toman el código de la cámara más cercana (a menos de 80 m).
function codigoSugerido(capa, latlng) {
    let cercana = null, minimo = Infinity;
    (registro.camaras || []).forEach(reg => {
        const d = map.distance(latlng, reg.latlng);
        if (d < minimo) { minimo = d; cercana = reg; }
    });
    const siguiente = (lista, prefijo, desde, ancho) => String(Math.max(0, ...lista
        .filter(r => r.props.codigo.startsWith(prefijo))
        .map(r => Number(r.props.codigo.slice(desde)) || 0)) + 1).padStart(ancho, '0');
    if (capa === 'camaras') {
        const sector = cercana?.props.sector || 'A';
        return `PCC${sector}${siguiente(registro.camaras, `PCC${sector}`, 4, 3)}`;
    }
    if (!cercana || minimo > 80) return '';
    const base = cercana.props.codigo;
    return `${base}SM${siguiente(registro.sumideros, `${base}SM`, base.length + 2, 2)}`;
}

// ---- Formulario ----------------------------------------------------------
function valorActual(reg, columna) {
    return columna.startsWith('cod_') ? reg.props.codigo : reg.props[columna];
}

function hoy() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });  // AAAA-MM-DD
}

function htmlCampo([col, rotulo, tipo], valor, accion) {
    const id = `ed-${col}`;
    const v = valor ?? '';
    let control;
    if (tipo === 'codigo') {
        control = accion === 'agregar'
            ? `<input class="campo mono" id="${id}" name="${col}" value="${esc(v)}" autocomplete="off" spellcheck="false" autocapitalize="characters">`
            : `<input class="campo mono" id="${id}" value="${esc(v)}" readonly>`;
    } else if (tipo.startsWith('lista:')) {
        let valores = dominios?.[tipo.slice(6)] || [];
        if (v !== '' && !valores.includes(v)) valores = [v, ...valores];  // valor antiguo fuera de la lista
        control = `<select class="campo" id="${id}" name="${col}"><option value="">Sin dato</option>
            ${valores.map(x => `<option value="${esc(x)}"${x === v ? ' selected' : ''}>${esc(etiqueta(x))}</option>`).join('')}</select>`;
    } else if (tipo === 'sino') {
        control = `<select class="campo" id="${id}" name="${col}"><option value="">Sin dato</option>
            <option value="true"${v === true ? ' selected' : ''}>Sí</option><option value="false"${v === false ? ' selected' : ''}>No</option></select>`;
    } else if (tipo === 'fecha') {
        control = `<input class="campo" type="date" id="${id}" name="${col}" value="${esc(v)}">`;
    } else if (tipo === 'texto') {
        control = `<textarea class="campo" id="${id}" name="${col}" rows="2">${esc(v)}</textarea>`;
    } else {
        control = `<input class="campo" id="${id}" name="${col}" inputmode="${tipo === 'entero' ? 'numeric' : 'decimal'}" autocomplete="off"
            value="${esc(v === '' ? '' : String(v).replace('.', ','))}">`;
    }
    return `<div class="campo-form${tipo === 'texto' ? ' campo-form--ancho' : ''}"><label class="etiqueta" for="${id}">${esc(rotulo)}</label>${control}</div>`;
}

function abrirFormulario(op) {
    if (!puedeEditar) return;
    formularioActual = op;
    const { capa, accion, reg } = op;
    const nombre = NOMBRE_ELEMENTO[capa];
    map.closePopup();
    document.getElementById('tituloEdicion').textContent = accion === 'agregar'
        ? `Agregar ${nombre}` : `Editar ${nombre} ${reg.props.codigo}`;
    document.getElementById('subtituloEdicion').textContent = accion === 'modificar'
        ? 'El sector, la certeza, las elevaciones y la pendiente los calcula la base al guardar.'
        : op.origen ? `De ${op.origen.props.codigo} a ${op.destino.props.codigo}. El código, la longitud y la pendiente se calculan al guardar.`
        : 'Ubicación marcada en el mapa. La elevación se interpola de los elementos vecinos.';
    const sugerido = accion === 'agregar' && op.latlng ? codigoSugerido(capa, op.latlng) : '';
    document.getElementById('camposEdicion').innerHTML = CAMPOS_EDICION[capa].map(c => htmlCampo(c,
        accion === 'modificar' ? valorActual(reg, c[0]) : c[2] === 'codigo' ? sugerido : c[2] === 'fecha' ? hoy() : null,
        accion)).join('');
    document.getElementById('edicionMensaje').textContent = '';

    if (vistaPrevia) map.removeLayer(vistaPrevia);
    vistaPrevia = null;
    if (op.geometria) {
        const puntos = op.geometria.type === 'Point' ? [op.geometria.coordinates] : op.geometria.coordinates;
        const ll = puntos.map(([lon, lat]) => L.latLng(lat, lon));
        vistaPrevia = (ll.length === 1
            ? L.circleMarker(ll[0], { radius: 9, color: '#ffffff', weight: 3, fillColor: '#a8423a', fillOpacity: 1, interactive: false, pane: 'pEtiquetas' })
            : L.polyline(ll, { color: '#a8423a', weight: 5, interactive: false, pane: 'pEtiquetas' })).addTo(map);
    }
    document.getElementById('dialogoEdicion').showModal();
    document.querySelector('#camposEdicion .campo:not([readonly])')?.focus();
}

function iguales(a, b) {
    if (a === null || a === undefined || a === '') return b === null;
    if (typeof a === 'number') return Number(b) === a;
    return String(a) === String(b);
}

function leerFormulario() {
    const { capa, accion, reg } = formularioActual;
    const datos = {};
    for (const [col, rotulo, tipo] of CAMPOS_EDICION[capa]) {
        const el = document.getElementById(`ed-${col}`);
        if (!el?.name) continue;  // código de solo lectura
        const texto = el.value.trim();
        let v = texto === '' ? null : texto;
        if (v !== null && (tipo === 'numero' || tipo === 'entero')) {
            v = Number(texto.replace(',', '.'));
            if (!Number.isFinite(v) || v < 0 || (tipo === 'entero' && !Number.isInteger(v))) {
                throw new Error(`${rotulo}: escriba un número ${tipo === 'entero' ? 'entero ' : ''}válido (por ejemplo 1,25).`);
            }
        }
        if (v !== null && tipo === 'sino') v = texto === 'true';
        if (v !== null && tipo === 'codigo') v = texto.toUpperCase();
        if (tipo === 'codigo' && v === null) throw new Error('Escriba el código del elemento.');
        if (accion === 'agregar' ? v !== null : !iguales(valorActual(reg, col), v)) datos[col] = v;
    }
    return datos;
}

async function editarEnBase(capa, accion, codigo, atributos = {}, geometria = null) {
    const cliente = await clienteSupabase();
    const { data, error } = await cliente.rpc('geoportal_editar', {
        p_capa: TABLA_EDICION[capa], p_accion: accion, p_codigo: codigo || null,
        p_atributos: atributos, p_geometria: geometria, p_desde: versionActual || null
    });
    if (error) {
        throw new Error(error.code === '42501' || /permission denied|JWT/i.test(error.message)
            ? 'Su sesión no tiene permiso para editar o venció. Vuelva a iniciar sesión.' : error.message);
    }
    return data;
}

async function guardarFormulario(e) {
    e.preventDefault();
    const op = formularioActual;
    const mensaje = document.getElementById('edicionMensaje');
    const boton = document.getElementById('edicionGuardar');
    let atributos;
    try {
        atributos = leerFormulario();
    } catch (error) {
        mensaje.textContent = error.message;
        return;
    }
    if (op.accion === 'modificar' && !Object.keys(atributos).length) {
        mensaje.textContent = 'No hay cambios para guardar.';
        return;
    }
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    mensaje.textContent = '';
    try {
        const r = await editarEnBase(op.capa, op.accion, op.reg?.props.codigo, atributos, op.geometria || null);
        document.getElementById('dialogoEdicion').close();
        const nombre = NOMBRE_ELEMENTO[op.capa];
        await mostrarResultado(op.capa, r.codigo, r, op.accion === 'agregar'
            ? `Se agregó ${nombre} ${r.codigo}.` : `Se guardaron los cambios de ${r.codigo}.`);
    } catch (error) {
        mensaje.textContent = error.message;
    } finally {
        boton.disabled = false;
        boton.textContent = 'Guardar';
    }
}

async function eliminarElemento(reg) {
    const nombre = NOMBRE_ELEMENTO[reg.capa];
    if (!confirm(`¿Eliminar ${nombre} ${reg.props.codigo}?\n\nEl cambio queda registrado en el historial de ediciones.`)) return;
    try {
        const r = await editarEnBase(reg.capa, 'eliminar', reg.props.codigo);
        map.closePopup();
        await mostrarResultado(reg.capa, null, r, `Se eliminó ${nombre} ${r.codigo}.`);
    } catch (error) {
        aviso(error.message, 'error');
    }
}

// Aplica los cambios que trae la respuesta (o los pide) y abre la ficha del elemento
async function mostrarResultado(capa, codigo, r, mensaje) {
    if (r.cambios && datosActuales && tiempoDe(versionActual) < tiempoDe(r.version)) {
        redibujar(combinarCambios(datosActuales, r.cambios));
        versionActual = versionDe(datosActuales);
        fuenteDatos = 'supabase';
        construirResumen();
    }
    for (let i = 0; i < 15 && tiempoDe(versionActual) < tiempoDe(r.version); i++) {
        if (actualizando) await esperar(400);
        else await actualizarDatos(mensaje);
    }
    aviso(mensaje);
    const reg = codigo && (registro[capa] || []).find(r => r.props.codigo === codigo);
    if (reg) irA(reg);
}

// =====================================================================
// Ficha técnica en PDF
// =====================================================================

// Carga una imagen como DataURL. googleusercontent permite CORS; los
// proxies quedan como respaldo para otros orígenes.
async function cargarImagenBase64(url) {
    if (!url) return null;
    const imageUrl = convertDriveUrl(url);
    const proxies = [
        u => u,
        u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
        u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
    ];
    for (const proxy of proxies) {
        try {
            const response = await fetch(proxy(imageUrl), { headers: { Accept: 'image/*' } });
            if (!response.ok) continue;
            const blob = await response.blob();
            if (!blob.type.startsWith('image/')) continue;
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Error al leer la imagen'));
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            continue;
        }
    }
    return null;
}

// Mapa de ubicación para la ficha PDF. Las teselas de OpenStreetMap y los
// elementos se proyectan con la misma transformación del mapa (EPSG:3857),
// así el elemento queda exactamente en su posición.
function cargarTesela(z, x, y) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    });
}

function coordenadasDe(geometry) {
    switch (geometry.type) {
        case 'Point': return [geometry.coordinates];
        case 'LineString': return geometry.coordinates;
        case 'MultiLineString':
        case 'Polygon': return geometry.coordinates.flat();
        case 'MultiPolygon': return geometry.coordinates.flat(2);
        default: return [];
    }
}

function lineasDe(geometry) {
    if (geometry.type === 'LineString') return [geometry.coordinates];
    if (geometry.type === 'MultiLineString') return geometry.coordinates;
    return [];
}

// Punto a mitad del recorrido de una polilínea (en píxeles) y su dirección
function puntoMedio(pts) {
    const largos = pts.slice(1).map((q, i) => q.distanceTo(pts[i]));
    const total = largos.reduce((s, d) => s + d, 0);
    let i = 0, acumulado = 0;
    while (i < largos.length - 1 && acumulado + largos[i] < total / 2) acumulado += largos[i++];
    const a = pts[i], b = pts[i + 1] || pts[i];
    const t = largos[i] ? (total / 2 - acumulado) / largos[i] : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angulo: Math.atan2(b.y - a.y, b.x - a.x) };
}

async function generarMapaUbicacion(reg, ancho = 960, alto = 618) {
    const crs = L.CRS.EPSG3857;
    const coords = coordenadasDe(reg.geometry);
    if (!coords.length) return null;
    const limites = L.latLngBounds(coords.map(([lon, lat]) => L.latLng(lat, lon)));
    // El mayor zoom (hasta 19) en el que el elemento ocupa como máximo el 70 % del mapa
    let z = 19;
    while (z > 12) {
        const a = crs.latLngToPoint(limites.getNorthWest(), z);
        const b = crs.latLngToPoint(limites.getSouthEast(), z);
        if (b.x - a.x <= ancho * 0.7 && b.y - a.y <= alto * 0.7) break;
        z--;
    }
    const centro = limites.getCenter();
    const origen = crs.latLngToPoint(centro, z).subtract([ancho / 2, alto / 2]).round();
    const px = ([lon, lat]) => crs.latLngToPoint(L.latLng(lat, lon), z).subtract(origen);

    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#eef1f4';
    ctx.fillRect(0, 0, ancho, alto);

    // Teselas en gris, como en el geoportal; las que no llegan a tiempo se omiten
    let abierto = true;
    const pedidos = [];
    for (let tx = Math.floor(origen.x / 256); tx <= Math.floor((origen.x + ancho) / 256); tx++) {
        for (let ty = Math.floor(origen.y / 256); ty <= Math.floor((origen.y + alto) / 256); ty++) {
            pedidos.push(cargarTesela(z, tx, ty).then(img => {
                if (!img || !abierto) return;
                ctx.filter = 'grayscale(1) brightness(1.03)';
                ctx.drawImage(img, tx * 256 - origen.x, ty * 256 - origen.y, 256, 256);
                ctx.filter = 'none';
            }));
        }
    }
    await Promise.race([Promise.all(pedidos), new Promise(r => setTimeout(r, 8000))]);
    abierto = false;

    // Contexto: canales, tuberías, sumideros y cámaras cercanos
    const dentro = pts => pts.some(q => q.x > -40 && q.y > -40 && q.x < ancho + 40 && q.y < alto + 40);
    const trazo = (lineas, color, grosor) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = grosor;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        lineas.forEach(pts => {
            ctx.beginPath();
            pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
            ctx.stroke();
        });
    };
    const lineasCapa = capa => (registro[capa] || []).flatMap(r => lineasDe(r.geometry).map(l => l.map(px))).filter(dentro);
    const canales = lineasCapa('canales');
    trazo(canales, '#ffffff', 9);
    trazo(canales, '#127369', 5);
    trazo(lineasCapa('tuberias_camaras'), '#24577a', 3);
    trazo(lineasCapa('tuberias_sumideros'), '#5c9bc8', 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#22303d';
    ctx.lineWidth = 1.6;
    (registro.sumideros || []).map(r => px(r.geometry.coordinates)).filter(q => dentro([q])).forEach(q => {
        ctx.fillRect(q.x - 4.5, q.y - 4.5, 9, 9);
        ctx.strokeRect(q.x - 4.5, q.y - 4.5, 9, 9);
    });
    (registro.camaras || []).map(r => px(r.geometry.coordinates)).filter(q => dentro([q])).forEach(q => {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });

    // Elemento de la ficha, resaltado
    const rojo = '#a8423a';
    let ancla;
    if (reg.geometry.type === 'Point') {
        ancla = px(reg.geometry.coordinates);
        ctx.fillStyle = 'rgba(168, 66, 58, 0.2)';
        ctx.beginPath();
        ctx.arc(ancla.x, ancla.y, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rojo;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(ancla.x, ancla.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#13283b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ancla.x, ancla.y, 10.5, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        const lineas = lineasDe(reg.geometry).map(l => l.map(px));
        trazo(lineas, '#ffffff', 11);
        trazo(lineas, rojo, 6);
        const mayor = lineas.reduce((a, b) => (b.length > a.length ? b : a), lineas[0]);
        ancla = puntoMedio(mayor);
        // Sentido del flujo de las tuberías (origen → destino)
        if (reg.capa.startsWith('tuberias')) {
            ctx.save();
            ctx.translate(ancla.x, ancla.y);
            ctx.rotate(ancla.angulo);
            ctx.beginPath();
            ctx.moveTo(11, 0);
            ctx.lineTo(-8, -8);
            ctx.lineTo(-3, 0);
            ctx.lineTo(-8, 8);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#13283b';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    }

    // Rótulo con el código
    const texto = reg.capa === 'canales' ? nombreCanal(reg.props.nombre) : String(reg.props.codigo || '');
    ctx.font = '600 22px "IBM Plex Mono", Consolas, monospace';
    const w = ctx.measureText(texto).width + 18;
    let lx = ancla.x + 20, ly = ancla.y - 50;
    if (lx + w > ancho - 10) lx = ancla.x - 20 - w;
    if (ly < 10) ly = ancla.y + 20;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = '#13283b';
    ctx.lineWidth = 1.5;
    ctx.fillRect(lx, ly, w, 32);
    ctx.strokeRect(lx, ly, w, 32);
    ctx.fillStyle = '#13283b';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, lx + 9, ly + 17);

    // Escala gráfica (resolución de la proyección en la latitud del centro)
    const mPorPx = 40075016.686 * Math.cos(centro.lat * Math.PI / 180) / (256 * 2 ** z);
    const metros = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].filter(v => v / mPorPx <= ancho * 0.22).pop() || 5;
    const largo = metros / mPorPx;
    const ex = 22, ey = alto - 24;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillRect(ex - 12, ey - 34, largo + 52, 50);
    ctx.fillStyle = '#13283b';
    ctx.fillRect(ex, ey, largo / 2, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ex + largo / 2, ey, largo / 2, 8);
    ctx.strokeStyle = '#13283b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ex, ey, largo, 8);
    ctx.font = '500 18px "IBM Plex Sans", Arial, sans-serif';
    ctx.fillStyle = '#13283b';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    ctx.fillText('0', ex, ey - 9);
    ctx.fillText(`${metros} m`, ex + largo, ey - 9);

    // Norte
    const nx = ancho - 42, ny = 46;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.arc(nx, ny, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#13283b';
    ctx.beginPath();
    ctx.moveTo(nx, ny - 6);
    ctx.lineTo(nx + 10, ny + 24);
    ctx.lineTo(nx, ny + 17);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7a8897';
    ctx.beginPath();
    ctx.moveTo(nx, ny - 6);
    ctx.lineTo(nx - 10, ny + 24);
    ctx.lineTo(nx, ny + 17);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#13283b';
    ctx.font = '600 17px "IBM Plex Sans", Arial, sans-serif';
    ctx.fillText('N', nx, ny - 11);

    // Atribución
    ctx.font = '14px "IBM Plex Sans", Arial, sans-serif';
    ctx.textAlign = 'right';
    const atribucion = '© OpenStreetMap';
    const wa = ctx.measureText(atribucion).width + 12;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(ancho - wa, alto - 22, wa, 22);
    ctx.fillStyle = '#4b5966';
    ctx.fillText(atribucion, ancho - 6, alto - 6);

    try {
        return canvas.toDataURL('image/jpeg', 0.9);
    } catch (error) {
        return null;  // teselas sin permiso CORS
    }
}

// Imagen PNG de un SVG (el perfil de la ficha) para el PDF
function svgAPng(svg, escala = 3) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width * escala;
            canvas.height = img.height * escala;
            const ctx = canvas.getContext('2d');
            ctx.scale(escala, escala);
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
}

function hexToRgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [29, 90, 133];
}

// Texto apto para las fuentes estándar del PDF (sin caracteres fuera de Latin-1)
function pdfTexto(t) {
    return String(t ?? '').replace(/→/g, '->').replace(/[−–]/g, '-').replace(/[^\x00-\xFF]/g, '');
}

// Bibliotecas que se descargan solo cuando se necesitan (jsPDF, supabase-js)
const scriptsCargados = {};
function cargarScript(url) {
    scriptsCargados[url] ||= new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = resolve;
        s.onerror = () => { delete scriptsCargados[url]; reject(new Error(`No se pudo cargar ${url}`)); };
        document.head.appendChild(s);
    });
    return scriptsCargados[url];
}

// jsPDF se descarga solo la primera vez que se pide una ficha
function cargarJsPDF() {
    return window.jspdf ? Promise.resolve() : cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
}

async function generarFichaPDF(reg) {
    const carga = document.createElement('div');
    carga.className = 'carga';
    carga.setAttribute('role', 'alertdialog');
    carga.innerHTML = `<div class="carga__caja"><strong>Generando ficha técnica</strong><span>Preparando fotografía y mapa de ubicación…</span><div class="carga__barra"></div></div>`;
    document.body.appendChild(carga);

    try {
        await cargarJsPDF();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'letter');
        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();
        const m = 15;
        const ancho = W - 2 * m;
        const def = FICHAS[reg.capa];
        const p = reg.props;
        const barra = [19, 40, 59];
        const acento = [29, 90, 133];
        const color = hexToRgb(colorFicha(reg));
        const titulo = pdfTexto(tituloFicha(reg));
        let pagina = 1;

        const cabecera = () => {
            doc.setFillColor(...barra);
            doc.rect(0, 0, W, 30, 'F');
            doc.setFillColor(...color);
            doc.rect(0, 0, 3, 30, 'F');
            doc.setTextColor(201, 214, 226);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.text(pdfTexto(`FICHA TÉCNICA · ${def.tipo.toUpperCase()}`), m, 10);
            doc.setTextColor(255, 255, 255);
            doc.setFont('courier', 'bold');
            doc.setFontSize(17);
            doc.text(titulo, m, 19);
            const sub = def.subtitulo ? def.subtitulo(p) : null;
            if (sub) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(201, 214, 226);
                doc.text(pdfTexto(sub), m, 25.5);
            }
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(201, 214, 226);
            doc.text('Sistema de drenaje mixto', W - m, 10, { align: 'right' });
            doc.text('Casco Viejo de Oruro', W - m, 15, { align: 'right' });
            if (p.nivel_certeza) doc.text(pdfTexto(`Certeza: ${etiqueta(p.nivel_certeza)}`), W - m, 25.5, { align: 'right' });
        };

        const pie = () => {
            doc.setDrawColor(221, 227, 233);
            doc.setLineWidth(0.3);
            doc.line(m, H - 16, W - m, H - 16);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(122, 136, 151);
            doc.text(pdfTexto(`Generado el ${new Date().toLocaleString('es-BO')} · Fuente: relevamiento de campo (julio de 2025), base PostGIS depurada`), m, H - 11);
            doc.text('Geogr. John Leonardo Cabrera Espíndola · Geogr. Luis Freddy Quenta Alegría', m, H - 7);
            doc.text(`Página ${pagina}`, W - m, H - 7, { align: 'right' });
        };

        cabecera();
        let y = 38;

        // Fotografía y mapa de ubicación
        const centro = centroDe(reg);
        const foto = def.foto ? def.foto(p) : null;
        const altoImg = 58;
        const anchoImg = (ancho - 6) / 2;
        const perfil = def.perfil ? svgPerfil(p, 320, 206) : null;
        const [fotoB64, mapaB64, perfilB64] = await Promise.all([
            foto ? cargarImagenBase64(foto) : Promise.resolve(null),
            generarMapaUbicacion(reg, 960, 618),
            perfil ? svgAPng(perfil) : Promise.resolve(null)
        ]);

        const recuadro = (x, etiquetaR, imagen, formato, vacio) => {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(...acento);
            doc.text(etiquetaR, x, y);
            doc.setDrawColor(221, 227, 233);
            doc.setFillColor(243, 245, 247);
            doc.rect(x, y + 2, anchoImg, altoImg, 'FD');
            if (imagen) {
                try {
                    // Ajuste sin deformar la imagen, centrada en el recuadro
                    const { width: pw, height: ph } = doc.getImageProperties(imagen);
                    const escala = Math.min((anchoImg - 1) / pw, (altoImg - 1) / ph);
                    const w = pw * escala, h = ph * escala;
                    doc.addImage(imagen, formato, x + (anchoImg - w) / 2, y + 2 + (altoImg - h) / 2, w, h, undefined, 'FAST');
                    return;
                } catch (e) { /* se muestra el texto alternativo */ }
            }
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(122, 136, 151);
            doc.text(vacio, x + anchoImg / 2, y + 2 + altoImg / 2, { align: 'center' });
        };
        if (def.perfil) recuadro(m, 'PERFIL LONGITUDINAL', perfilB64, 'PNG', 'Sin elevaciones para el perfil');
        else recuadro(m, 'FOTOGRAFÍA DE CAMPO', fotoB64, 'JPEG', foto ? 'Fotografía no disponible' : 'Sin fotografía registrada');
        recuadro(m + anchoImg + 6, 'UBICACIÓN', mapaB64, 'JPEG', 'Mapa no disponible');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(122, 136, 151);
        const [ex, ny] = aUTM(centro.lat, centro.lng);
        doc.text(pdfTexto(`UTM 19S: E ${Math.round(ex)} · N ${Math.round(ny)} · Lat/Lon: ${centro.lat.toFixed(6)}, ${centro.lng.toFixed(6)}`), m + anchoImg + 6, y + altoImg + 6);
        y += altoImg + 13;

        // Atributos en dos columnas: cada sección es un bloque con su título
        const secciones = seccionesFicha(reg);
        (def.texto || []).filter(([c]) => p[c]).forEach(([c, t]) => secciones.push({ titulo: t, filas: [{ etiqueta: '', texto: p[c] }] }));
        if (def.nota) secciones.push({ titulo: 'Nota', filas: [{ etiqueta: '', texto: def.nota }] });

        const sep = 8;
        const anchoCol = (ancho - sep) / 2;
        const anchoEtiqueta = 36;
        const limite = H - 22;
        const TITULO = 7.5, PIE_SECCION = 3.5;
        doc.setFontSize(8.5);
        secciones.forEach(s => {
            s.filas.forEach(f => {
                const anchoValor = (f.etiqueta ? anchoCol - anchoEtiqueta : anchoCol) - (f.color ? 4 : 0) - 1;
                doc.setFont('helvetica', 'normal');
                f.lineasEtiqueta = f.etiqueta ? doc.splitTextToSize(pdfTexto(f.etiqueta), anchoEtiqueta - 2) : [];
                doc.setFont(f.mono ? 'courier' : 'helvetica', 'normal');
                f.lineas = doc.splitTextToSize(pdfTexto(f.texto), anchoValor);
                f.alto = Math.max(5.2, Math.max(f.lineas.length, f.lineasEtiqueta.length) * 3.6 + 1.8);
            });
            s.alto = TITULO + s.filas.reduce((t, f) => t + f.alto, 0) + PIE_SECCION;
        });

        const dibujarSeccion = (s, x, yIni) => {
            let yy = yIni;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(...acento);
            doc.text(pdfTexto(s.titulo.toUpperCase()), x, yy);
            doc.setDrawColor(...acento);
            doc.setLineWidth(0.4);
            doc.line(x, yy + 1.5, x + anchoCol, yy + 1.5);
            yy += TITULO;
            for (const f of s.filas) {
                const xValor = f.etiqueta ? x + anchoEtiqueta : x;
                doc.setFontSize(8.5);
                if (f.etiqueta) {
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(122, 136, 151);
                    doc.text(f.lineasEtiqueta, x, yy);
                }
                if (f.color) {
                    doc.setFillColor(...hexToRgb(f.color));
                    doc.rect(xValor, yy - 2.2, 2.4, 2.4, 'F');
                }
                doc.setFont(f.mono ? 'courier' : 'helvetica', 'normal');
                doc.setTextColor(22, 34, 46);
                doc.text(f.lineas, xValor + (f.color ? 4 : 0), yy);
                doc.setDrawColor(235, 239, 243);
                doc.setLineWidth(0.2);
                doc.line(x, yy + f.alto - 3.4, x + anchoCol, yy + f.alto - 3.4);
                yy += f.alto;
            }
            return yy + PIE_SECCION;
        };

        // Reparto equilibrado si todo cabe en la primera página
        const total = secciones.reduce((t, s) => t + s.alto, 0);
        let corte = 0, mejor = Infinity, acumulado = 0;
        secciones.forEach((s, i) => {
            acumulado += s.alto;
            const mayor = Math.max(acumulado, total - acumulado);
            if (mayor < mejor) { mejor = mayor; corte = i + 1; }
        });
        if (y + mejor <= limite) {
            let yl = y, yr = y;
            secciones.forEach((s, i) => {
                if (i < corte) yl = dibujarSeccion(s, m, yl);
                else yr = dibujarSeccion(s, m + anchoCol + sep, yr);
            });
        } else {
            // Flujo por columnas y páginas
            let col = 0;
            const yTope = () => (pagina === 1 ? y : 38);
            let yc = y;
            for (const s of secciones) {
                if (yc + s.alto > limite) {
                    if (col === 0) {
                        col = 1;
                        yc = yTope();
                    } else {
                        pie();
                        doc.addPage();
                        pagina++;
                        cabecera();
                        col = 0;
                        yc = 38;
                    }
                }
                yc = dibujarSeccion(s, m + col * (anchoCol + sep), yc);
            }
        }
        pie();
        const nombre = String(p.codigo || p.nombre || 'elemento').replace(/[^A-Za-z0-9_+-]/g, '_');
        doc.save(`Ficha_tecnica_${nombre}.pdf`);
    } catch (error) {
        console.error(error);
        aviso('No se pudo generar el PDF. Intente nuevamente.', 'error');
    } finally {
        carga.remove();
    }
}
