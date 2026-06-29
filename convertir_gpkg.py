# -*- coding: utf-8 -*-
"""Convierte los GeoPackage (UTM 19S / EPSG:32719) a un GeoJSON WGS84
que el geoportal lee directamente con fetch. Ejecutar cuando cambien los datos:
    python convertir_gpkg.py
"""
import sqlite3, struct, json, os
from pyproj import Transformer

BASE = os.path.dirname(os.path.abspath(__file__))
GPKG_DIR = os.path.join(BASE, "geopacage")
SALIDA = os.path.join(BASE, "datos.geojson")

transformer = Transformer.from_crs("EPSG:32719", "EPSG:4326", always_xy=True)

# Definicion de cada capa: archivo, tabla y "tipo" logico usado por el frontend
CAPAS = [
    ("camaras de inspeccion.gpkg", "camaras_casco_viejo_oruro", "camaras"),
    ("sumideros.gpkg",            "sumideros_casco_viejo",      "sumideros"),
    ("tuberias sumideros.gpkg",   "tuberias_sumidero_casco_viejo", "tuberias_sumideros"),
    ("uberias camaras.gpkg",      "tuberias_camara_casco_viejo",   "tuberias_camaras"),
]


def leer_gpkg_geom(blob):
    """Decodifica una geometria GeoPackage (cabecera GP + WKB) a coordenadas."""
    if blob is None:
        return None
    # Cabecera GeoPackage: magic 'GP'(2) + version(1) + flags(1) + srs_id(4)
    flags = blob[3]
    env_flag = (flags >> 1) & 0x07
    env_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    header_len = 8 + env_sizes.get(env_flag, 0)
    return blob[header_len:]  # WKB puro


def parse_wkb(wkb):
    """Parser minimal de WKB para Point y MultiLineString. Devuelve (tipo_geojson, coords)."""
    pos = 0
    byte_order = wkb[pos]; pos += 1
    endian = "<" if byte_order == 1 else ">"
    geom_type = struct.unpack(endian + "I", wkb[pos:pos+4])[0]; pos += 4
    base = geom_type % 1000

    def read_point(p):
        x, y = struct.unpack(endian + "dd", wkb[p:p+16])
        return [x, y], p + 16

    if base == 1:  # Point
        (x, y), pos = read_point(pos)
        return "Point", [x, y]
    if base == 2:  # LineString
        n = struct.unpack(endian + "I", wkb[pos:pos+4])[0]; pos += 4
        coords = []
        for _ in range(n):
            pt, pos = read_point(pos)
            coords.append(pt)
        return "LineString", coords
    if base == 5:  # MultiLineString
        n = struct.unpack(endian + "I", wkb[pos:pos+4])[0]; pos += 4
        lines = []
        for _ in range(n):
            # cada linea trae su propio byte order + type
            lo = wkb[pos]; pos += 1
            le = "<" if lo == 1 else ">"
            pos += 4  # type
            npts = struct.unpack(le + "I", wkb[pos:pos+4])[0]; pos += 4
            line = []
            for _ in range(npts):
                x, y = struct.unpack(le + "dd", wkb[pos:pos+16]); pos += 16
                line.append([x, y])
            lines.append(line)
        return "MultiLineString", lines
    raise ValueError("Tipo WKB no soportado: %d" % base)


def reproyectar(geom_type, coords):
    if geom_type == "Point":
        lon, lat = transformer.transform(coords[0], coords[1])
        return [lon, lat]
    if geom_type == "LineString":
        return [list(transformer.transform(x, y)) for x, y in coords]
    if geom_type == "MultiLineString":
        return [[list(transformer.transform(x, y)) for x, y in line] for line in coords]


features = []
for archivo, tabla, tipo in CAPAS:
    ruta = os.path.join(GPKG_DIR, archivo)
    con = sqlite3.connect(ruta)
    con.row_factory = sqlite3.Row
    cols = [r[1] for r in con.execute('PRAGMA table_info("%s")' % tabla)]
    geom_col = "geom"
    attr_cols = [c for c in cols if c not in (geom_col, "fid")]
    n = 0
    for row in con.execute('SELECT * FROM "%s"' % tabla):
        wkb = leer_gpkg_geom(row[geom_col])
        if wkb is None:
            continue
        try:
            gt, coords = parse_wkb(wkb)
        except Exception as e:
            print("  geom omitida en %s: %s" % (tabla, e))
            continue
        props = {c: row[c] for c in attr_cols}
        props["_capa"] = tipo
        features.append({
            "type": "Feature",
            "geometry": {"type": gt, "coordinates": reproyectar(gt, coords)},
            "properties": props,
        })
        n += 1
    con.close()
    print("%-30s -> %d features" % (tipo, n))

geojson = {"type": "FeatureCollection", "features": features}
with open(SALIDA, "w", encoding="utf-8") as f:
    json.dump(geojson, f, ensure_ascii=False)
print("\nGuardado: %s  (%d features totales)" % (SALIDA, len(features)))
