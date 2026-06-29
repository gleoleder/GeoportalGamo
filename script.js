// Variables globales
let map;
let capaActual = null;
let userLocation = null;
let routeLayers = []; // Array para múltiples rutas
let origenMarker = null;
let destinoMarker = null;
let seleccionandoPunto = null;
let currentRoutes = []; // Array para guardar múltiples rutas
let lineasFlujo = []; // Líneas animadas de flujo de agua en tuberías

// Anima el desplazamiento de los guiones para simular el flujo de agua
function animarFlujo() {
    const offset = -(performance.now() / 50) % 18; // velocidad del flujo
    lineasFlujo.forEach(linea => {
        const path = linea._path;
        if (path) path.setAttribute('stroke-dashoffset', offset);
    });
    requestAnimationFrame(animarFlujo);
}
requestAnimationFrame(animarFlujo);

// Función para convertir URLs de Google Drive a URLs de imagen directa
function convertDriveUrl(url) {
    if (!url || typeof url !== 'string') return url;
    
    let fileId = null;
    
    // Patrón 1: https://drive.google.com/file/d/FILE_ID/view...
    let match = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) {
        fileId = match[1];
    }
    
    // Patrón 2: https://drive.google.com/open?id=FILE_ID
    if (!fileId) {
        match = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
        if (match) {
            fileId = match[1];
        }
    }
    
    // Patrón 3: id=FILE_ID en cualquier parte de la URL (funciona para uc?export=download&id=XXX)
    if (!fileId) {
        match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (match) {
            fileId = match[1];
        }
    }
    
    // Patrón 4: ID directo (solo letras, números, guiones y guiones bajos, min 20 chars)
    if (!fileId && /^[a-zA-Z0-9_-]{20,}$/.test(url.trim())) {
        fileId = url.trim();
    }
    
    // Si encontramos un ID, devolver URL de imagen directa
    if (fileId) {
        // googleusercontent es el host más fiable para incrustar <img> (sin límites de cuota de Drive)
        return `https://lh3.googleusercontent.com/d/${fileId}=w1000`;
    }

    // Si no coincide con ningún patrón de Drive, devolver URL original
    return url;
}

// Extrae el ID de Google Drive de cualquier formato de URL
function extraerDriveId(url) {
    if (!url || typeof url !== 'string') return null;
    let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
            url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
            url.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim())) return url.trim();
    return null;
}

// Lista de URLs candidatas para una foto de Drive (se prueban en cascada)
function urlsFotoDrive(url) {
    const id = extraerDriveId(url);
    if (!id) return [url];
    return [
        `https://lh3.googleusercontent.com/d/${id}=w1000`,
        `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
        `https://drive.google.com/uc?export=view&id=${id}`
    ];
}

// Iconos personalizados para marcadores de ruta
const origenIcon = L.divIcon({
    className: 'route-marker',
    html: '<div style="background: #28a745; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 10px rgba(0,0,0,0.3); font-size: 18px;">📍</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
});

const destinoIcon = L.divIcon({
    className: 'route-marker',
    html: '<div style="background: #dc3545; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 10px rgba(0,0,0,0.3); font-size: 18px;">🏁</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
});

// Inicializar mapa
function initMap() {
    // Crear mapa centrado en Oruro, Bolivia
    map = L.map('map', { maxZoom: 22 }).setView([-17.9647, -67.1064], 14);
    
    // Capa base de OpenStreetMap
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 22,
        maxNativeZoom: 19
    });
    
    // Capa de satélite de Esri
    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 22,
        maxNativeZoom: 19
    });
    
    // Capa de Google Satellite
    const googleSatellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        attribution: '© Google',
        maxZoom: 22,
        maxNativeZoom: 20
    });
    
    // Capa de Google Hybrid (Satélite + Calles)
    const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        attribution: '© Google',
        maxZoom: 22,
        maxNativeZoom: 20
    });
    
    // Capa de Google Streets
    const googleStreets = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        attribution: '© Google',
        maxZoom: 22,
        maxNativeZoom: 20
    });
    
    // Capa de Google Terrain
    const googleTerrain = L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
        attribution: '© Google',
        maxZoom: 22,
        maxNativeZoom: 20
    });
    
    // Capa topográfica de OpenTopoMap
    const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap',
        maxZoom: 22,
        maxNativeZoom: 17
    });
    
    // Capa oscura de CartoDB
    const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB',
        maxZoom: 22,
        maxNativeZoom: 19
    });
    
    // Capa clara de CartoDB
    const lightLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB',
        maxZoom: 22,
        maxNativeZoom: 19
    });
    
    // Capa de Esri Topográfico
    const esriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 22,
        maxNativeZoom: 19
    });
    
    // Capa de Esri Calles
    const esriStreets = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 22,
        maxNativeZoom: 19
    });
    
    // Añadir capa base por defecto (modo oscuro)
    darkLayer.addTo(map);
    
    // Control de capas
    const baseLayers = {
        "🗺️ OpenStreetMap": osmLayer,
        "🛰️ Esri Satélite": satelliteLayer,
        "🛰️ Google Satélite": googleSatellite,
        "🗺️ Google Híbrido": googleHybrid,
        "🛣️ Google Calles": googleStreets,
        "⛰️ Google Terreno": googleTerrain,
        "🏔️ OpenTopoMap": topoLayer,
        "🌙 Modo Oscuro": darkLayer,
        "☀️ Modo Claro": lightLayer,
        "🗻 Esri Topográfico": esriTopo,
        "🛤️ Esri Calles": esriStreets
    };
    
    L.control.layers(baseLayers).addTo(map);
    
    // Inicializar paneles en móvil
    initPanels();
    
    // Event listener para selección de puntos en el mapa
    map.on('click', function(e) {
        if (seleccionandoPunto) {
            agregarPuntoSeleccionado(e.latlng);
        }
    });
}

// Función de estilo para cámaras basado en campo "accesibili"
function getStyle(feature) {
    const accesibili = feature.properties?.accesibili?.toLowerCase() || 'otro';
    
    const estilos = {
        'accesible operativo': { color: '#28a745', fillColor: '#28a745' },
        'accesible con dificultad': { color: '#ffc107', fillColor: '#ffc107' },
        'inferido': { color: '#6c757d', fillColor: '#6c757d' },
        'no accesible': { color: '#dc3545', fillColor: '#dc3545' }
    };
    
    return {
        radius: 8,
        fillColor: estilos[accesibili]?.fillColor || '#17a2b8',
        color: estilos[accesibili]?.color || '#17a2b8',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8
    };
}

// Crear icono SVG para marcadores basado en campo "accesibili"
function createCustomIcon(accesibili) {
    const colorMap = {
        'accesible operativo': '#28a745',
        'accesible con dificultad': '#ffc107',
        'inferido': '#6c757d',
        'no accesible': '#dc3545'
    };
    
    const color = colorMap[accesibili?.toLowerCase()] || '#17a2b8';
    
    return L.divIcon({
        className: 'custom-marker',
        html: `
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="13" fill="#fafafa" stroke="#4a4a4a" stroke-width="2"/>
                <circle cx="16" cy="16" r="9.5" fill="none" stroke="${color}" stroke-width="2"/>
                <g transform="translate(16, 16)">
                    <rect x="-6" y="-3" width="4.5" height="1.5" fill="${color}" rx="0.5"/>
                    <rect x="1.5" y="-3" width="4.5" height="1.5" fill="${color}" rx="0.5"/>
                    <rect x="-6" y="0" width="4.5" height="1.5" fill="${color}" rx="0.5"/>
                    <rect x="1.5" y="0" width="4.5" height="1.5" fill="${color}" rx="0.5"/>
                    <rect x="-6" y="3" width="4.5" height="1.5" fill="${color}" rx="0.5"/>
                    <rect x="1.5" y="3" width="4.5" height="1.5" fill="${color}" rx="0.5"/>
                </g>
            </svg>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
    });
}

// Estilos por color de las líneas de tuberías
const ESTILO_TUBERIAS = {
    'tuberias_camaras': { color: '#1f78b4', weight: 3 },
    'tuberias_sumideros': { color: '#7fd4f5', weight: 3 }
};

// Icono propio para sumideros: cuadrado azul con rejilla (boca de tormenta)
function createSumideroIcon() {
    const color = '#0077b6';
    return L.divIcon({
        className: 'custom-marker',
        html: `
            <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="22" height="22" rx="3" fill="#fafafa" stroke="#4a4a4a" stroke-width="2"/>
                <rect x="6" y="6" width="16" height="16" rx="2" fill="none" stroke="${color}" stroke-width="2"/>
                <line x1="10" y1="7" x2="10" y2="21" stroke="${color}" stroke-width="1.6"/>
                <line x1="14" y1="7" x2="14" y2="21" stroke="${color}" stroke-width="1.6"/>
                <line x1="18" y1="7" x2="18" y2="21" stroke="${color}" stroke-width="1.6"/>
            </svg>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
    });
}

// Cargar capas directamente desde el GeoJSON generado de los GeoPackage
async function cargarCapa() {
    mostrarEstado('Cargando datos...', 'info');

    try {
        const response = await fetch('datos.geojson');

        if (!response.ok) throw new Error('No se pudo leer datos.geojson');

        const geojson = await response.json();
        const data = geojson.features || [];

        if (data.length === 0) {
            mostrarEstado('No se encontraron datos en datos.geojson', 'error');
            return;
        }

        // Limpiar capas anteriores
        if (capaActual) {
            map.removeLayer(capaActual);
        }
        lineasFlujo = [];
        if (window.controlCapas) {
            map.removeControl(window.controlCapas);
            window.controlCapas = null;
        }

        // 4 grupos independientes que se pueden prender/apagar
        const grupos = {
            camaras: L.featureGroup(),
            sumideros: L.featureGroup(),
            tuberias_camaras: L.featureGroup(),
            tuberias_sumideros: L.featureGroup()
        };

        // capaActual agrupa todo solo para getBounds y limpieza
        capaActual = L.featureGroup(Object.values(grupos));

        let puntoNumero = 0; // Contador de puntos

        data.forEach(feature => {
            const geom = feature.geometry;
            if (!geom) return;
            const p = feature.properties || {};
            const capa = p._capa;

            // ---- Tuberías (líneas) ----
            if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
                const estilo = ESTILO_TUBERIAS[capa] || { color: '#888', weight: 3 };
                const grupoDestino = grupos[capa] || capaActual;
                const latlngs = geom.type === 'MultiLineString'
                    ? geom.coordinates.map(l => l.map(c => [c[1], c[0]]))
                    : geom.coordinates.map(c => [c[1], c[0]]);

                // Grosor de la línea según el diámetro de la tubería (pulgadas)
                const diam = parseFloat(String(p.DIAMETRO__ ?? p['DIAMETRO ('] ?? '').replace(',', '.'));
                const grosor = (!isNaN(diam) && diam > 0)
                    ? Math.max(2, Math.min(10, 2 + diam * 0.25))  // 2px (chica) … 10px (grande)
                    : 2.5;                                         // sin dato de diámetro

                // Línea base (tubería)
                const linea = L.polyline(latlngs, { color: estilo.color, weight: grosor, opacity: 0.85 });
                linea.addTo(grupoDestino);

                // Línea de animación de flujo de agua (encima, con guiones que se desplazan)
                const flujo = L.polyline(latlngs, {
                    color: '#01337d',
                    weight: Math.max(2, grosor - 1),
                    opacity: 0.95,
                    dashArray: '2, 16',
                    lineCap: 'round'
                });
                flujo.addTo(grupoDestino);
                lineasFlujo.push(flujo);

                const cod = p.COD_TCAM || p.COD_TSUM || '';
                let popLinea = `<div class="popup-scroll-container"><div class="popup-title" style="background:${estilo.color};">🔧 Tubería ${cod}</div>`;
                if (p.ORIGEN || p.DESTINO) {
                    popLinea += `<div class="popup-row"><span class="popup-label">Flujo:</span><span class="popup-value">${p.ORIGEN || '?'} ➜ ${p.DESTINO || '?'}</span></div>`;
                }
                [['Función', p.FUNCION], ['Material', p.MATERIAL], ['Diámetro', p.DIAMETRO__ || p['DIAMETRO (']], ['Distancia', p.DISTANCIA], ['Pendiente', p.PENDIENTE]].forEach(([l, v]) => {
                    if (v !== null && v !== undefined && v !== '') popLinea += `<div class="popup-row"><span class="popup-label">${l}:</span><span class="popup-value">${v}</span></div>`;
                });
                popLinea += '</div>';
                linea.bindPopup(popLinea);
                return;
            }

            // ---- Puntos (cámaras y sumideros) ----
            if (geom.type === 'Point') {
                try {
                        puntoNumero++; // Incrementar contador

                        const [lon, lat] = geom.coordinates;
                        // Normalizar campos del GeoPackage (MAYÚSCULAS) a los que usa el frontend
                        if (capa === 'sumideros') {
                            feature.cod_cam = p.COD_SUM;
                            feature.accesibili = p.CONDICION || 'Sumidero';
                            feature.localizaci = p.JUSTIFICAC || '';
                            feature.estado = p.ESTADO_DE || '';
                            feature.fot_cam_q = p.FOTOS_DRIV || p.FOTOS_DE_S;
                        } else {
                            feature.cod_cam = p.COD_CAM;
                            feature.accesibili = p.ACCESIBILI;
                            feature.localizaci = p.LOCALIZACI || p.UBICACION || '';
                            feature.rasante = p.RASANTE;
                            feature.estado = p['ESTADO DE'] || p.CONDICION || '';
                            feature.fot_cam_q = p['FOTO CAM_Q'] || p['FOTO CAM D'];
                        }
                        const accesibili = feature.accesibili || 'Otro estado';
                        const esSumidero = capa === 'sumideros';

                        // Obtener color según accesibilidad
                        const colorMap = {
                            'accesible operativo': '#28a745',
                            'accesible con dificultad': '#ffc107',
                            'inferido': '#6c757d',
                            'no accesible': '#dc3545'
                        };
                        const colorAccesibilidad = esSumidero ? '#0077b6' : (colorMap[accesibili?.toLowerCase()] || '#17a2b8');

                        // Simbología original: icono SVG (círculo para cámaras, cuadrado con rejilla para sumideros)
                        const marker = L.marker([lat, lon], {
                            icon: esSumidero ? createSumideroIcon() : createCustomIcon(accesibili)
                        });

                        // Crear popup con título y color dinámico
                        const tituloPunto = esSumidero ? `🟦 Sumidero ${feature.cod_cam || puntoNumero}` : `📍 Cámara ${feature.cod_cam || puntoNumero}`;
                        let popupContent = `<div class="popup-title" style="background: ${colorAccesibilidad};">${tituloPunto}</div>`;
                        
                        // Debug: mostrar todos los campos disponibles
                        console.log('Campos disponibles:', Object.keys(feature));
                        console.log('Valor fot_cam_q:', feature.fot_cam_q);
                        
                        // 1. FOTO al inicio - buscar en varios campos posibles
                        let fotoUrl = feature.fot_cam_q || feature.fot_cam_d || feature.foto || feature.imagen || feature.img;
                        
                        // Buscar cualquier campo que contenga 'fot' o 'img'
                        if (!fotoUrl) {
                            for (let key of Object.keys(feature)) {
                                if ((key.toLowerCase().includes('fot') || key.toLowerCase().includes('img')) && feature[key]) {
                                    fotoUrl = feature[key];
                                    console.log('Campo de foto encontrado:', key, '=', fotoUrl);
                                    break;
                                }
                            }
                        }
                        
                        if (fotoUrl) {
                            const candidatas = urlsFotoDrive(fotoUrl);
                            // onerror prueba la siguiente URL; si se agotan, muestra el botón de respaldo
                            const onError = `var l=JSON.parse(this.dataset.urls);var i=parseInt(this.dataset.idx)+1;if(i&lt;l.length){this.dataset.idx=i;this.src=l[i];}else{this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='block';}`;
                            popupContent += `
                                <div class="popup-image-container" style="border-color: ${colorAccesibilidad};">
                                    <img src="${candidatas[0]}" class="popup-image" referrerpolicy="no-referrer" loading="lazy"
                                         data-urls='${JSON.stringify(candidatas)}' data-idx="0"
                                         style="border-color: ${colorAccesibilidad};" alt="Foto de cámara"
                                         onerror="${onError}"
                                         onclick="window.open('${fotoUrl}', '_blank')">
                                    <a href="${fotoUrl}" target="_blank" class="popup-image-link" style="background: ${colorAccesibilidad}; display:none;">📷 Ver imagen en Drive</a>
                                </div>
                            `;
                        }
                        
                        // 2. Código de cámara
                        if (feature.cod_cam) {
                            popupContent += `
                                <div class="popup-row">
                                    <span class="popup-label">Código Cámara:</span>
                                    <span class="popup-value">${feature.cod_cam}</span>
                                </div>
                            `;
                        }
                        
                        // 3. Accesibilidad
                        if (feature.accesibili) {
                            popupContent += `
                                <div class="popup-row">
                                    <span class="popup-label">Accesibilidad:</span>
                                    <span class="popup-value">${feature.accesibili}</span>
                                </div>
                            `;
                        }
                        
                        // 4. Localización
                        if (feature.localizaci) {
                            popupContent += `
                                <div class="popup-row">
                                    <span class="popup-label">Localización:</span>
                                    <span class="popup-value">${feature.localizaci}</span>
                                </div>
                            `;
                        }
                        
                        // 5. Rasante
                        if (feature.rasante) {
                            popupContent += `
                                <div class="popup-row">
                                    <span class="popup-label">Rasante:</span>
                                    <span class="popup-value">${feature.rasante}</span>
                                </div>
                            `;
                        }
                        
                        // 6. Estado
                        if (feature.estado) {
                            popupContent += `
                                <div class="popup-row">
                                    <span class="popup-label">Estado:</span>
                                    <span class="popup-value">${feature.estado}</span>
                                </div>
                            `;
                        }
                        
                        // 7. Coordenadas (del campo si existe)
                        if (feature.coordenadas) {
                            popupContent += `
                                <div class="popup-row">
                                    <span class="popup-label">Coordenadas:</span>
                                    <span class="popup-value">${feature.coordenadas}</span>
                                </div>
                            `;
                        }
                        
                        // 8. Latitud y Longitud (calculadas de la geometría)
                        popupContent += `
                            <div class="popup-row">
                                <span class="popup-label">Latitud:</span>
                                <span class="popup-value">${lat.toFixed(6)}</span>
                            </div>
                            <div class="popup-row">
                                <span class="popup-label">Longitud:</span>
                                <span class="popup-value">${lon.toFixed(6)}</span>
                            </div>
                        `;
                        
                        // Botón para descargar ficha técnica
                        const fichaData = JSON.stringify({
                            cod_cam: feature.cod_cam || `CAM${puntoNumero}`,
                            accesibili: feature.accesibili || 'Sin datos',
                            localizaci: feature.localizaci || 'Sin datos',
                            rasante: feature.rasante || 'Sin datos',
                            estado: feature.estado || 'Sin datos',
                            coordenadas: feature.coordenadas || 'Sin datos',
                            lat: lat.toFixed(6),
                            lon: lon.toFixed(6),
                            fotoUrl: fotoUrl || '',
                            color: colorAccesibilidad
                        }).replace(/'/g, "\\'");
                        
                        popupContent += `
                            <div class="popup-download-btn">
                                <button onclick='generarFichaPDF(${fichaData})' class="btn-ficha">
                                    📄 Descargar Ficha Técnica PDF
                                </button>
                            </div>
                        `;
                        
                        // Envolver contenido en un div con scroll y color personalizado
                        popupContent = `<div class="popup-scroll-container" data-color="${colorAccesibilidad}">${popupContent}</div>`;
                        
                        marker.bindPopup(popupContent, {
                            autoPan: true,
                            autoPanPadding: [50, 50],
                            className: `popup-${accesibili?.toLowerCase().replace(/\s+/g, '-') || 'default'}`
                        });
                        (esSumidero ? grupos.sumideros : grupos.camaras).addLayer(marker);
                } catch (e) {
                    console.error('Error al procesar geometría:', e);
                }
            }
        });
        
        capaActual.addTo(map);

        // Iconos de la simbología real para el control de capas
        const icCamara = `<svg width="18" height="18" viewBox="0 0 32 32" style="vertical-align:-4px;margin-right:4px;">
            <circle cx="16" cy="16" r="13" fill="#fafafa" stroke="#4a4a4a" stroke-width="2"/>
            <circle cx="16" cy="16" r="9.5" fill="none" stroke="#28a745" stroke-width="2"/>
            <g transform="translate(16,16)" fill="#28a745">
                <rect x="-6" y="-3" width="4.5" height="1.5" rx="0.5"/><rect x="1.5" y="-3" width="4.5" height="1.5" rx="0.5"/>
                <rect x="-6" y="0" width="4.5" height="1.5" rx="0.5"/><rect x="1.5" y="0" width="4.5" height="1.5" rx="0.5"/>
                <rect x="-6" y="3" width="4.5" height="1.5" rx="0.5"/><rect x="1.5" y="3" width="4.5" height="1.5" rx="0.5"/></g></svg>`;
        const icSumidero = `<svg width="16" height="16" viewBox="0 0 28 28" style="vertical-align:-3px;margin-right:4px;">
            <rect x="3" y="3" width="22" height="22" rx="3" fill="#fafafa" stroke="#4a4a4a" stroke-width="2"/>
            <rect x="6" y="6" width="16" height="16" rx="2" fill="none" stroke="#0077b6" stroke-width="2"/>
            <line x1="10" y1="7" x2="10" y2="21" stroke="#0077b6" stroke-width="1.6"/>
            <line x1="14" y1="7" x2="14" y2="21" stroke="#0077b6" stroke-width="1.6"/>
            <line x1="18" y1="7" x2="18" y2="21" stroke="#0077b6" stroke-width="1.6"/></svg>`;
        const icTubCam = `<svg width="26" height="12" viewBox="0 0 26 12" style="vertical-align:-1px;margin-right:4px;">
            <line x1="1" y1="6" x2="25" y2="6" stroke="#1f78b4" stroke-width="4"/></svg>`;
        const icTubSum = `<svg width="26" height="12" viewBox="0 0 26 12" style="vertical-align:-1px;margin-right:4px;">
            <line x1="1" y1="6" x2="25" y2="6" stroke="#7fd4f5" stroke-width="4"/></svg>`;

        // Control para prender/apagar cada capa (con su simbología real)
        const overlays = {
            [`${icCamara}Cámaras`]: grupos.camaras,
            [`${icSumidero}Sumideros`]: grupos.sumideros,
            [`${icTubCam}Tuberías cámaras`]: grupos.tuberias_camaras,
            [`${icTubSum}Tuberías sumideros`]: grupos.tuberias_sumideros
        };
        window.controlCapas = L.control.layers(null, overlays, { collapsed: false, position: 'topright' }).addTo(map);

        // Ajustar vista a los datos
        try {
            const b = capaActual.getBounds();
            if (b.isValid()) map.fitBounds(b, { padding: [50, 50] });
        } catch (e) { /* sin bounds */ }
        
        // Actualizar UI
        document.getElementById('btnLimpiar').style.display = 'block';
        document.getElementById('totalPuntos').textContent = puntoNumero;
        document.getElementById('ultimaActualizacion').textContent = new Date().toLocaleString('es-BO');
        document.getElementById('infoPanel').style.display = 'block';
        
        mostrarEstado(`✅ Se cargaron ${puntoNumero} puntos correctamente`, 'success');
        
    } catch (error) {
        console.error('Error:', error);
        mostrarEstado('❌ Error al cargar los datos: ' + error.message, 'error');
    }
}

// Limpiar capa
function limpiarCapa() {
    if (capaActual) {
        map.removeLayer(capaActual);
        capaActual = null;
        document.getElementById('btnLimpiar').style.display = 'none';
        document.getElementById('infoPanel').style.display = 'none';
        mostrarEstado('Capa limpiada correctamente', 'info');
    }
}

// Obtener ubicación del usuario
function obtenerUbicacion() {
    if (!navigator.geolocation) {
        mostrarEstado('Tu navegador no soporta geolocalización', 'error');
        return;
    }
    
    mostrarEstado('Obteniendo tu ubicación...', 'info');
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            userLocation = [lat, lon];
            
            // Actualizar display de coordenadas
            document.getElementById('coordenadas').textContent = 
                `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`;
            document.getElementById('locationInfo').style.display = 'block';
            
            // Centrar mapa en ubicación
            map.setView([lat, lon], 16);
            
            // Agregar marcador de ubicación
            if (window.userMarker) {
                map.removeLayer(window.userMarker);
            }
            
            window.userMarker = L.marker([lat, lon], {
                icon: L.divIcon({
                    className: 'user-location-marker',
                    html: '<div style="background: #007bff; color: white; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                })
            }).addTo(map);
            
            window.userMarker.bindPopup('📍 Tu ubicación actual').openPopup();
            
            mostrarEstado('✅ Ubicación obtenida correctamente', 'success');
        },
        (error) => {
            let mensaje = 'Error al obtener ubicación';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    mensaje = 'Permiso de ubicación denegado';
                    break;
                case error.POSITION_UNAVAILABLE:
                    mensaje = 'Ubicación no disponible';
                    break;
                case error.TIMEOUT:
                    mensaje = 'Tiempo de espera agotado';
                    break;
            }
            mostrarEstado('❌ ' + mensaje, 'error');
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// Mostrar estado
function mostrarEstado(mensaje, tipo) {
    const status = document.getElementById('status');
    status.textContent = mensaje;
    status.className = 'status ' + tipo;
    
    setTimeout(() => {
        status.style.display = 'none';
    }, 5000);
}

// Mostrar estado de ruta
function mostrarEstadoRuta(mensaje, tipo) {
    const status = document.getElementById('routeStatus');
    status.textContent = mensaje;
    status.className = tipo;
    
    setTimeout(() => {
        status.style.display = 'none';
    }, 5000);
}

// Alternar visibilidad de configuración
function toggleConfig() {
    const panel = document.getElementById('configPanel');
    const btn = document.querySelector('.show-config');
    
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        btn.textContent = '⚙️ Mostrar Configuración';
    } else {
        panel.style.display = 'block';
        btn.textContent = '⚙️ Ocultar Configuración';
    }
}

// Alternar paneles
function togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    
    if (panel.classList.contains('hidden')) {
        // Abrir panel
        panel.classList.remove('hidden');
    } else {
        // Cerrar panel
        panel.classList.add('hidden');
    }
    
    // Los botones siempre permanecen visibles
}

// Inicializar paneles - todos retráctiles por defecto
function initPanels() {
    // Ocultar todos los paneles al inicio
    document.getElementById('controlPanel').classList.add('hidden');
    document.getElementById('legendPanel').classList.add('hidden');
    document.getElementById('creditsPanel').classList.add('hidden');
    document.getElementById('routePanel').classList.add('hidden');
    
    // Mostrar todos los botones de toggle
    document.getElementById('panelToggleBtn').classList.add('visible');
    document.getElementById('legendToggleBtn').classList.add('visible');
    document.getElementById('creditsToggleBtn').classList.add('visible');
    document.getElementById('routeToggleBtn').classList.add('visible');
}

// FUNCIONES DE RUTEO

// Usar ubicación actual como origen
function usarUbicacionActual(tipo) {
    if (!userLocation) {
        obtenerUbicacion();
        setTimeout(() => {
            if (userLocation) {
                document.getElementById('origenLat').value = userLocation[0].toFixed(6);
                document.getElementById('origenLon').value = userLocation[1].toFixed(6);
            }
        }, 2000);
    } else {
        if (tipo === 'origen') {
            document.getElementById('origenLat').value = userLocation[0].toFixed(6);
            document.getElementById('origenLon').value = userLocation[1].toFixed(6);
            mostrarEstadoRuta('✅ Ubicación actual establecida como origen', 'success');
        }
    }
}

// Seleccionar punto en el mapa
function seleccionarEnMapa(tipo) {
    seleccionandoPunto = tipo;
    mostrarEstadoRuta(`🎯 Haz clic en el mapa para seleccionar el punto ${tipo === 'origen' ? 'de origen' : 'de destino'}`, 'info');
    
    // Cambiar cursor del mapa
    document.getElementById('map').style.cursor = 'crosshair';
}

// Agregar punto seleccionado
function agregarPuntoSeleccionado(latlng) {
    if (!seleccionandoPunto) return;
    
    const lat = latlng.lat;
    const lon = latlng.lng;
    
    if (seleccionandoPunto === 'origen') {
        document.getElementById('origenLat').value = lat.toFixed(6);
        document.getElementById('origenLon').value = lon.toFixed(6);
        
        // Agregar marcador visual
        if (origenMarker) map.removeLayer(origenMarker);
        origenMarker = L.marker([lat, lon], { icon: origenIcon }).addTo(map);
        origenMarker.bindPopup('📍 Punto de origen').openPopup();
        
        mostrarEstadoRuta('✅ Punto de origen seleccionado', 'success');
    } else if (seleccionandoPunto === 'destino') {
        document.getElementById('destinoLat').value = lat.toFixed(6);
        document.getElementById('destinoLon').value = lon.toFixed(6);
        
        // Agregar marcador visual
        if (destinoMarker) map.removeLayer(destinoMarker);
        destinoMarker = L.marker([lat, lon], { icon: destinoIcon }).addTo(map);
        destinoMarker.bindPopup('🏁 Punto de destino').openPopup();
        
        mostrarEstadoRuta('✅ Punto de destino seleccionado', 'success');
    }
    
    // Restaurar cursor
    document.getElementById('map').style.cursor = '';
    seleccionandoPunto = null;
}

// Calcular ruta usando OpenRouteService con rutas alternativas
async function calcularRuta() {
    const origenLat = parseFloat(document.getElementById('origenLat').value);
    const origenLon = parseFloat(document.getElementById('origenLon').value);
    const destinoLat = parseFloat(document.getElementById('destinoLat').value);
    const destinoLon = parseFloat(document.getElementById('destinoLon').value);
    const profile = document.getElementById('routeProfile').value;
    
    // Validar coordenadas
    if (isNaN(origenLat) || isNaN(origenLon) || isNaN(destinoLat) || isNaN(destinoLon)) {
        mostrarEstadoRuta('❌ Por favor ingresa coordenadas válidas para origen y destino', 'error');
        return;
    }
    
    mostrarEstadoRuta('🔄 Calculando rutas alternativas...', 'info');
    
    try {
        // Convertir perfil para OSRM
        const osrmProfile = profile === 'driving-car' ? 'driving' : profile === 'cycling-regular' ? 'cycling' : 'foot';
        
        // Solicitar rutas alternativas
        const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${origenLon},${origenLat};${destinoLon},${destinoLat}?overview=full&geometries=geojson&alternatives=true&steps=true`;
        
        const response = await fetch(url);
        
        if (!response.ok) throw new Error('Error al calcular ruta');
        
        const data = await response.json();
        
        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            throw new Error('No se pudo encontrar una ruta');
        }
        
        const routes = data.routes;
        currentRoutes = routes;
        
        // Limpiar rutas anteriores
        routeLayers.forEach(layer => map.removeLayer(layer));
        routeLayers = [];
        
        // Colores para diferentes rutas
        const routeColors = [
            { color: '#667eea', name: 'Ruta Principal', weight: 6, opacity: 0.8 },
            { color: '#28a745', name: 'Ruta Alternativa 1', weight: 5, opacity: 0.7 },
            { color: '#ffc107', name: 'Ruta Alternativa 2', weight: 5, opacity: 0.7 }
        ];
        
        // Dibujar todas las rutas en el mapa
        routes.forEach((route, index) => {
            if (index < 3) { // Máximo 3 rutas
                const coordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
                const style = routeColors[index];
                
                const routeLayer = L.polyline(coordinates, {
                    color: style.color,
                    weight: style.weight,
                    opacity: style.opacity,
                    smoothFactor: 1
                }).addTo(map);
                
                // Agregar popup con información de la ruta
                const distanceKm = (route.distance / 1000).toFixed(2);
                const durationMin = Math.round(route.duration / 60);
                
                routeLayer.bindPopup(`
                    <div style="text-align: center;">
                        <strong>${style.name}</strong><br>
                        📏 ${distanceKm} km<br>
                        ⏱️ ${durationMin} min
                    </div>
                `);
                
                routeLayers.push(routeLayer);
            }
        });
        
        // Agregar marcadores de origen y destino si no existen
        if (!origenMarker) {
            origenMarker = L.marker([origenLat, origenLon], { icon: origenIcon }).addTo(map);
            origenMarker.bindPopup('📍 Origen');
        }
        
        if (!destinoMarker) {
            destinoMarker = L.marker([destinoLat, destinoLon], { icon: destinoIcon }).addTo(map);
            destinoMarker.bindPopup('🏁 Destino');
        }
        
        // Ajustar vista a todas las rutas
        const allCoordinates = [];
        routes.forEach(route => {
            route.geometry.coordinates.forEach(coord => {
                allCoordinates.push([coord[1], coord[0]]);
            });
        });
        
        if (allCoordinates.length > 0) {
            const bounds = L.latLngBounds(allCoordinates);
            map.fitBounds(bounds, { padding: [50, 50] });
        }
        
        // Mostrar información de todas las rutas
        mostrarInformacionRutas(routes, profile);
        
        document.getElementById('btnLimpiarRuta').style.display = 'block';
        
        const numRutas = Math.min(routes.length, 3);
        mostrarEstadoRuta(`✅ Se encontraron ${numRutas} ruta(s) alternativa(s)`, 'success');
        
    } catch (error) {
        console.error('Error:', error);
        mostrarEstadoRuta('❌ Error al calcular ruta: ' + error.message, 'error');
    }
}

// Mostrar información de múltiples rutas
function mostrarInformacionRutas(routes, profile) {
    const routeInfoDiv = document.getElementById('routeInfo');
    routeInfoDiv.innerHTML = '<h4>📊 Rutas Encontradas</h4>';
    
    const routeNames = ['Principal', 'Alternativa 1', 'Alternativa 2'];
    const routeColors = ['#667eea', '#28a745', '#ffc107'];
    
    routes.forEach((route, index) => {
        if (index < 3) {
            const distanceKm = (route.distance / 1000).toFixed(2);
            const durationMin = Math.round(route.duration / 60);
            
            routeInfoDiv.innerHTML += `
                <div class="route-detail" style="border-left: 4px solid ${routeColors[index]}; padding-left: 10px; margin: 10px 0;">
                    <strong style="color: ${routeColors[index]};">Ruta ${routeNames[index]}</strong><br>
                    📏 Distancia: <span>${distanceKm} km</span><br>
                    ⏱️ Tiempo: <span>${durationMin} minutos</span><br>
                    🚀 Tipo: <span>${getProfileName(profile)}</span>
                </div>
            `;
        }
    });
    
    routeInfoDiv.style.display = 'block';
}

// Obtener nombre del perfil de ruta
function getProfileName(profile) {
    const profiles = {
        'driving-car': '🚗 Auto',
        'cycling-regular': '🚴 Bicicleta',
        'foot-walking': '🚶 A pie'
    };
    return profiles[profile] || profile;
}

// Limpiar ruta
function limpiarRuta() {
    // Limpiar todas las rutas
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];
    
    if (origenMarker) {
        map.removeLayer(origenMarker);
        origenMarker = null;
    }
    
    if (destinoMarker) {
        map.removeLayer(destinoMarker);
        destinoMarker = null;
    }
    
    document.getElementById('origenLat').value = '';
    document.getElementById('origenLon').value = '';
    document.getElementById('destinoLat').value = '';
    document.getElementById('destinoLon').value = '';
    document.getElementById('routeInfo').style.display = 'none';
    document.getElementById('btnLimpiarRuta').style.display = 'none';
    
    currentRoutes = [];
    
    mostrarEstadoRuta('🗑️ Rutas limpiadas', 'info');
}

// Inicializar aplicación al cargar
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    
    // Cargar capa automáticamente al iniciar
    setTimeout(() => {
        cargarCapa();
    }, 500);
    
    // Ajustar responsive en cambio de tamaño de ventana
    window.addEventListener('resize', function() {
        // Los paneles siempre son retráctiles en cualquier tamaño de pantalla
        // Ajustamos el posicionamiento del zoom para que esté centrado verticalmente
        const zoomControl = document.querySelector('.leaflet-control-zoom');
        if (zoomControl) {
            zoomControl.style.position = 'fixed';
            zoomControl.style.top = '50%';
            zoomControl.style.transform = 'translateY(-50%)';
            
            if (window.innerWidth <= 768) {
                zoomControl.style.right = '10px';
            } else {
                zoomControl.style.right = '20px';
            }
        }
    });
});

// ==================== FUNCIONES PARA GENERACIÓN DE FICHA PDF ====================

/**
 * Carga una imagen desde URL usando fetch con proxy para evitar CORS
 * Retorna una promesa con el DataURL en base64
 */
async function cargarImagenBase64(url) {
    if (!url) return null;
    
    // Convertir URL de Google Drive
    const imageUrl = convertDriveUrl(url);
    
    // Lista de proxies a intentar
    const proxies = [
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
    ];
    
    // Intentar con cada proxy
    for (let i = 0; i < proxies.length; i++) {
        try {
            const proxyUrl = proxies[i](imageUrl);
            console.log(`Intentando proxy ${i + 1}: ${proxyUrl}`);
            
            const response = await fetch(proxyUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'image/*'
                }
            });
            
            if (!response.ok) {
                console.log(`Proxy ${i + 1} falló con status: ${response.status}`);
                continue;
            }
            
            const blob = await response.blob();
            
            // Verificar que sea una imagen válida
            if (!blob.type.startsWith('image/')) {
                console.log(`Proxy ${i + 1} no devolvió una imagen válida: ${blob.type}`);
                continue;
            }
            
            // Convertir Blob a DataURL
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    console.log('Imagen cargada exitosamente');
                    resolve(reader.result);
                };
                reader.onerror = () => {
                    console.log('Error al leer blob');
                    reject(new Error('Error al leer imagen'));
                };
                reader.readAsDataURL(blob);
            });
            
        } catch (error) {
            console.log(`Error con proxy ${i + 1}:`, error.message);
            continue;
        }
    }
    
    // Fallback: Intentar carga directa con Image + Canvas (puede fallar por CORS)
    console.log('Intentando carga directa con Image...');
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = function() {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                console.log('Imagen cargada por fallback');
                resolve(dataUrl);
            } catch (e) {
                console.log('Canvas tainted - no se pudo obtener imagen:', e);
                resolve(null);
            }
        };
        
        img.onerror = function() {
            console.log('Error al cargar imagen directamente');
            resolve(null);
        };
        
        // Agregar timestamp para evitar caché
        img.src = imageUrl + (imageUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
        
        // Timeout de 5 segundos
        setTimeout(() => {
            if (!img.complete) {
                console.log('Timeout al cargar imagen');
                resolve(null);
            }
        }, 5000);
    });
}

/**
 * Genera un mapa estático usando tiles de OpenStreetMap
 * Retorna un DataURL de la imagen del mapa
 */
async function generarMapaEstatico(lat, lon, zoom = 17, width = 300, height = 200) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        // Convertir lat/lon a tile coordinates
        const n = Math.pow(2, zoom);
        const xtile = Math.floor((parseFloat(lon) + 180) / 360 * n);
        const ytile = Math.floor((1 - Math.log(Math.tan(parseFloat(lat) * Math.PI / 180) + 1 / Math.cos(parseFloat(lat) * Math.PI / 180)) / Math.PI) / 2 * n);
        
        // Calcular offset dentro del tile
        const xOffset = ((parseFloat(lon) + 180) / 360 * n - xtile) * 256;
        const yOffset = ((1 - Math.log(Math.tan(parseFloat(lat) * Math.PI / 180) + 1 / Math.cos(parseFloat(lat) * Math.PI / 180)) / Math.PI) / 2 * n - ytile) * 256;
        
        // Cargar tiles alrededor del punto central
        const tilesLoaded = [];
        const tilesNeeded = 9; // 3x3 grid
        let loadedCount = 0;
        
        // Dibujar fondo mientras cargan los tiles
        ctx.fillStyle = '#e8e8e8';
        ctx.fillRect(0, 0, width, height);
        
        // Cargar 3x3 grid de tiles
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const tx = xtile + dx;
                const ty = ytile + dy;
                const tileUrl = `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
                
                const img = new Image();
                img.crossOrigin = 'anonymous';
                
                img.onload = function() {
                    const drawX = (dx + 1) * 256 - xOffset - (256 * 1.5 - width / 2);
                    const drawY = (dy + 1) * 256 - yOffset - (256 * 1.5 - height / 2);
                    ctx.drawImage(img, drawX, drawY, 256, 256);
                    loadedCount++;
                    
                    if (loadedCount === tilesNeeded) {
                        // Todos los tiles cargados, agregar marcador
                        dibujarMarcador(ctx, width / 2, height / 2);
                        resolve(canvas.toDataURL('image/png'));
                    }
                };
                
                img.onerror = function() {
                    loadedCount++;
                    if (loadedCount === tilesNeeded) {
                        dibujarMarcador(ctx, width / 2, height / 2);
                        resolve(canvas.toDataURL('image/png'));
                    }
                };
                
                img.src = tileUrl;
            }
        }
        
        // Timeout de seguridad
        setTimeout(() => {
            if (loadedCount < tilesNeeded) {
                dibujarMarcador(ctx, width / 2, height / 2);
                resolve(canvas.toDataURL('image/png'));
            }
        }, 5000);
    });
}

/**
 * Dibuja un marcador de ubicación en el canvas
 */
function dibujarMarcador(ctx, x, y) {
    // Sombra del marcador
    ctx.beginPath();
    ctx.ellipse(x, y + 25, 10, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fill();
    
    // Pin del marcador
    ctx.beginPath();
    ctx.moveTo(x, y + 20);
    ctx.bezierCurveTo(x - 15, y + 5, x - 15, y - 15, x, y - 20);
    ctx.bezierCurveTo(x + 15, y - 15, x + 15, y + 5, x, y + 20);
    ctx.fillStyle = '#dc3545';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Círculo interior
    ctx.beginPath();
    ctx.arc(x, y - 5, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
}

/**
 * Función principal para generar la Ficha Técnica en PDF
 * Incluye imagen de cámara y mapa de ubicación lado a lado
 */
async function generarFichaPDF(data) {
    // Mostrar indicador de carga
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'pdfLoading';
    loadingDiv.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;">
            <div style="background: white; padding: 30px 50px; border-radius: 15px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
                <div style="font-size: 40px; margin-bottom: 15px;">📄</div>
                <div style="font-size: 18px; font-weight: bold; color: #333;">Generando Ficha Técnica...</div>
                <div style="font-size: 14px; color: #666; margin-top: 10px;">Cargando imágenes y datos</div>
                <div style="margin-top: 20px; width: 200px; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;">
                    <div style="width: 0%; height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); border-radius: 3px; animation: loadingBar 2s ease-in-out infinite;"></div>
                </div>
            </div>
        </div>
        <style>
            @keyframes loadingBar {
                0% { width: 0%; }
                50% { width: 70%; }
                100% { width: 100%; }
            }
        </style>
    `;
    document.body.appendChild(loadingDiv);
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'letter'); // Tamaño carta vertical
        
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 12; // Margen lateral
        const contentWidth = pageWidth - (margin * 2);
        
        // Colores según accesibilidad
        const colorHex = data.color || '#17a2b8';
        const rgb = hexToRgb(colorHex);
        
        // ========== ENCABEZADO ==========
        // Fondo del encabezado
        doc.setFillColor(26, 82, 118);
        doc.rect(0, 0, pageWidth, 32, 'F');
        
        // Logo (círculo blanco)
        doc.setFillColor(255, 255, 255);
        doc.circle(22, 16, 10, 'F');
        
        // Texto del logo
        doc.setTextColor(26, 82, 118);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.text('GAMO', 22, 14, { align: 'center' });
        doc.text('ORURO', 22, 18, { align: 'center' });
        
        // Título
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('FICHA TÉCNICA - CÁMARA PLUVIAL', 38, 13);
        
        // Subtítulo
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text('Sistema de Drenaje Pluvial - Gobierno Autónomo Municipal de Oruro', 38, 21);
        
        // ========== BARRA DE CÓDIGO Y ESTADO ==========
        doc.setFillColor(rgb.r, rgb.g, rgb.b);
        doc.rect(0, 32, pageWidth, 15, 'F');
        
        // Código de cámara
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(`CÁMARA: ${data.cod_cam}`, margin, 42);
        
        // Badge de estado
        doc.setFillColor(255, 255, 255);
        const estadoText = data.accesibili.toUpperCase();
        const estadoWidth = doc.getTextWidth(estadoText) + 12;
        doc.roundedRect(pageWidth - estadoWidth - margin, 36, estadoWidth, 8, 2, 2, 'F');
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.setFontSize(8);
        doc.text(estadoText, pageWidth - margin - 6, 41, { align: 'right' });
        
        // ========== SECCIÓN DE IMÁGENES (FOTO Y MAPA) ==========
        let yPos = 52;
        
        // Ancho de cada imagen (lado a lado con espacio entre ellas)
        const imageWidth = (contentWidth - 6) / 2; // 6mm de espacio entre imágenes
        const imageHeight = 50;
        
        // Posiciones X
        const leftImageX = margin;
        const rightImageX = margin + imageWidth + 6;
        
        // Título Fotografía
        doc.setTextColor(26, 82, 118);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('FOTOGRAFÍA', leftImageX, yPos);
        
        // Título Ubicación
        doc.text('UBICACIÓN', rightImageX, yPos);
        
        yPos += 4;
        
        // ===== RECUADRO DE FOTOGRAFÍA (IZQUIERDA) =====
        doc.setDrawColor(rgb.r, rgb.g, rgb.b);
        doc.setLineWidth(0.8);
        doc.setFillColor(245, 245, 245);
        doc.roundedRect(leftImageX, yPos, imageWidth, imageHeight, 2, 2, 'FD');
        
        // Cargar imagen de la cámara
        let fotoBase64 = null;
        if (data.fotoUrl) {
            console.log('Cargando imagen de cámara:', data.fotoUrl);
            fotoBase64 = await cargarImagenBase64(data.fotoUrl);
        }
        
        if (fotoBase64) {
            // Calcular dimensiones para que la imagen quepa en el recuadro
            const imgPadding = 2;
            const maxImgWidth = imageWidth - (imgPadding * 2);
            const maxImgHeight = imageHeight - (imgPadding * 2);
            
            // Insertar imagen
            try {
                doc.addImage(fotoBase64, 'JPEG', leftImageX + imgPadding, yPos + imgPadding, maxImgWidth, maxImgHeight, undefined, 'FAST');
            } catch (e) {
                console.error('Error al insertar imagen de cámara:', e);
                // Dibujar placeholder
                doc.setTextColor(150, 150, 150);
                doc.setFontSize(9);
                doc.text('📷 Imagen no disponible', leftImageX + imageWidth/2, yPos + imageHeight/2, { align: 'center' });
            }
        } else {
            // Dibujar placeholder si no hay imagen
            doc.setTextColor(150, 150, 150);
            doc.setFontSize(9);
            doc.text('📷 Imagen no disponible', leftImageX + imageWidth/2, yPos + imageHeight/2, { align: 'center' });
        }
        
        // ===== RECUADRO DE MAPA (DERECHA) =====
        doc.setDrawColor(41, 128, 185);
        doc.setFillColor(232, 244, 248);
        doc.roundedRect(rightImageX, yPos, imageWidth, imageHeight, 2, 2, 'FD');
        
        // Generar mapa estático
        console.log('Generando mapa estático para:', data.lat, data.lon);
        const mapBase64 = await generarMapaEstatico(data.lat, data.lon, 17, 400, 280);
        
        if (mapBase64) {
            const imgPadding = 2;
            const maxImgWidth = imageWidth - (imgPadding * 2);
            const maxImgHeight = imageHeight - (imgPadding * 2);
            
            try {
                doc.addImage(mapBase64, 'PNG', rightImageX + imgPadding, yPos + imgPadding, maxImgWidth, maxImgHeight, undefined, 'FAST');
            } catch (e) {
                console.error('Error al insertar mapa:', e);
                // Dibujar placeholder
                doc.setTextColor(21, 87, 36);
                doc.setFontSize(16);
                doc.text('📍', rightImageX + imageWidth/2, yPos + imageHeight/2 - 5, { align: 'center' });
                doc.setFontSize(7);
                doc.text(`Lat: ${data.lat}`, rightImageX + imageWidth/2, yPos + imageHeight/2 + 5, { align: 'center' });
                doc.text(`Lon: ${data.lon}`, rightImageX + imageWidth/2, yPos + imageHeight/2 + 10, { align: 'center' });
            }
        } else {
            // Placeholder del mapa
            doc.setTextColor(21, 87, 36);
            doc.setFontSize(16);
            doc.text('📍', rightImageX + imageWidth/2, yPos + imageHeight/2 - 5, { align: 'center' });
            doc.setFontSize(7);
            doc.text(`Lat: ${data.lat}`, rightImageX + imageWidth/2, yPos + imageHeight/2 + 5, { align: 'center' });
            doc.text(`Lon: ${data.lon}`, rightImageX + imageWidth/2, yPos + imageHeight/2 + 10, { align: 'center' });
        }
        
        // ========== DATOS TÉCNICOS ==========
        yPos += imageHeight + 8;
        
        doc.setTextColor(26, 82, 118);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('DATOS TÉCNICOS', margin, yPos);
        
        // Línea separadora
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(margin, yPos + 2, pageWidth - margin, yPos + 2);
        
        yPos += 8;
        
        // Datos en grid 2 columnas
        const datos = [
            { label: 'CÓDIGO', value: data.cod_cam },
            { label: 'ACCESIBILIDAD', value: data.accesibili },
            { label: 'LOCALIZACIÓN', value: data.localizaci },
            { label: 'RASANTE', value: data.rasante },
            { label: 'ESTADO', value: data.estado },
            { label: 'COORDENADAS', value: data.coordenadas }
        ];
        
        const colWidth = (contentWidth - 6) / 2;
        let col = 0;
        let row = 0;
        
        datos.forEach((dato, index) => {
            const x = margin + (col * (colWidth + 6));
            const y = yPos + (row * 15);
            
            // Fondo del campo
            doc.setFillColor(248, 249, 250);
            doc.roundedRect(x, y, colWidth, 12, 1.5, 1.5, 'F');
            
            // Borde izquierdo de color
            doc.setFillColor(rgb.r, rgb.g, rgb.b);
            doc.rect(x, y, 2.5, 12, 'F');
            
            // Label
            doc.setFillColor(26, 82, 118);
            doc.roundedRect(x + 2.5, y, 28, 12, 0, 0, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(6);
            doc.setFont('helvetica', 'bold');
            doc.text(dato.label, x + 4, y + 7);
            
            // Value
            doc.setTextColor(51, 51, 51);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            const maxValueWidth = colWidth - 35;
            let valueText = dato.value || 'Sin datos';
            // Truncar si es muy largo
            while (doc.getTextWidth(valueText) > maxValueWidth && valueText.length > 3) {
                valueText = valueText.substring(0, valueText.length - 4) + '...';
            }
            doc.text(valueText, x + 32, y + 7);
            
            col++;
            if (col >= 2) {
                col = 0;
                row++;
            }
        });
        
        // ========== COORDENADAS GEOGRÁFICAS ==========
        yPos += (Math.ceil(datos.length / 2) * 15) + 10;
        
        // Fondo de sección
        doc.setFillColor(232, 244, 248);
        doc.roundedRect(margin, yPos - 3, contentWidth, 38, 2, 2, 'F');
        
        doc.setTextColor(26, 82, 118);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('COORDENADAS GEOGRÁFICAS', margin + 4, yPos + 5);
        
        // Coordenadas en 3 columnas
        const coordWidth = (contentWidth - 16) / 3;
        const coords = [
            { label: 'LATITUD', value: data.lat },
            { label: 'LONGITUD', value: data.lon },
            { label: 'ALTITUD', value: '3,706 m.s.n.m.' }
        ];
        
        coords.forEach((coord, index) => {
            const x = margin + 4 + (index * (coordWidth + 4));
            const y = yPos + 12;
            
            // Recuadro blanco
            doc.setFillColor(255, 255, 255);
            doc.roundedRect(x, y, coordWidth, 18, 2, 2, 'F');
            
            // Label
            doc.setTextColor(102, 102, 102);
            doc.setFontSize(6);
            doc.text(coord.label, x + coordWidth/2, y + 5, { align: 'center' });
            
            // Value
            doc.setTextColor(26, 82, 118);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text(coord.value, x + coordWidth/2, y + 13, { align: 'center' });
        });
        
        // ========== FOOTER ==========
        const footerY = pageHeight - 22;
        
        // Línea superior del footer
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(margin, footerY, pageWidth - margin, footerY);
        
        // Fecha de generación
        doc.setTextColor(102, 102, 102);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        const fecha = new Date().toLocaleString('es-BO');
        doc.text(`Generado: ${fecha}`, margin, footerY + 6);
        doc.text('Sistema: Geoportal Cámaras Pluviales v1.0', margin, footerY + 11);
        
        // QR Placeholder
        doc.setFillColor(51, 51, 51);
        doc.roundedRect(pageWidth/2 - 8, footerY + 2, 16, 16, 1.5, 1.5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(5);
        doc.text('QR', pageWidth/2, footerY + 11, { align: 'center' });
        
        // Autores
        doc.setTextColor(102, 102, 102);
        doc.setFontSize(7);
        doc.text('Elaborado por:', pageWidth - margin, footerY + 4, { align: 'right' });
        doc.text('Geogr. John Leonardo Cabrera E.', pageWidth - margin, footerY + 9, { align: 'right' });
        doc.text('Geogr. Luis Freddy Quenta A.', pageWidth - margin, footerY + 14, { align: 'right' });
        
        // ========== MARCA DE AGUA ==========
        doc.setTextColor(0, 0, 0);
        doc.setGState(new doc.GState({ opacity: 0.03 }));
        doc.setFontSize(50);
        doc.setFont('helvetica', 'bold');
        doc.text('GAMO', pageWidth/2, pageHeight/2, { align: 'center', angle: 45 });
        
        // Restaurar opacidad
        doc.setGState(new doc.GState({ opacity: 1 }));
        
        // Guardar PDF
        doc.save(`Ficha_Tecnica_${data.cod_cam}.pdf`);
        
        console.log('PDF generado exitosamente');
        
    } catch (error) {
        console.error('Error al generar PDF:', error);
        alert('Error al generar el PDF. Por favor intente nuevamente.');
    } finally {
        // Remover indicador de carga
        const loading = document.getElementById('pdfLoading');
        if (loading) {
            loading.remove();
        }
    }
}

// Función auxiliar para convertir hex a RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 23, g: 162, b: 184 };
}
